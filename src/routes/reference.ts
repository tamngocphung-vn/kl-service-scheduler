import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { asc } from "drizzle-orm";
import { Type } from "typebox";
import type { Db } from "../db/client.js";
import { dealerships, serviceTypes } from "../db/schema.js";

// Read-only lookups so API clients can discover valid IDs.
export const referenceRoutes: FastifyPluginAsyncTypebox<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/dealerships",
    {
      schema: {
        tags: ["reference"],
        summary: "List dealerships",
        response: {
          200: Type.Array(
            Type.Object({
              id: Type.String(),
              name: Type.String(),
              timezone: Type.String(),
              opensAtMinute: Type.Integer(),
              closesAtMinute: Type.Integer(),
            }),
          ),
        },
      },
    },
    async () => db.select().from(dealerships).orderBy(asc(dealerships.id)).all(),
  );

  app.get(
    "/service-types",
    {
      schema: {
        tags: ["reference"],
        summary: "List service types",
        response: {
          200: Type.Array(
            Type.Object({
              id: Type.String(),
              code: Type.String(),
              name: Type.String(),
              durationMinutes: Type.Integer(),
            }),
          ),
        },
      },
    },
    async () => db.select().from(serviceTypes).orderBy(asc(serviceTypes.id)).all(),
  );
};
