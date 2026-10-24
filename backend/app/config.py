"""Runtime configuration loaded from environment variables."""
from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv

# Load backend/.env if present (does not override real environment variables).
load_dotenv()


class Settings:
    """Application settings sourced from the environment."""

    def __init__(self) -> None:
        self.llm_provider: str = os.getenv("LLM_PROVIDER", "openai").strip().lower()

        # Anthropic
        self.anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "").strip()
        self.anthropic_model: str = os.getenv(
            "ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022"
        ).strip()

        # OpenAI / OpenAI-compatible
        self.openai_api_key: str = os.getenv("OPENAI_API_KEY", "").strip()
        self.openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
        self.openai_base_url: str = os.getenv(
            "OPENAI_BASE_URL", "https://api.openai.com/v1"
        ).strip().rstrip("/")

        self.llm_timeout_seconds: float = float(os.getenv("LLM_TIMEOUT_SECONDS", "45"))
        self.llm_max_retries: int = int(os.getenv("LLM_MAX_RETRIES", "2"))
        raw_origins = os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        )
        self.cors_origins: list[str] = [
            o.strip() for o in raw_origins.split(",") if o.strip()
        ]

    @property
    def demo_mode(self) -> bool:
        """True when no live AI is configured; the app uses the demo engine."""
        if self.llm_provider == "demo":
            return True
        if self.llm_provider == "anthropic":
            return not bool(self.anthropic_api_key)
        return not bool(self.openai_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
