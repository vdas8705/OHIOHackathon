"""Fast job-link parsing: direct fetch + JSON-LD first, model web tools as fallback."""
import json

import httpx
import pytest

from app import llm as llm_mod
from app.config import get_settings
from app.llm import LLMError, LLMService

POSTING = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    "title": "Hardware Engineer",
    "hiringOrganization": {"@type": "Organization", "name": "Acme Robotics", "description": "<p>We build robots.</p>"},
    "description": "<p>Design <b>thermal</b> systems.</p><ul><li>Debug boards</li></ul>",
    "employmentType": "FULL_TIME",
}
JSONLD_PAGE = f"""<html><head><title>Job</title>
<script type="application/ld+json">{json.dumps({"@graph": [{"@type": "WebPage"}, POSTING]})}</script>
</head><body><div id="app"></div></body></html>"""
JS_ONLY_PAGE = "<html><head><title>Careers</title></head><body><div id='root'></div><script>app()</script></body></html>"


class FakeResp:
    def __init__(self, text, status=200):
        self.text, self.status_code = text, status

    def raise_for_status(self):
        if self.status_code >= 400:
            req = httpx.Request("GET", "https://x")
            raise httpx.HTTPStatusError("err", request=req, response=httpx.Response(self.status_code, request=req))


@pytest.fixture
def svc(monkeypatch):
    llm_mod._JOB_CACHE.clear()
    s = LLMService(get_settings())
    monkeypatch.setattr(s.settings, "llm_provider", "gemini")
    return s


def test_jsonld_page_parses_without_the_llm(svc, monkeypatch):
    calls = {"get": 0}

    def fake_get(*a, **k):
        calls["get"] += 1
        return FakeResp(JSONLD_PAGE)

    monkeypatch.setattr(httpx, "get", fake_get)
    monkeypatch.setattr(svc, "_chat_json", lambda *a, **k: (_ for _ in ()).throw(LLMError("down")))
    monkeypatch.setattr(svc, "_chat_gemini_with_url", lambda *a, **k: pytest.fail("slow web tool should not run"))

    out = svc.fetch_job("https://jobs.example.com/1")
    assert out["company"] == "Acme Robotics" and out["job_title"] == "Hardware Engineer"
    assert "Design" in out["job_description"] and "Debug boards" in out["job_description"]
    assert out["company_info"] == "We build robots."
    # Second request for the same link is served from the cache.
    assert svc.fetch_job("https://jobs.example.com/1") == out and calls["get"] == 1


def test_js_only_page_falls_back_to_web_tool(svc, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: FakeResp(JS_ONLY_PAGE))
    monkeypatch.setattr(
        svc, "_chat_gemini_with_url",
        lambda *a, **k: json.dumps({"company": "Acme", "job_title": "Eng", "job_description": "Do things", "company_info": ""}),
    )
    out = svc.fetch_job("https://careers.example.com/js")
    assert out["company"] == "Acme" and out["job_description"] == "Do things"


def test_blocked_domain_skips_direct_fetch(svc, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: pytest.fail("direct fetch should be skipped"))
    monkeypatch.setattr(
        svc, "_chat_gemini_with_url",
        lambda *a, **k: json.dumps({"company": "L", "job_title": "T", "job_description": "D", "company_info": ""}),
    )
    assert svc.fetch_job("https://www.linkedin.com/jobs/view/1")["company"] == "L"
