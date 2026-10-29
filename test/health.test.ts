import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { createTestApp } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.close();
});

describe("operational endpoints", () => {
  it("GET /health returns ok", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready checks the database", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });

  it("GET /metrics exposes booking outcome counters", async () => {
    await ctx.app.inject({
      method: "POST",
      url: "/v1/appointments",
      payload: { dealershipId: "nope", customerId: "x", vehicleId: "x", serviceTypeId: "x", startTime: "2026-11-02T09:00:00Z" },
    });
    const res = await ctx.app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('appointment_booking_attempts_total{outcome="NOT_FOUND"} 1');
    expect(res.body).toContain("http_request_duration_seconds_bucket");
  });

  it("propagates the caller's x-request-id and includes it in error bodies", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/appointments/nope",
      headers: { "x-request-id": "trace-abc" },
    });
    expect(res.headers["x-request-id"]).toBe("trace-abc");
    expect(res.json().error.requestId).toBe("trace-abc");
  });

  it("serves the OpenAPI document", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    expect(res.json().paths).toHaveProperty("/v1/appointments");
  });

  it("reports the package.json version in the OpenAPI document", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const res = await ctx.app.inject({ method: "GET", url: "/docs/json" });
    expect(res.json().info.version).toBe(pkg.version);
  });
});
