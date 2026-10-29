import { Type } from "typebox";

export const Id = Type.String({ minLength: 1, maxLength: 64 });
export const LocalDate = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Local date at the dealership (YYYY-MM-DD)" });

export const ErrorResponse = Type.Object(
  {
    error: Type.Object({
      code: Type.String(),
      message: Type.String(),
      details: Type.Optional(Type.Unknown()),
      requestId: Type.String(),
    }),
  },
  { $id: "ErrorResponse" },
);

export const Appointment = Type.Object(
  {
    id: Type.String(),
    status: Type.Union([Type.Literal("CONFIRMED"), Type.Literal("CANCELLED")]),
    dealershipId: Type.String(),
    customerId: Type.String(),
    vehicleId: Type.String(),
    serviceTypeId: Type.String(),
    technicianId: Type.String(),
    serviceBayId: Type.String(),
    startTime: Type.String({ format: "date-time" }),
    endTime: Type.String({ format: "date-time" }),
    createdAt: Type.String({ format: "date-time" }),
    cancelledAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  },
  { $id: "Appointment" },
);

export const BookAppointmentBody = Type.Object(
  {
    dealershipId: Id,
    customerId: Id,
    vehicleId: Id,
    serviceTypeId: Id,
    startTime: Type.String({
      format: "date-time",
      description: "Requested start, ISO 8601 with offset, e.g. 2026-11-02T09:00:00Z",
    }),
  },
  { additionalProperties: false },
);

export const errorResponses = {
  400: Type.Ref("ErrorResponse"),
  404: Type.Ref("ErrorResponse"),
  409: Type.Ref("ErrorResponse"),
  422: Type.Ref("ErrorResponse"),
};
