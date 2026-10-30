import { isSpanContextValid, trace } from "@opentelemetry/api";

// Resolves through the global tracer provider: a no-op until tracing.ts (or a test) registers one.
export const tracer = trace.getTracer("service-scheduler");

// Pino mixin: adds the active span's trace ID to every log line, so logs and traces link up.
export function traceLogFields(): { trace_id?: string } {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext && isSpanContextValid(spanContext) ? { trace_id: spanContext.traceId } : {};
}
