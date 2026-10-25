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
# Voice delivery metrics (measured in the browser from speech recognition).
# Coaching only: never part of the score.
# --------------------------------------------------------------------------- #
class DeliveryMetrics(BaseModel):
    voice_words: int = Field(default=0, ge=0, le=20000)
    speaking_seconds: float = Field(default=0, ge=0, le=3600)
    wpm: Optional[int] = Field(default=None, ge=0, le=600)
    filler_count: int = Field(default=0, ge=0, le=5000)
    fillers: dict[str, int] = Field(default_factory=dict)
    hedge_count: int = Field(default=0, ge=0, le=5000)
    hedges: dict[str, int] = Field(default_factory=dict)
    long_pauses: int = Field(default=0, ge=0, le=1000)

    @field_validator("fillers", "hedges")
    @classmethod
    def _small_dict(cls, v: dict[str, int]) -> dict[str, int]:
        return {str(k)[:30]: max(0, int(c)) for k, c in list(v.items())[:20]}


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
    classification: Optional["QuestionClassification"] = None
    # Clarifying exchanges within this round: [{"question":..,"answer":..}]
    clarifications: list[dict] = Field(default_factory=list)
    # Seconds the candidate kept working after this section's timer hit zero.
    overtime_seconds: int = 0
    delivery: Optional[DeliveryMetrics] = None


# --------------------------------------------------------------------------- #
# Question taxonomy (controlled vocabulary for classification)
# --------------------------------------------------------------------------- #
QUESTION_TYPES: tuple[str, ...] = (
    "Technical troubleshooting",
    "System design and architecture",
    "Analytical problem-solving",
    "Decision-making and prioritization",
    "Risk assessment",
    "Adaptability and unexpected complications",
    "Communication and stakeholder management",
    "Behavioral and teamwork",
    "Ethical and professional judgment",
    "Role-specific technical knowledge",
)


def normalize_question_type(value: str) -> Optional[str]:
    """Match a (possibly messy) LLM label to the controlled vocabulary."""
    if not value:
        return None
    v = value.strip().lower()
    for canonical in QUESTION_TYPES:
        if v == canonical.lower():
            return canonical
    # Loose contains-match as a fallback.
    for canonical in QUESTION_TYPES:
        key = canonical.lower().split(" and ")[0]
        if key in v or v in canonical.lower():
            return canonical
    return None


class QuestionClassification(BaseModel):
    """Controlled classification of a single interview question."""
    primary_type: str
    secondary_types: list[str] = Field(default_factory=list)
    competencies: list[str] = Field(default_factory=list)


class QuestionPerformance(BaseModel):
    """Per-question performance indicator used ONLY for weakness detection.

    This is NOT part of the weighted 100-point score. `indicator` is a
    normalized 0-100 value describing how well this specific answer handled
    the dimensions relevant to its question type.
    """
    question_id: str
    round_number: int
    question: str
    question_type: str
    secondary_types: list[str] = Field(default_factory=list)
    competencies: list[str] = Field(default_factory=list)
    indicator: int = Field(ge=0, le=100)
    evidence: list[str] = Field(default_factory=list)
    mistakes: list[str] = Field(default_factory=list)
    improvement_advice: str = ""


class QuestionTypeStat(BaseModel):
    """Aggregated performance for one primary question type in a session."""
    question_type: str
    count: int
    average_indicator: int
    common_mistakes: list[str] = Field(default_factory=list)
    suggested_improvement: str = ""


class Weakness(BaseModel):
    """A weakness or observation detected within a single session."""
    label: str
    # "observed" = supported by evidence; "potential" = possible but not
    # confidently established (e.g. only one question of this type).
    kind: Literal["observed", "potential"] = "observed"
    category: str = ""  # competency or question type it relates to
    evidence: list[str] = Field(default_factory=list)
    detail: str = ""


class PracticeRecommendation(BaseModel):
    weakness: str
    evidence: str = ""
    recommendation: str


# --------------------------------------------------------------------------- #
# Evaluation / report
# --------------------------------------------------------------------------- #
class CategoryScore(BaseModel):
    name: str
    score: int  # final, after any overtime deduction
    max_score: int
    explanation: str
    evidence: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    # This category's share of the session's overtime deductions (by weight).
    overtime_deduction: int = 0


class RoundReport(BaseModel):
    round_number: int
    question: str
    response: str
    consequence: str
    analysis: str
    timed_out: bool = False
    # Classification + grounded, non-binary feedback for this round.
    question_type: str = ""
    secondary_types: list[str] = Field(default_factory=list)
    competencies: list[str] = Field(default_factory=list)
    what_went_well: str = ""
    what_was_missed: str = ""
    stronger_approach: str = ""
    why_it_mattered: str = ""
    # Qualitative, non-binary label.
    performance_level: Literal["Strong", "Developing", "Needs Improvement", "Not attempted"] = (
        "Developing"
    )
    clarifications: list[dict] = Field(default_factory=list)
    # Section score + overtime (each question is a timed section worth an
    # equal share of the 100 points; see overtime.py).
    section_points_possible: int = 0
    section_points_before_overtime: int = 0
    section_points: int = 0  # final
    overtime_seconds: int = 0
    overtime_tier: int = 0  # 0 = on time
    overtime_penalty_pct: int = 0
    overtime_deduction: int = 0
    # Voice delivery for this answer (None if it was typed).
    delivery: Optional[DeliveryMetrics] = None
    # For the "what if" decision map: the scenario state after this round, and
    # what a strong / weak / incomplete answer leads to here.
    environment_after: Optional[dict] = None
    alternative_outcomes: dict[str, str] = Field(default_factory=dict)


class PerformanceReport(BaseModel):
    # Schema version lets the frontend render legacy reports safely.
    schema_version: int = 2
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
    # --- new: classification, weakness detection, recommendations ---
    question_performance: list[QuestionPerformance] = Field(default_factory=list)
    question_type_stats: list[QuestionTypeStat] = Field(default_factory=list)
    weaknesses: list[Weakness] = Field(default_factory=list)
    practice_recommendations: list[PracticeRecommendation] = Field(default_factory=list)
    # --- overtime ---
    overall_score_before_overtime: Optional[int] = None
    overtime_points_lost: int = 0
    overtime_tiers: list[dict] = Field(default_factory=list)
    # --- voice delivery coaching (None when every answer was typed) ---
    delivery_summary: Optional[dict] = None


class QuestionReview(BaseModel):
    round_number: int
    question: str
    user_answer: str
    correctness: Literal["correct", "partly_correct", "incorrect"]
    what_did_well: str
    what_missed: str
    better_approach: str
    explanation: str


class SessionReview(BaseModel):
    score: int  # number correct out of 5
    total: int = TOTAL_ROUNDS
    summary: str
    question_reviews: list[QuestionReview]
    tips: list[str]
    is_demo: bool = False


# --------------------------------------------------------------------------- #
# Spoken results walkthrough (derived from the saved PerformanceReport)
# --------------------------------------------------------------------------- #
WalkthroughCorrectness = Literal["correct", "partly_correct", "incorrect"]


class WalkthroughQuestion(BaseModel):
    round_number: int
    correctness: WalkthroughCorrectness
    performance_level: str  # the report's label, shown alongside correctness
    question: str
    spoken: str  # written for listening; also shown verbatim as text


class WalkthroughFollowup(BaseModel):
    round_number: int
    question: str
    answer: str


class Walkthrough(BaseModel):
    version: int = 1
    generated_by: Literal["llm", "template"] = "template"
    viewed: bool = False
    overall_score: int
    max_score: int = 100
    intro: str
    questions: list[WalkthroughQuestion]
    wrap_up: str
    focus_points: list[str] = Field(default_factory=list)
    followups: list[WalkthroughFollowup] = Field(default_factory=list)


class WalkthroughAskRequest(BaseModel):
    round_number: int = Field(ge=1, le=TOTAL_ROUNDS)
    question: str = Field(min_length=1, max_length=1000)


class WalkthroughAskResponse(BaseModel):
    answer: str


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
    # Time past this section's limit before the first submit (excludes
    # clarifications and the answer-confirmation step).
    overtime_seconds: int = Field(default=0, ge=0, le=3600)
    delivery: Optional[DeliveryMetrics] = None


class InterpretRequest(BaseModel):
    round_number: int = Field(ge=1, le=TOTAL_ROUNDS)
    response: str = Field(default="", max_length=10000)


class InterpretResponse(BaseModel):
    interpretation: str
    clarifications_used: int = 0
    max_clarifications: int = 2


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
    # Scaled overtime tiers for this section's limit (see overtime.py).
    overtime_tiers: list[dict] = Field(default_factory=list)


class ClarifyResponse(BaseModel):
    answer: str
    clarifications_used_this_round: int
    max_clarifications_per_round: int = MAX_CLARIFICATIONS_PER_ROUND


class RespondResponse(BaseModel):
    state: SimulationStateResponse


# Resolve forward references (DecisionRecord -> QuestionClassification).
DecisionRecord.model_rebuild()
