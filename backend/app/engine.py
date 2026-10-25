"""Deterministic simulation engine.

The backend — not the LLM — is the single source of truth for the round number,
timing, completion state, and all state transitions. The LLM may *propose*
narrative and deltas, but every value is validated and clamped here.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from . import demo_content as demo
from .config import Settings
from .llm import LLMError, LLMService
from .models import (
    MAX_ACTIVE_SECONDS,
    MAX_CLARIFICATIONS_PER_ROUND,
    RESPONSE_SECONDS_PER_ROUND,
    TOTAL_ROUNDS,
    CategoryScore,
    CompletionStatus,
    ConversationEntry,
    DecisionRecord,
    EnvironmentState,
    InterviewerTurn,
    PerformanceReport,
    QuestionReview,
    ResponseAnalysis,
    RoundReport,
    ScenarioBlueprint,
    SessionReview,
    StateDelta,
)

_CATEGORY_MAX = {
    "Technical reasoning": 30,
    "Decision-making and risk assessment": 25,
    "Adaptability": 20,
    "Communication and explanation": 15,
    "Clarifying questions and information gathering": 10,
}


class Session:
    """Authoritative in-memory simulation session."""

    def __init__(
        self,
        *,
        company: str,
        job_title: str,
        job_description: str,
        blueprint: ScenarioBlueprint,
        is_demo: bool,
    ) -> None:
        self.session_id = uuid.uuid4().hex
        self.company = company
        self.job_title = job_title
        self.job_description = job_description
        self.blueprint = blueprint
        self.is_demo = is_demo

        self.current_round = 1
        self.completed_rounds = 0
        self.environment = blueprint.initial_environment.clamped()
        self.decision_history: list[DecisionRecord] = []
        self.conversation_history: list[ConversationEntry] = []
        self.elapsed_active_seconds = 0
        self.clarifications_this_round = 0
        self.started_at = datetime.now(timezone.utc)
        self.completion_status = CompletionStatus.IN_PROGRESS
        self.final_report: Optional[PerformanceReport] = None

        # The interviewer turn currently presented to the candidate.
        self.current_turn: Optional[InterviewerTurn] = None

    # ---------------------------- helpers -------------------------------- #
    @property
    def is_active(self) -> bool:
        return self.completion_status == CompletionStatus.IN_PROGRESS

    @property
    def report_ready(self) -> bool:
        return self.final_report is not None

    def conversation_summary(self) -> str:
        lines = []
        for e in self.conversation_history:
            label = {
                "interviewer": "Interviewer",
                "candidate": "Candidate",
                "clarification_q": "Candidate (clarifying)",
                "clarification_a": "Interviewer (clarifying)",
            }[e.role]
            lines.append(f"[R{e.round_number}] {label}: {e.text}")
        return "\n".join(lines)

    def _apply_delta(self, delta: StateDelta) -> EnvironmentState:
        clamp = lambda v: max(0, min(100, v))
        self.environment = EnvironmentState(
            technical_stability=clamp(
                self.environment.technical_stability + delta.technical_stability
            ),
            risk_level=clamp(self.environment.risk_level + delta.risk_level),
            stakeholder_confidence=clamp(
                self.environment.stakeholder_confidence + delta.stakeholder_confidence
            ),
            progress=clamp(self.environment.progress + delta.progress),
        )
        return self.environment


class Engine:
    """Owns all sessions and drives the deterministic loop."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.llm = LLMService(settings)
        self.sessions: dict[str, Session] = {}

    @property
    def demo_mode(self) -> bool:
        return self.settings.demo_mode

    # --------------------------- creation -------------------------------- #
    def create_session(
        self,
        *,
        company: str,
        job_title: str,
        job_description: str,
        company_info: str,
    ) -> Session:
        is_demo = self.demo_mode
        blueprint: ScenarioBlueprint
        if is_demo:
            blueprint = demo.demo_blueprint()
        else:
            try:
                blueprint = self.llm.generate_scenario(
                    company, job_title, job_description, company_info
                )
            except (LLMError, Exception):
                # Fall back to the safe predefined blueprint; still live mode flag,
                # but the scenario is the demo one to keep the demo reliable.
                blueprint = demo.demo_blueprint()
                is_demo = True

        session = Session(
            company=company,
            job_title=job_title,
            job_description=job_description,
            blueprint=blueprint,
            is_demo=is_demo,
        )
        self.sessions[session.session_id] = session
        # Present round 1 immediately.
        session.current_turn = self._build_turn(session, 1, last_response="")
        session.conversation_history.append(
            ConversationEntry(
                role="interviewer",
                round_number=1,
                text=session.current_turn.spoken_text,
            )
        )
        return session

    def get(self, session_id: str) -> Optional[Session]:
        return self.sessions.get(session_id)

    # ------------------------- turn generation --------------------------- #
    def _build_turn(
        self, session: Session, round_number: int, last_response: str
    ) -> InterviewerTurn:
        if session.is_demo or not self.llm.available:
            return demo.demo_turn(session.blueprint, round_number)
        try:
            return self.llm.next_turn(
                session.blueprint,
                round_number,
                session.conversation_summary(),
                last_response,
            )
        except (LLMError, Exception):
            # Safe fallback to the authored stage.
            return demo.demo_turn(session.blueprint, round_number)

    # --------------------------- clarify --------------------------------- #
    def clarify(self, session: Session, round_number: int, question: str) -> tuple[str, int]:
        if not session.is_active:
            raise ValueError("Session is not active")
        if round_number != session.current_round:
            raise ValueError("Clarification must target the current round")
        if session.clarifications_this_round >= MAX_CLARIFICATIONS_PER_ROUND:
            answer = (
                "We've covered the clarifications for this round — please go ahead and give "
                "me your decision."
            )
            return answer, session.clarifications_this_round

        if session.is_demo or not self.llm.available:
            answer = demo.demo_clarification_answer(session.blueprint, question)
        else:
            try:
                answer = self.llm.clarify(session.blueprint, question)
            except (LLMError, Exception):
                answer = demo.demo_clarification_answer(session.blueprint, question)

        session.clarifications_this_round += 1
        session.conversation_history.append(
            ConversationEntry(
                role="clarification_q", round_number=round_number, text=question
            )
        )
        session.conversation_history.append(
            ConversationEntry(
                role="clarification_a", round_number=round_number, text=answer
            )
        )
        return answer, session.clarifications_this_round

    # --------------------------- respond --------------------------------- #
    def respond(
        self,
        session: Session,
        round_number: int,
        response: str,
        timed_out: bool,
        elapsed_active_seconds: int,
    ) -> Session:
        if not session.is_active:
            # Idempotent: return current state without advancing.
            return session
        # Prevent duplicate / out-of-order submissions.
        if round_number != session.current_round:
            raise ValueError(
                f"Expected a response for round {session.current_round}, got {round_number}"
            )

        # Trust the larger of client-reported and server-tracked time, capped per round.
        added = max(0, min(elapsed_active_seconds, RESPONSE_SECONDS_PER_ROUND))
        session.elapsed_active_seconds = min(
            MAX_ACTIVE_SECONDS, session.elapsed_active_seconds + added
        )

        question = session.current_turn.question if session.current_turn else ""

        # Record candidate response in conversation.
        session.conversation_history.append(
            ConversationEntry(
                role="candidate",
                round_number=round_number,
                text=response if response else "(no answer provided)",
            )
        )

        # Analyze + transition.
        analysis, delta, consequence = self._analyze(session, round_number, question, response)
        env_after = session._apply_delta(delta)

        session.decision_history.append(
            DecisionRecord(
                round_number=round_number,
                question=question,
                response=response,
                timed_out=timed_out,
                analysis=analysis,
                consequence=consequence,
                environment_after=env_after,
            )
        )
        session.completed_rounds = round_number

        # Deterministic termination checks (backend-owned).
        global_timeout = session.elapsed_active_seconds >= MAX_ACTIVE_SECONDS
        if round_number >= TOTAL_ROUNDS:
            session.completion_status = CompletionStatus.COMPLETED
            session.current_turn = None
            self._finalize(session)
            return session
        if global_timeout:
            session.completion_status = CompletionStatus.TIMED_OUT
            session.current_turn = None
            self._finalize(session)
            return session

        # Advance to the next round. NEVER beyond TOTAL_ROUNDS.
        session.current_round = round_number + 1
        session.clarifications_this_round = 0
        next_turn = self._build_turn(session, session.current_round, last_response=response)
        session.current_turn = next_turn
        session.conversation_history.append(
            ConversationEntry(
                role="interviewer",
                round_number=session.current_round,
                text=next_turn.spoken_text,
            )
        )
        return session

    def _analyze(
        self, session: Session, round_number: int, question: str, response: str
    ) -> tuple[ResponseAnalysis, StateDelta, str]:
        if session.is_demo or not self.llm.available:
            return self._demo_analyze(session, round_number, response)
        try:
            return self.llm.analyze_response(
                session.blueprint, round_number, question, response
            )
        except (LLMError, Exception):
            return self._demo_analyze(session, round_number, response)

    def _demo_analyze(
        self, session: Session, round_number: int, response: str
    ) -> tuple[ResponseAnalysis, StateDelta, str]:
        quality = self._heuristic_quality(response)
        consequence = demo.DEMO_CONSEQUENCES.get(round_number, {}).get(
            quality, session.blueprint.consequences.incomplete
        )
        if quality == "strong":
            delta = StateDelta(
                technical_stability=8,
                risk_level=-10,
                stakeholder_confidence=8,
                progress=18,
            )
        elif quality == "weak":
            delta = StateDelta(
                technical_stability=-5,
                risk_level=8,
                stakeholder_confidence=-6,
                progress=10,
            )
        else:
            delta = StateDelta(
                technical_stability=0, risk_level=3, stakeholder_confidence=-2, progress=8
            )
        analysis = ResponseAnalysis(
            proposed_action=(response[:160] if response else "No answer provided"),
            supporting_reasoning="",
            quality=quality,
        )
        return analysis, delta, consequence

    @staticmethod
    def _heuristic_quality(response: str) -> str:
        text = (response or "").strip()
        words = len(text.split())
        if words == 0:
            return "incomplete"
        signal_terms = (
            "because",
            "risk",
            "test",
            "validate",
            "hypothesis",
            "data",
            "stakeholder",
            "communicate",
            "assume",
            "verify",
            "compare",
            "isolate",
            "plan",
            "confirm",
            "trade",
        )
        hits = sum(1 for t in signal_terms if t in text.lower())
        if words >= 40 and hits >= 3:
            return "strong"
        if words >= 15 and hits >= 1:
            return "weak"
        return "incomplete"

    # --------------------------- finish ---------------------------------- #
    def finish_early(self, session: Session) -> Session:
        if not session.is_active:
            return session
        session.completion_status = CompletionStatus.ENDED_EARLY
        session.current_turn = None
        self._finalize(session)
        return session

    def _finalize(self, session: Session) -> None:
        if session.final_report is not None:
            return
        session.final_report = self._build_report(session)

    # ------------------------- evaluation -------------------------------- #
    def _build_report(self, session: Session) -> PerformanceReport:
        rounds_attempted = len(session.decision_history)
        completion_percentage = int(round(100 * rounds_attempted / TOTAL_ROUNDS))

        categories: list[CategoryScore]
        summary = ""
        strengths: list[str] = []
        improvements: list[str] = []
        missed: list[str] = []
        next_steps: list[str] = []
        recommendation = ""

        use_llm = (not session.is_demo) and self.llm.available and rounds_attempted > 0
        if use_llm:
            try:
                data = self.llm.evaluate(session.blueprint, self._transcript(session))
                categories = self._coerce_categories(data.get("categories", []))
                summary = str(data.get("summary", ""))
                strengths = [str(s) for s in data.get("strengths", [])][:3]
                improvements = [str(s) for s in data.get("improvements", [])][:3]
                missed = [str(s) for s in data.get("missed_considerations", [])]
                next_steps = [str(s) for s in data.get("suggested_next_steps", [])]
                recommendation = str(data.get("overall_recommendation", ""))
            except (LLMError, Exception):
                categories, summary, strengths, improvements, missed, next_steps, recommendation = (
                    self._heuristic_evaluation(session)
                )
        else:
            categories, summary, strengths, improvements, missed, next_steps, recommendation = (
                self._heuristic_evaluation(session)
            )

        # Backend computes the overall score as the sum of (clamped) category scores.
        overall = sum(c.score for c in categories)
        overall = max(0, min(100, overall))

        round_reports = [
            RoundReport(
                round_number=d.round_number,
                question=d.question,
                response=d.response or "(no answer provided)",
                consequence=d.consequence,
                analysis=(
                    d.analysis.supporting_reasoning
                    or f"Response classified as '{d.analysis.quality}'."
                    if d.analysis
                    else ""
                ),
                timed_out=d.timed_out,
            )
            for d in session.decision_history
        ]

        return PerformanceReport(
            overall_score=overall,
            completion_status=session.completion_status,
            completion_percentage=completion_percentage,
            rounds_attempted=rounds_attempted,
            total_active_seconds=session.elapsed_active_seconds,
            categories=categories,
            summary=summary,
            strengths=strengths,
            improvements=improvements,
            missed_considerations=missed,
            suggested_next_steps=next_steps,
            overall_recommendation=recommendation,
            round_reports=round_reports,
            is_demo=session.is_demo,
        )

    def _coerce_categories(self, raw: list) -> list[CategoryScore]:
        by_name: dict[str, CategoryScore] = {}
        for item in raw:
            try:
                c = CategoryScore.model_validate(item)
            except Exception:
                continue
            max_allowed = _CATEGORY_MAX.get(c.name)
            if max_allowed is None:
                continue
            c.max_score = max_allowed
            c.score = max(0, min(max_allowed, c.score))
            by_name[c.name] = c
        # Ensure all five categories exist.
        result = []
        for name, mx in _CATEGORY_MAX.items():
            if name in by_name:
                result.append(by_name[name])
            else:
                result.append(
                    CategoryScore(
                        name=name,
                        score=0,
                        max_score=mx,
                        explanation="Insufficient evidence to assess this category.",
                        evidence=[],
                        improvements=["Provide more detail in your responses."],
                    )
                )
        return result

    def _heuristic_evaluation(self, session: Session):
        """Deterministic, evidence-based scoring used in demo mode / fallback."""
        decisions = session.decision_history
        qualities = [d.analysis.quality if d.analysis else "incomplete" for d in decisions]
        strong = qualities.count("strong")
        weak = qualities.count("weak")
        attempted = len(decisions)

        # A per-round quality factor in 0..1.
        def quality_factor() -> float:
            if attempted == 0:
                return 0.0
            score_map = {"strong": 1.0, "weak": 0.55, "incomplete": 0.25}
            total = sum(score_map[q] for q in qualities)
            # Normalize over ALL five rounds so early exits score lower.
            return total / TOTAL_ROUNDS

        factor = quality_factor()

        def cat(name: str, mx: int, expl: str, improv: list[str]) -> CategoryScore:
            score = int(round(mx * factor))
            score = max(0, min(mx, score))
            evidence = [
                f"Round {d.round_number}: {(d.response or '(no answer)')[:140]}"
                for d in decisions
                if d.response
            ][:3]
            if not evidence:
                evidence = ["No substantive responses were recorded."]
            return CategoryScore(
                name=name,
                score=score,
                max_score=mx,
                explanation=expl,
                evidence=evidence,
                improvements=improv,
            )

        categories = [
            cat(
                "Technical reasoning",
                30,
                "Based on the technical signal and structure detected across your answers.",
                ["Show step-by-step reasoning and how you'd validate each step."],
            ),
            cat(
                "Decision-making and risk assessment",
                25,
                "Reflects how clearly you weighed options and addressed risk.",
                ["Explicitly state trade-offs and the risk of each option."],
            ),
            cat(
                "Adaptability",
                20,
                "Reflects how you incorporated new information across rounds.",
                ["React directly to new evidence introduced each round."],
            ),
            cat(
                "Communication and explanation",
                15,
                "Reflects clarity, organization, and conciseness of your explanations.",
                ["Lead with your recommendation, then support it briefly."],
            ),
            cat(
                "Clarifying questions and information gathering",
                10,
                "Reflects whether you sought the information you needed.",
                ["Ask targeted clarifying questions before committing."],
            ),
        ]

        if attempted == 0:
            summary = "No rounds were completed, so there is no demonstrated performance to assess."
        else:
            summary = (
                f"You attempted {attempted} of {TOTAL_ROUNDS} rounds. "
                f"{strong} response(s) showed strong structured reasoning and {weak} were "
                "partial. The score reflects demonstrated behavior only."
            )
        strengths = []
        if strong:
            strengths.append("Structured, hypothesis-driven reasoning in your stronger answers.")
        if any("stakeholder" in (d.response or "").lower() for d in decisions):
            strengths.append("Awareness of stakeholder communication.")
        if not strengths:
            strengths.append("Engaged with the scenario and provided answers.")

        improvements = [
            "Add more specific validation steps and expected results.",
            "Quantify risk and state trade-offs explicitly.",
        ]
        missed = [
            "Validating sensor data against an independent ground truth before trusting it.",
            "Isolating one variable at a time when multiple changes occurred.",
        ]
        next_steps = [
            "Practice narrating a debugging plan out loud in under 90 seconds.",
            "Rehearse giving a crisp risk-weighted recommendation to a stakeholder.",
        ]
        recommendation = (
            "Keep practicing structured situational responses that pair a clear decision with "
            "its validation and risk. This is practice feedback, not a prediction of hiring "
            "outcomes."
        )
        return categories, summary, strengths, improvements, missed, next_steps, recommendation

    def _transcript(self, session: Session) -> str:
        parts = [session.conversation_summary(), "\n--- DECISIONS ---"]
        for d in session.decision_history:
            parts.append(
                f"Round {d.round_number} Q: {d.question}\n"
                f"Response: {d.response or '(no answer)'}"
                + (" [TIMED OUT]" if d.timed_out else "")
            )
        return "\n".join(parts)

    # --------------------------- review --------------------------------- #
    def generate_review(self, session: Session) -> SessionReview:
        """Generate a per-question review using the LLM, with heuristic fallback."""
        use_llm = (not session.is_demo) and self.llm.available and len(session.decision_history) > 0
        if use_llm:
            try:
                data = self.llm.generate_review(session.blueprint, self._transcript(session))
                return self._coerce_review(data, session)
            except (LLMError, Exception):
                pass
        return self._heuristic_review(session)

    def _coerce_review(self, data: dict, session: Session) -> SessionReview:
        quality_map = {"correct": "correct", "partly_correct": "partly_correct", "incorrect": "incorrect"}
        question_reviews = []
        for d in session.decision_history:
            # Find matching review from LLM data
            qr_data = next(
                (q for q in data.get("question_reviews", []) if q.get("round_number") == d.round_number),
                {},
            )
            correctness = qr_data.get("correctness", "incorrect")
            if correctness not in quality_map:
                correctness = "incorrect"
            question_reviews.append(QuestionReview(
                round_number=d.round_number,
                question=d.question,
                user_answer=d.response or "(no answer provided)",
                correctness=quality_map[correctness],
                what_did_well=str(qr_data.get("what_did_well", "")),
                what_missed=str(qr_data.get("what_missed", "")),
                better_approach=str(qr_data.get("better_approach", "")),
                explanation=str(qr_data.get("explanation", "")),
            ))
        return SessionReview(
            score=int(data.get("score", sum(1 for q in question_reviews if q.correctness == "correct"))),
            total=TOTAL_ROUNDS,
            summary=str(data.get("summary", "")),
            question_reviews=question_reviews,
            tips=[str(t) for t in data.get("tips", [])][:3],
            is_demo=session.is_demo,
        )

    def _heuristic_review(self, session: Session) -> SessionReview:
        """Deterministic per-question review used in demo mode / fallback."""
        quality_to_correctness = {"strong": "correct", "weak": "partly_correct", "incomplete": "incorrect"}
        question_reviews = []
        for d in session.decision_history:
            q = d.analysis.quality if d.analysis else "incomplete"
            correctness = quality_to_correctness.get(q, "incorrect")
            if correctness == "correct":
                did_well = "Your answer showed strong structured reasoning and addressed the key risks."
                missed = ""
                better = "Great job — keep this level of detail in future answers."
                explain = "You demonstrated clear, hypothesis-driven thinking with appropriate validation steps."
            elif correctness == "partly_correct":
                did_well = "You engaged with the scenario and provided a partial response."
                missed = "Your answer could benefit from more specific validation steps and explicit risk trade-offs."
                better = "Lead with your recommendation, then briefly support it with the key risks and how you'd validate."
                explain = "The response was on the right track but lacked the depth needed for a fully strong answer."
            else:
                did_well = "You attempted the question, which is a good start."
                missed = "The response was too brief or missed the core reasoning needed."
                better = "Take a moment to outline your approach: state the problem, your decision, and why."
                explain = "More detail and structured reasoning would significantly improve this answer."
            question_reviews.append(QuestionReview(
                round_number=d.round_number,
                question=d.question,
                user_answer=d.response or "(no answer provided)",
                correctness=correctness,
                what_did_well=did_well,
                what_missed=missed,
                better_approach=better,
                explanation=explain,
            ))

        score = sum(1 for q in question_reviews if q.correctness == "correct")
        correct_count = score
        partial_count = sum(1 for q in question_reviews if q.correctness == "partly_correct")
        if correct_count >= 4:
            summary = f"Excellent work! You got {correct_count} out of {TOTAL_ROUNDS} right. Your structured reasoning really came through."
        elif correct_count >= 2:
            summary = f"Good effort — {correct_count} strong and {partial_count} partial answers. With a bit more detail you'll nail the rest."
        else:
            summary = f"You completed all {TOTAL_ROUNDS} rounds, which takes initiative. Let's build on this with more structured practice."

        tips = [
            "Practice narrating a clear plan out loud in under 90 seconds.",
            "State your recommendation first, then briefly justify it with risks and validation.",
        ]
        if correct_count < 3:
            tips.append("Before answering, take a few seconds to identify the core trade-off in the scenario.")

        return SessionReview(
            score=score,
            total=TOTAL_ROUNDS,
            summary=summary,
            question_reviews=question_reviews,
            tips=tips,
            is_demo=session.is_demo,
        )
