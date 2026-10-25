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

# Session origin: how the record came to exist. Analytics exclude TEST_FIXTURE
# by default. UNKNOWN is used for pre-existing rows whose origin we cannot
# determine — we preserve them rather than guessing.
ORIGIN_USER_DEMO = "user_demo"        # real user, demo mode
ORIGIN_USER_LIVE = "user_live"        # real user, live AI
ORIGIN_TEST_FIXTURE = "test_fixture"  # synthetic (scripts / manual verification)
ORIGIN_UNKNOWN = "unknown"            # pre-existing, origin not recorded

VALID_ORIGINS = {
    ORIGIN_USER_DEMO,
    ORIGIN_USER_LIVE,
    ORIGIN_TEST_FIXTURE,
    ORIGIN_UNKNOWN,
}


class HistoryStore:
    """Thread-safe SQLite store for completed interview sessions."""

    def __init__(self, path: str = _DB_PATH) -> None:
        self.path = os.path.abspath(path)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()
        self._migrate()

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
            self._conn.commit()

    def _migrate(self) -> None:
        """Additive, non-destructive migrations. Never drops or edits user rows."""
        with self._lock:
            cols = {
                row["name"]
                for row in self._conn.execute("PRAGMA table_info(sessions)").fetchall()
            }
            if "origin" not in cols:
                # Existing rows predate origin tracking: label them 'unknown'
                # (preserve, don't guess or delete).
                self._conn.execute(
                    "ALTER TABLE sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'unknown'"
                )
                self._conn.commit()
            if "walkthrough_json" not in cols:
                # Older databases predate the saved results walkthrough.
                self._conn.execute("ALTER TABLE sessions ADD COLUMN walkthrough_json TEXT")
                self._conn.commit()
            if "decision_map_json" not in cols:
                # Older databases predate the saved "what if" decision map.
                self._conn.execute("ALTER TABLE sessions ADD COLUMN decision_map_json TEXT")
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
        origin: str = ORIGIN_UNKNOWN,
    ) -> None:
        if origin not in VALID_ORIGINS:
            origin = ORIGIN_UNKNOWN
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO sessions (
                    session_id, company, job_title, job_description, scenario_title,
                    is_demo, completion_status, rounds_completed, active_seconds,
                    overall_score, schema_version, created_at, report_json,
                    conversation_json, origin
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(session_id) DO UPDATE SET
                    completion_status=excluded.completion_status,
                    rounds_completed=excluded.rounds_completed,
                    active_seconds=excluded.active_seconds,
                    overall_score=excluded.overall_score,
                    schema_version=excluded.schema_version,
                    report_json=excluded.report_json,
                    conversation_json=excluded.conversation_json,
                    origin=excluded.origin
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
                    origin,
                ),
            )
            self._conn.commit()

    def list_sessions(self, include_fixtures: bool = False) -> list[dict]:
        """List sessions newest-first. Synthetic test fixtures are excluded
        unless explicitly requested."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM sessions ORDER BY created_at DESC"
            ).fetchall()
        result = []
        for r in rows:
            summary = self._summary_row(r)
            if not include_fixtures and summary["origin"] == ORIGIN_TEST_FIXTURE:
                continue
            result.append(summary)
        return result

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

    def get_decision_map(self, session_id: str) -> Optional[dict]:
        with self._lock:
            row = self._conn.execute(
                "SELECT decision_map_json FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
        if row is None or not row["decision_map_json"]:
            return None
        return json.loads(row["decision_map_json"])

    def save_decision_map(self, session_id: str, decision_map: dict) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE sessions SET decision_map_json = ? WHERE session_id = ?",
                (json.dumps(decision_map), session_id),
            )
            self._conn.commit()

    def save_walkthrough(self, session_id: str, walkthrough: dict) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE sessions SET walkthrough_json = ? WHERE session_id = ?",
                (json.dumps(walkthrough), session_id),
            )
            self._conn.commit()

    def get_all_reports(self, include_fixtures: bool = False) -> list[dict]:
        """Return (summary + full report) for every session, oldest-first.

        Synthetic test fixtures are excluded by default so analytics never
        silently include them as real user performance.
        """
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM sessions ORDER BY created_at ASC"
            ).fetchall()
        out = []
        for r in rows:
            d = self._summary_row(r)
            if not include_fixtures and d["origin"] == ORIGIN_TEST_FIXTURE:
                continue
            d["report"] = json.loads(r["report_json"])
            out.append(d)
        return out

    def delete_session(self, session_id: str) -> bool:
        """Delete a single session by id. Returns True if a row was removed."""
        with self._lock:
            cur = self._conn.execute(
                "DELETE FROM sessions WHERE session_id = ?", (session_id,)
            )
            self._conn.commit()
            return cur.rowcount > 0

    def clear_sessions(self, include_fixtures: bool = True) -> int:
        """Delete stored sessions. Returns the number of rows removed.

        Only touches the `sessions` table — never schema, config, or templates.
        """
        with self._lock:
            if include_fixtures:
                cur = self._conn.execute("DELETE FROM sessions")
            else:
                cur = self._conn.execute(
                    "DELETE FROM sessions WHERE origin != ?", (ORIGIN_TEST_FIXTURE,)
                )
            self._conn.commit()
            return cur.rowcount

    @staticmethod
    def _summary_row(r: sqlite3.Row) -> dict:
        # `origin` may be absent on rows read before migration in-process; the
        # migration adds it, but guard defensively.
        keys = r.keys()
        origin = r["origin"] if "origin" in keys else ORIGIN_UNKNOWN
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
            "origin": origin or ORIGIN_UNKNOWN,
        }

    def close(self) -> None:
        with self._lock:
            self._conn.close()
