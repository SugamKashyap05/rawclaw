from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from src.config import settings
from src.research.types import AdaptiveDomainProfile, AdaptiveFailureRecord


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AdaptiveResearchStore:
    def __init__(self, db_path: Optional[str] = None) -> None:
        configured = db_path or str(Path(settings.SQLITE_CHECKPOINTER_PATH).with_name("adaptive_research.db"))
        self._db_path = Path(configured)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    @property
    def db_path(self) -> str:
        return str(self._db_path)

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self._db_path))

    def _init_db(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS trusted_sources (
                    domain TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    success_count INTEGER NOT NULL DEFAULT 0,
                    last_success_at TEXT,
                    PRIMARY KEY(domain, source_url)
                );
                CREATE TABLE IF NOT EXISTS domain_success_history (
                    domain TEXT PRIMARY KEY,
                    preferred_transport_strategy TEXT,
                    preferred_extract_backend TEXT,
                    success_count INTEGER NOT NULL DEFAULT 0,
                    failure_count INTEGER NOT NULL DEFAULT 0,
                    last_success_at TEXT,
                    last_failure_at TEXT
                );
                CREATE TABLE IF NOT EXISTS extraction_patterns (
                    domain TEXT PRIMARY KEY,
                    page_kind TEXT,
                    backend_order_json TEXT,
                    successful_backend TEXT,
                    updated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS failure_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    domain TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    failure_kind TEXT NOT NULL,
                    url TEXT,
                    transport_strategy TEXT,
                    details TEXT,
                    created_at TEXT NOT NULL
                );
                """
            )

    def _normalize_domain(self, url_or_domain: str) -> str:
        parsed = urlparse(url_or_domain)
        hostname = parsed.hostname or url_or_domain
        return str(hostname or "").lower().strip()

    def get_domain_profile(self, url_or_domain: str) -> AdaptiveDomainProfile:
        domain = self._normalize_domain(url_or_domain)
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT preferred_transport_strategy, preferred_extract_backend, success_count,
                       failure_count, last_success_at, last_failure_at
                FROM domain_success_history
                WHERE domain = ?
                """,
                (domain,),
            ).fetchone()
            trusted = conn.execute(
                """
                SELECT source_url FROM trusted_sources
                WHERE domain = ?
                ORDER BY success_count DESC, last_success_at DESC
                LIMIT 5
                """,
                (domain,),
            ).fetchall()
        if not row:
            return AdaptiveDomainProfile(domain=domain)
        return AdaptiveDomainProfile(
            domain=domain,
            preferred_transport_strategy=row[0],
            preferred_extract_backend=row[1],
            success_count=int(row[2] or 0),
            failure_count=int(row[3] or 0),
            trusted_sources=[str(item[0]) for item in trusted],
            last_success_at=row[4],
            last_failure_at=row[5],
        )

    def record_trusted_source(self, url: str) -> None:
        domain = self._normalize_domain(url)
        if not domain or not url:
            return
        now = _utc_now()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO trusted_sources(domain, source_url, success_count, last_success_at)
                VALUES(?, ?, 1, ?)
                ON CONFLICT(domain, source_url) DO UPDATE SET
                    success_count = success_count + 1,
                    last_success_at = excluded.last_success_at
                """,
                (domain, url, now),
            )

    def record_fetch_success(self, url: str, transport_strategy: Optional[str]) -> None:
        domain = self._normalize_domain(url)
        if not domain:
            return
        now = _utc_now()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO domain_success_history(domain, preferred_transport_strategy, success_count, failure_count, last_success_at, last_failure_at)
                VALUES(?, ?, 1, 0, ?, NULL)
                ON CONFLICT(domain) DO UPDATE SET
                    preferred_transport_strategy = excluded.preferred_transport_strategy,
                    success_count = domain_success_history.success_count + 1,
                    last_success_at = excluded.last_success_at
                """,
                (domain, transport_strategy, now),
            )

    def record_extract_success(
        self,
        url: str,
        page_kind: str,
        backend_order: List[str],
        successful_backend: Optional[str],
    ) -> None:
        domain = self._normalize_domain(url)
        if not domain:
            return
        now = _utc_now()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO extraction_patterns(domain, page_kind, backend_order_json, successful_backend, updated_at)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(domain) DO UPDATE SET
                    page_kind = excluded.page_kind,
                    backend_order_json = excluded.backend_order_json,
                    successful_backend = excluded.successful_backend,
                    updated_at = excluded.updated_at
                """,
                (domain, page_kind, json.dumps(backend_order), successful_backend, now),
            )
            conn.execute(
                """
                INSERT INTO domain_success_history(domain, preferred_extract_backend, success_count, failure_count, last_success_at, last_failure_at)
                VALUES(?, ?, 1, 0, ?, NULL)
                ON CONFLICT(domain) DO UPDATE SET
                    preferred_extract_backend = excluded.preferred_extract_backend,
                    success_count = domain_success_history.success_count + 1,
                    last_success_at = excluded.last_success_at
                """,
                (domain, successful_backend, now),
            )

    def record_failure(
        self,
        *,
        url: str,
        stage: str,
        failure_kind: str,
        transport_strategy: Optional[str] = None,
        details: Optional[str] = None,
    ) -> AdaptiveFailureRecord:
        domain = self._normalize_domain(url)
        now = _utc_now()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO failure_logs(domain, stage, failure_kind, url, transport_strategy, details, created_at)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                """,
                (domain, stage, failure_kind, url, transport_strategy, details, now),
            )
            conn.execute(
                """
                INSERT INTO domain_success_history(domain, success_count, failure_count, last_success_at, last_failure_at)
                VALUES(?, 0, 1, NULL, ?)
                ON CONFLICT(domain) DO UPDATE SET
                    failure_count = domain_success_history.failure_count + 1,
                    last_failure_at = excluded.last_failure_at
                """,
                (domain, now),
            )
        return AdaptiveFailureRecord(
            domain=domain,
            stage=stage,
            failure_kind=failure_kind,
            url=url,
            transport_strategy=transport_strategy,
            details=details,
            created_at=now,
        )

    def recent_failures(self, url_or_domain: str, limit: int = 10) -> List[AdaptiveFailureRecord]:
        domain = self._normalize_domain(url_or_domain)
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT domain, stage, failure_kind, url, transport_strategy, details, created_at
                FROM failure_logs
                WHERE domain = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (domain, limit),
            ).fetchall()
        return [
            AdaptiveFailureRecord(
                domain=str(row[0]),
                stage=str(row[1]),
                failure_kind=str(row[2]),
                url=str(row[3] or ""),
                transport_strategy=row[4],
                details=row[5],
                created_at=str(row[6]),
            )
            for row in rows
        ]

    def extract_pattern(self, url_or_domain: str) -> Dict[str, Any]:
        domain = self._normalize_domain(url_or_domain)
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT page_kind, backend_order_json, successful_backend, updated_at
                FROM extraction_patterns
                WHERE domain = ?
                """,
                (domain,),
            ).fetchone()
        if not row:
            return {}
        backend_order = []
        try:
            backend_order = json.loads(row[1] or "[]")
        except Exception:
            backend_order = []
        return {
            "page_kind": row[0],
            "backend_order": backend_order,
            "successful_backend": row[2],
            "updated_at": row[3],
        }

    def diagnostics(self, url_or_domain: str) -> Dict[str, Any]:
        profile = self.get_domain_profile(url_or_domain)
        return {
            "profile": profile.model_dump(),
            "pattern": self.extract_pattern(url_or_domain),
            "recentFailures": [record.model_dump() for record in self.recent_failures(url_or_domain, limit=10)],
        }
