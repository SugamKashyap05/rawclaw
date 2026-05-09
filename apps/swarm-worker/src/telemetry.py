"""OpenTelemetry bootstrap for the RawClaw swarm worker."""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("rawclaw.swarm_worker.telemetry")


def setup_telemetry(service_name: str):
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.redis import RedisInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except Exception as error:  # pragma: no cover
        logger.warning("telemetry_unavailable service=%s error=%s", service_name, error)
        return None

    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": service_name,
                "service.version": os.getenv("APP_VERSION", "dev"),
                "deployment.environment": os.getenv("ENVIRONMENT", "development"),
            }
        )
    )
    exporter = OTLPSpanExporter(
        endpoint=os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://jaeger:4317"),
        insecure=True,
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    RedisInstrumentor().instrument()
    logger.info("telemetry_initialized service=%s", service_name)
    return trace.get_tracer(service_name)
