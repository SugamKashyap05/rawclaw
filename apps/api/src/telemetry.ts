import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';

// ARCHITECTURE: initialize before Nest bootstrap so auto-instrumentation hooks
// are registered before controllers and HTTP clients are created.
export const otelSDK = new NodeSDK({
  serviceName: 'rawclaw-api',
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317',
  }),
  instrumentations: [
    new HttpInstrumentation(),
    new NestInstrumentation(),
  ],
});
