"""Prometheus metrics for the RawClaw swarm worker."""

from __future__ import annotations

import os
from pathlib import Path

import psutil
from prometheus_client import Counter, Gauge, Histogram, start_http_server

worker_memory_bytes = Gauge(
    "rawclaw_worker_memory_bytes",
    "Current RSS memory usage of swarm worker process",
)
worker_memory_limit_bytes = Gauge(
    "rawclaw_worker_memory_limit_bytes",
    "Configured container memory limit",
)
jobs_processed_total = Counter(
    "rawclaw_worker_jobs_total",
    "Total jobs processed",
    ["status"],
)
job_duration_seconds = Histogram(
    "rawclaw_worker_job_duration_seconds",
    "Job processing duration",
    buckets=[0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0],
)
retrieval_rejected_total = Counter(
    "rawclaw_retrieval_rejected_total",
    "Chunks rejected by similarity floor",
    ["collection"],
)


def _read_cgroup_memory_limit() -> int:
    candidates = [
        Path("/sys/fs/cgroup/memory.max"),
        Path("/sys/fs/cgroup/memory/memory.limit_in_bytes"),
    ]
    for path in candidates:
        try:
            raw = path.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            continue
        if not raw or raw == "max":
            continue
        try:
            return int(raw)
        except ValueError:
            continue
    return 0


def update_memory_metrics() -> None:
    process = psutil.Process(os.getpid())
    worker_memory_bytes.set(process.memory_info().rss)
    limit = _read_cgroup_memory_limit()
    if limit:
        worker_memory_limit_bytes.set(limit)


def start_metrics_server(port: int = 9090) -> None:
    start_http_server(port)
