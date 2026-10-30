import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { SpanStatusCode } from "@opentelemetry/api";
import { Type } from "typebox";
import { AppError } from "../../domain/errors.js";
import type { Metrics } from "../../observability/metrics.js";
import { tracer } from "../../observability/trace.js";
import type { SchedulingService } from "../../services/scheduling-service.js";
import { BookAppointmentBody, Id, LocalDate, errorResponses } from "./schemas.js";

interface Options {
  service: SchedulingService;
  metrics: Metrics;
}

export const appointmentRoutes: FastifyPluginAsyncTypebox<Options> = async (app, { service, metrics }) => {
  app.post(
    "/appointments",
    {
      schema: {
        tags: ["appointments"],
        summary: "Book a service appointment",
        description:
          "Checks that a qualified technician and a service bay are both free for the full service duration, " +
          "then creates a confirmed appointment. Send an Idempotency-Key header to make retries safe.",
        headers: Type.Object({ "idempotency-key": Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) }),
        body: BookAppointmentBody,
        response: {
          201: Type.Ref("Appointment"),
          200: Type.Ref("Appointment"),
          ...errorResponses,
        },
      },
    },
    async (req, reply) =>
      // Resource IDs only on the span: customer and vehicle IDs are personal data (GDPR).
      tracer.startActiveSpan("appointment.book", async (span) => {
        span.setAttributes({ "dealership.id": req.body.dealershipId, "service_type.id": req.body.serviceTypeId });
        const endTimer = metrics.bookingDuration.startTimer();
        let outcome = "error";
        try {
          const { appointment, created } = service.book(req.body, req.headers["idempotency-key"]);
          outcome = created ? "created" : "replayed";
          span.setAttributes({
            "appointment.id": appointment.id,
            "technician.id": appointment.technicianId,
            "service_bay.id": appointment.serviceBayId,
          });
          req.log.info(
            {
              appointmentId: appointment.id,
              dealershipId: appointment.dealershipId,
              technicianId: appointment.technicianId,
              serviceBayId: appointment.serviceBayId,
              outcome,
            },
            "appointment booked",
          );
          return reply.code(created ? 201 : 200).send(appointment);
        } catch (err) {
          if (err instanceof AppError) {
            outcome = err.code;
            req.log.info({ outcome, dealershipId: req.body.dealershipId }, "appointment booking rejected");
          } else {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          throw err;
        } finally {
          metrics.bookingAttempts.inc({ outcome });
          endTimer({ outcome });
          span.setAttribute("booking.outcome", outcome);
          span.end();
        }
      }),
  );

  app.get(
    "/appointments/:appointmentId",
    {
      schema: {
        tags: ["appointments"],
        summary: "Get an appointment",
        params: Type.Object({ appointmentId: Id }),
        response: { 200: Type.Ref("Appointment"), ...errorResponses },
      },
    },
    async (req) => service.getAppointment(req.params.appointmentId),
  );

  app.post(
    "/appointments/:appointmentId/cancel",
    {
      schema: {
        tags: ["appointments"],
        summary: "Cancel an appointment, releasing its technician and bay",
        params: Type.Object({ appointmentId: Id }),
        response: { 200: Type.Ref("Appointment"), ...errorResponses },
      },
    },
    async (req) => {
      const appointment = service.cancel(req.params.appointmentId);
      req.log.info({ appointmentId: appointment.id }, "appointment cancelled");
      return appointment;
    },
  );

  app.get(
    "/dealerships/:dealershipId/appointments",
    {
      schema: {
        tags: ["appointments"],
        summary: "List a dealership's appointments for a local date",
        params: Type.Object({ dealershipId: Id }),
        querystring: Type.Object({ date: LocalDate }),
        response: { 200: Type.Array(Type.Ref("Appointment")), ...errorResponses },
      },
    },
    async (req) => service.listForDay(req.params.dealershipId, req.query.date),
  );

  app.get(
    "/dealerships/:dealershipId/availability",
    {
      schema: {
        tags: ["availability"],
        summary: "List start times where a qualified technician and a bay are both free",
        params: Type.Object({ dealershipId: Id }),
        querystring: Type.Object({ serviceTypeId: Id, date: LocalDate }),
        response: {
          200: Type.Object({
            dealershipId: Type.String(),
            serviceTypeId: Type.String(),
            date: Type.String(),
            timezone: Type.String(),
            durationMinutes: Type.Integer(),
            slots: Type.Array(
              Type.Object({
                startTime: Type.String({ format: "date-time" }),
                endTime: Type.String({ format: "date-time" }),
                availableTechnicians: Type.Integer(),
                availableBays: Type.Integer(),
              }),
            ),
          }),
          ...errorResponses,
        },
      },
    },
    async (req) => service.availability(req.params.dealershipId, req.query.serviceTypeId, req.query.date),
  );
};
