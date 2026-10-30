import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

// Imported first by server.ts so HTTP is instrumented before Fastify loads. Tracing is off unless
// configured with the standard OpenTelemetry environment variables, so tests and plain
// local runs are unaffected:
//   OTEL_TRACES_EXPORTER=console            print spans to stdout (local simulation, no vendor)
//   OTEL_EXPORTER_OTLP_ENDPOINT + _HEADERS  send spans to a managed observability service (D11)
const enabled = Boolean(process.env.OTEL_TRACES_EXPORTER || process.env.OTEL_EXPORTER_OTLP_ENDPOINT);

export const tracingSdk = enabled
  ? new NodeSDK({ serviceName: "service-scheduler", instrumentations: [new HttpInstrumentation()] })
  : undefined;

tracingSdk?.start();
