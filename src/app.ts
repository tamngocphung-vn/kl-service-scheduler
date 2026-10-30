import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify, { type FastifyServerOptions } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { AppError } from "./domain/errors.js";
import { createMetrics } from "./observability/metrics.js";
import { traceLogFields } from "./observability/trace.js";
import { v1Routes } from "./routes/v1/index.js";
import { Appointment, ErrorResponse } from "./routes/v1/schemas.js";
import { SchedulingService, type SchedulingServiceOptions } from "./services/scheduling-service.js";

// package.json is the single source of the release version. "../package.json" resolves from
// both src/ (tsx) and dist/ (production build); the Docker image copies it next to dist/.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

export interface AppOptions extends SchedulingServiceOptions {
  db: Db;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp({ db, logger, ...serviceOpts }: AppOptions) {
  const app = Fastify({
    logger: typeof logger === "object" ? { ...logger, mixin: traceLogFields } : (logger ?? false),
    // Honour an upstream correlation ID (e.g. from an API gateway) or mint one.
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    // Reject unknown fields instead of silently stripping them, so e.g. a client-supplied
    // technicianId isn't mistaken for a honoured preference.
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  const metrics = createMetrics();
  const service = new SchedulingService(db, serviceOpts);

  app.addSchema(ErrorResponse);
  app.addSchema(Appointment);

  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });
  app.addHook("onResponse", async (req, reply) => {
    metrics.httpRequestDuration.observe(
      { method: req.method, route: req.routeOptions.url ?? "unmatched", status_code: reply.statusCode },
      reply.elapsedTime / 1000,
    );
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details, requestId: req.id },
      });
    }
    const e = err as { validation?: unknown; statusCode?: number; message: string };
    if (e.validation) {
      return reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: e.message, details: e.validation, requestId: req.id },
      });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: "BAD_REQUEST", message: e.message, requestId: req.id } });
    }
    req.log.error({ err }, "unhandled error");
    return reply
      .code(500)
      .send({ error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId: req.id } });
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Unified Service Scheduler API",
        version,
        description: "Book dealership service appointments against technician and service-bay availability.",
      },
      tags: [
        { name: "appointments" },
        { name: "availability" },
        { name: "reference" },
        { name: "ops" },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/health", { schema: { tags: ["ops"], summary: "Liveness probe" } }, async () => ({ status: "ok" }));
  app.get("/ready", { schema: { tags: ["ops"], summary: "Readiness probe (checks the database)" } }, async (_req, reply) => {
    try {
      db.get(sql`select 1`);
      return { status: "ready" };
    } catch (err) {
      app.log.error({ err }, "readiness check failed");
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  app.get("/metrics", { schema: { tags: ["ops"], summary: "Prometheus metrics" } }, async (_req, reply) => {
    reply.type(metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  await app.register(v1Routes, { prefix: "/v1", service, metrics, db });

  return app;
}
