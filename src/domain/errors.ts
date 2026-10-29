export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "VEHICLE_NOT_OWNED_BY_CUSTOMER"
  | "START_TIME_IN_PAST"
  | "BEYOND_BOOKING_HORIZON"
  | "OUTSIDE_OPERATING_HOURS"
  | "NO_QUALIFIED_TECHNICIAN"
  | "NO_TECHNICIAN_AVAILABLE"
  | "NO_BAY_AVAILABLE"
  | "VEHICLE_ALREADY_BOOKED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "APPOINTMENT_NOT_CANCELLABLE";

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (entity: string, id: string) =>
  new AppError(404, "NOT_FOUND", `${entity} '${id}' not found`, { entity, id });
