import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export interface Metrics {
  registry: Registry;
  httpRequestDuration: Histogram<"method" | "route" | "status_code">;
  bookingAttempts: Counter<"outcome">;
  bookingDuration: Histogram<"outcome">;
}

// A registry per app instance keeps tests isolated (prom-client's default registry is global).
export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  return {
    registry,
    httpRequestDuration: new Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP request latency",
      labelNames: ["method", "route", "status_code"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers: [registry],
    }),
    bookingAttempts: new Counter({
      name: "appointment_booking_attempts_total",
      help: "Booking attempts by outcome (created, replayed, or an error code)",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    bookingDuration: new Histogram({
      name: "appointment_booking_duration_seconds",
      help: "Time spent in the booking transaction (includes waiting for the write lock)",
      labelNames: ["outcome"],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [registry],
    }),
  };
}
