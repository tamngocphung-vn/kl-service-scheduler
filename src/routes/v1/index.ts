import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Db } from "../../db/client.js";
import type { Metrics } from "../../observability/metrics.js";
import type { SchedulingService } from "../../services/scheduling-service.js";
import { appointmentRoutes } from "./appointments.js";
import { referenceRoutes } from "./reference.js";

interface Options {
  service: SchedulingService;
  metrics: Metrics;
  db: Db;
}

// Everything served under /v1. A breaking contract change goes in a sibling v2/ folder that
// reuses the same services and domain; v1 keeps working until it is retired.
export const v1Routes: FastifyPluginAsyncTypebox<Options> = async (app, { service, metrics, db }) => {
  await app.register(appointmentRoutes, { service, metrics });
  await app.register(referenceRoutes, { db });
};
