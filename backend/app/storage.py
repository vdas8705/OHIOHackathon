"""Persistent session history using SQLite.

Stores a completed session's summary and its full performance report so a user
can revisit it after the backend restarts. This is a LOCAL, SINGLE-USER MVP
feature: there is no authentication, so the history endpoint is not safe for a
shared multi-user deployment. See README for this limitation.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Optional

_DB_PATH = os.getenv(
    "BRANCHPOINT_DB",
    os.path.join(os.path.dirname(__file__), "..", "branchpoint.db"),
)


class HistoryStore:
    """Thread-safe SQLite store for completed interview sessions."""

    def __init__(self, path: str = _DB_PATH) -> None:
        self.path = os.path.abspath(path)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id      TEXT PRIMARY KEY,
                    company         TEXT NOT NULL,
                    job_title       TEXT NOT NULL,
                    job_description TEXT NOT NULL,
                    scenario_title  TEXT NOT NULL,
                    is_demo         INTEGER NOT NULL,
                    completion_status TEXT NOT NULL,
                    rounds_completed  INTEGER NOT NULL,
                    active_seconds    INTEGER NOT NULL,
                    overall_score     INTEGER,
                    schema_version    INTEGER NOT NULL DEFAULT 2,
                    created_at        TEXT NOT NULL,
                    report_json       TEXT NOT NULL,
                    conversation_json TEXT NOT NULL,
                    walkthrough_json  TEXT
                )
                """
            )
            # Older databases predate the walkthrough column.
            cols = {r["name"] for r in self._conn.execute("PRAGMA table_info(sessions)")}
            if "walkthrough_json" not in cols:
                self._conn.execute("ALTER TABLE sessions ADD COLUMN walkthrough_json TEXT")
            self._conn.commit()

    def save_session(
        self,
        *,
        session_id: str,
        company: str,
        job_title: str,
        job_description: str,
        scenario_title: str,
        is_demo: bool,
        completion_status: str,
        rounds_completed: int,
        active_seconds: int,
        overall_score: Optional[int],
        schema_version: int,
        report: dict,
        conversation: list,
    ) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO sessions (
                    session_id, company, job_title, job_description, scenario_title,
                    is_demo, completion_status, rounds_completed, active_seconds,
                    overall_score, schema_version, created_at, report_json, conversation_json
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(session_id) DO UPDATE SET
                    completion_status=excluded.completion_status,
                    rounds_completed=excluded.rounds_completed,
                    active_seconds=excluded.active_seconds,
                    overall_score=excluded.overall_score,
                    schema_version=excluded.schema_version,
                    report_json=excluded.report_json,
                    conversation_json=excluded.conversation_json
                """,
                (
                    session_id,
                    company,
                    job_title,
                    job_description,
                    scenario_title,
                    1 if is_demo else 0,
                    completion_status,
                    rounds_completed,
                    active_seconds,
                    overall_score,
                    schema_version,
                    datetime.now(timezone.utc).isoformat(),
                    json.dumps(report),
                    json.dumps(conversation),
                ),
            )
            self._conn.commit()

    def list_sessions(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT session_id, company, job_title, scenario_title, is_demo,
                       completion_status, rounds_completed, active_seconds,
                       overall_score, schema_version, created_at
                FROM sessions ORDER BY created_at DESC
                """
            ).fetchall()
        return [self._summary_row(r) for r in rows]

    def get_session(self, session_id: str) -> Optional[dict]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
        if row is None:
            return None
        data = self._summary_row(row)
        data["report"] = json.loads(row["report_json"])
        data["conversation"] = json.loads(row["conversation_json"])
        data["walkthrough"] = (
            json.loads(row["walkthrough_json"]) if row["walkthrough_json"] else None
        )
        return data

    def get_report(self, session_id: str) -> Optional[dict]:
        with self._lock:
            row = self._conn.execute(
                "SELECT report_json, job_title FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        if row is None:
            return None
        return {"report": json.loads(row["report_json"]), "job_title": row["job_title"]}

    def get_walkthrough(self, session_id: str) -> Optional[dict]:
        with self._lock:
            row = self._conn.execute(
                "SELECT walkthrough_json FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
        if row is None or not row["walkthrough_json"]:
            return None
        return json.loads(row["walkthrough_json"])

    def save_walkthrough(self, session_id: str, walkthrough: dict) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE sessions SET walkthrough_json = ? WHERE session_id = ?",
                (json.dumps(walkthrough), session_id),
            )
            self._conn.commit()

    def get_all_reports(self) -> list[dict]:
        """Return (summary + full report) for every completed session.

        Used for cross-session trend analysis.
        """
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM sessions ORDER BY created_at ASC"
            ).fetchall()
        out = []
        for r in rows:
            d = self._summary_row(r)
            d["report"] = json.loads(r["report_json"])
            out.append(d)
        return out

    @staticmethod
    def _summary_row(r: sqlite3.Row) -> dict:
        return {
            "session_id": r["session_id"],
            "company": r["company"],
            "job_title": r["job_title"],
            "scenario_title": r["scenario_title"],
            "is_demo": bool(r["is_demo"]),
            "completion_status": r["completion_status"],
            "rounds_completed": r["rounds_completed"],
            "active_seconds": r["active_seconds"],
            "overall_score": r["overall_score"],
            "schema_version": r["schema_version"],
            "created_at": r["created_at"],
        }

    def close(self) -> None:
        with self._lock:
            self._conn.close()
