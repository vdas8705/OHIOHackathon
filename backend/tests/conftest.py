"""Pytest configuration: isolate side effects from the real app.

Force demo mode and route the history DB to a temp file so importing the
FastAPI app during tests never touches the developer's real branchpoint.db.
"""
import os
import tempfile

# Must be set BEFORE app modules import and read settings / open the DB.
os.environ.setdefault("LLM_PROVIDER", "demo")
os.environ.setdefault("OPENAI_API_KEY", "")
_tmp_db = os.path.join(tempfile.gettempdir(), "branchpoint_test.db")
os.environ.setdefault("BRANCHPOINT_DB", _tmp_db)
