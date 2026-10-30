import { Writable } from "node:stream";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";
import { NOW, booking } from "./helpers.js";

// Spans go to memory instead of an OTLP endpoint, so the test needs no collector or vendor key.
const exporter = new InMemorySpanExporter();

// The production SDK registers both of these; here they are wired up by hand.
beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
});
afterAll(() => {
  trace.disable();
  context.disable();
});

let logLines: Record<string, unknown>[];
let ctx: { app: Awaited<ReturnType<typeof buildApp>>; close: () => void };

beforeEach(async () => {
  exporter.reset();
  logLines = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      logLines.push(JSON.parse(chunk.toString()));
      done();
    },
  });
  const { db, close } = openDatabase(":memory:");
  seed(db);
  ctx = { app: await buildApp({ db, now: () => NOW, logger: { level: "info", stream } }), close };
});
afterEach(async () => {
  await ctx.app.close();
  ctx.close();
});

const bookingSpans = () => exporter.getFinishedSpans().filter((s) => s.name === "appointment.book");

describe("tracing", () => {
  it("records a span for a successful booking, with resource IDs but no personal data", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/v1/appointments", payload: booking() });
    expect(res.statusCode).toBe(201);

    const [span] = bookingSpans();
    expect(span.attributes).toMatchObject({
      "booking.outcome": "created",
      "dealership.id": "dlr-london",
      "service_type.id": "svc-oil",
      "appointment.id": res.json().id,
      "technician.id": res.json().technicianId,
      "service_bay.id": res.json().serviceBayId,
    });
    // Customer and vehicle IDs are personal data (GDPR): never on a span.
    expect(Object.keys(span.attributes).join(" ")).not.toMatch(/customer|vehicle/);
  });

  it("records the error code as the outcome of a rejected booking", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/appointments",
      payload: booking({ startTime: "2026-10-01T09:00:00Z" }),
    });
    expect(res.statusCode).toBe(422);

    const [span] = bookingSpans();
    expect(span.attributes["booking.outcome"]).toBe("START_TIME_IN_PAST");
  });

  it("puts the span's trace ID on the booking log line", async () => {
    await ctx.app.inject({ method: "POST", url: "/v1/appointments", payload: booking() });

    const [span] = bookingSpans();
    const line = logLines.find((l) => l.msg === "appointment booked");
    expect(line?.trace_id).toBe(span.spanContext().traceId);
  });
});
