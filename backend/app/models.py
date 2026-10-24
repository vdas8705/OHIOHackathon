"""Pydantic models: API contracts, scenario blueprint, and session state."""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# --------------------------------------------------------------------------- #
# Constants controlling the deterministic simulation.
# --------------------------------------------------------------------------- #
TOTAL_ROUNDS = 5
RESPONSE_SECONDS_PER_ROUND = 90
MAX_ACTIVE_SECONDS = 10 * 60  # 10 minutes of cumulative active response time
MAX_CLARIFICATIONS_PER_ROUND = 2


# --------------------------------------------------------------------------- #
# Enums
# --------------------------------------------------------------------------- #
class CompletionStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    TIMED_OUT = "timed_out"
    ENDED_EARLY = "ended_early"


# --------------------------------------------------------------------------- #
# Scenario blueprint (produced by the LLM, validated here).
# --------------------------------------------------------------------------- #
class NarrativeStage(BaseModel):
    round_number: int = Field(ge=1, le=TOTAL_ROUNDS)
    focus: str
    development: str
    question: str


class ConsequenceGuide(BaseModel):
    strong: str
    weak: str
    incomplete: str


class EnvironmentState(BaseModel):
    technical_stability: int = Field(default=70, ge=0, le=100)
    risk_level: int = Field(default=40, ge=0, le=100)
    stakeholder_confidence: int = Field(default=60, ge=0, le=100)
    progress: int = Field(default=10, ge=0, le=100)

    def clamped(self) -> "EnvironmentState":
        return EnvironmentState(
            technical_stability=max(0, min(100, self.technical_stability)),
            risk_level=max(0, min(100, self.risk_level)),
            stakeholder_confidence=max(0, min(100, self.stakeholder_confidence)),
            progress=max(0, min(100, self.progress)),
        )


class ScenarioBlueprint(BaseModel):
    scenario_title: str
    target_role: str
    challenge_summary: str
    competencies: list[str] = Field(default_factory=list)
    initial_context: str
    stakeholders: list[str] = Field(default_factory=list)
    ground_truth_facts: list[str] = Field(default_factory=list)
    initial_environment: EnvironmentState = Field(default_factory=EnvironmentState)
    stages: list[NarrativeStage]
    consequences: ConsequenceGuide
    evaluation_guidance: str = ""

    @field_validator("stages")
    @classmethod
    def _five_stages(cls, v: list[NarrativeStage]) -> list[NarrativeStage]:
        if len(v) != TOTAL_ROUNDS:
            raise ValueError(f"Scenario must contain exactly {TOTAL_ROUNDS} stages")
        return v


# --------------------------------------------------------------------------- #
# Response analysis & state transition (LLM proposes, backend validates).
# --------------------------------------------------------------------------- #
class ResponseAnalysis(BaseModel):
    proposed_action: str = ""
    supporting_reasoning: str = ""
    assumptions: list[str] = Field(default_factory=list)
    risks_addressed: list[str] = Field(default_factory=list)
    information_requested: list[str] = Field(default_factory=list)
    technical_considerations: list[str] = Field(default_factory=list)
    quality: Literal["strong", "weak", "incomplete"] = "incomplete"


class StateDelta(BaseModel):
    technical_stability: int = 0
    risk_level: int = 0
    stakeholder_confidence: int = 0
    progress: int = 0

    @field_validator(
        "technical_stability",
        "risk_level",
        "stakeholder_confidence",
        "progress",
    )
    @classmethod
    def _bounded_delta(cls, v: int) -> int:
        # Clamp any single transition to a believable range.
        return max(-40, min(40, int(v)))


class InterviewerTurn(BaseModel):
    """A candidate-facing interviewer message for a round."""
    round_number: int
    development: str
    question: str

    @property
    def spoken_text(self) -> str:
        dev = self.development.strip()
        q = self.question.strip()
        if dev and q:
            return f"{dev} {q}"
        return dev or q


# --------------------------------------------------------------------------- #
# Conversation + decision history
# --------------------------------------------------------------------------- #
class ConversationEntry(BaseModel):
    role: Literal["interviewer", "candidate", "clarification_q", "clarification_a"]
    round_number: int
    text: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DecisionRecord(BaseModel):
    round_number: int
    question: str
    response: str
    timed_out: bool = False
    analysis: Optional[ResponseAnalysis] = None
    consequence: str = ""
    environment_after: Optional[EnvironmentState] = None


# --------------------------------------------------------------------------- #
# Evaluation / report
# --------------------------------------------------------------------------- #
class CategoryScore(BaseModel):
    name: str
    score: int
    max_score: int
    explanation: str
    evidence: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)


class RoundReport(BaseModel):
    round_number: int
    question: str
    response: str
    consequence: str
    analysis: str
    timed_out: bool = False


class PerformanceReport(BaseModel):
    overall_score: int
    max_score: int = 100
    completion_status: CompletionStatus
    completion_percentage: int
    rounds_attempted: int
    total_active_seconds: int
    categories: list[CategoryScore]
    summary: str
    strengths: list[str]
    improvements: list[str]
    missed_considerations: list[str]
    suggested_next_steps: list[str]
    overall_recommendation: str
    round_reports: list[RoundReport]
    is_demo: bool = False


# --------------------------------------------------------------------------- #
# API request / response contracts
# --------------------------------------------------------------------------- #
class FetchJobRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)


class FetchJobResponse(BaseModel):
    company: str
    job_title: str
    job_description: str
    company_info: str


class CreateSimulationRequest(BaseModel):
    company: str = Field(min_length=1, max_length=200)
    job_title: str = Field(min_length=1, max_length=200)
    job_description: str = Field(min_length=1, max_length=20000)
    company_info: str = Field(default="", max_length=10000)
    website_url: str = Field(default="", max_length=500)


class RespondRequest(BaseModel):
    round_number: int = Field(ge=1, le=TOTAL_ROUNDS)
    response: str = Field(default="", max_length=10000)
    timed_out: bool = False
    elapsed_active_seconds: int = Field(default=0, ge=0)


class ClarifyRequest(BaseModel):
    round_number: int = Field(ge=1, le=TOTAL_ROUNDS)
    question: str = Field(min_length=1, max_length=2000)


class PublicScenario(BaseModel):
    """Candidate-safe view of the scenario (no hidden facts / scoring)."""
    scenario_title: str
    target_role: str
    challenge_summary: str
    initial_context: str
    stakeholders: list[str]


class SimulationStateResponse(BaseModel):
    session_id: str
    company: str
    job_title: str
    scenario: PublicScenario
    current_round: int
    total_rounds: int = TOTAL_ROUNDS
    completion_status: CompletionStatus
    response_seconds_per_round: int = RESPONSE_SECONDS_PER_ROUND
    max_active_seconds: int = MAX_ACTIVE_SECONDS
    elapsed_active_seconds: int
    clarifications_used_this_round: int
    max_clarifications_per_round: int = MAX_CLARIFICATIONS_PER_ROUND
    current_turn: Optional[InterviewerTurn] = None
    is_demo: bool
    report_ready: bool


class ClarifyResponse(BaseModel):
    answer: str
    clarifications_used_this_round: int
    max_clarifications_per_round: int = MAX_CLARIFICATIONS_PER_ROUND


class RespondResponse(BaseModel):
    state: SimulationStateResponse
