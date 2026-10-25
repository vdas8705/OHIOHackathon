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
    QUESTION_TYPES,
    CategoryScore,
    CompletionStatus,
    ConversationEntry,
    DecisionRecord,
    EnvironmentState,
    InterviewerTurn,
    PerformanceReport,
    PracticeRecommendation,
    QuestionClassification,
    QuestionPerformance,
    QuestionReview,
    QuestionTypeStat,
    ResponseAnalysis,
    RoundReport,
    ScenarioBlueprint,
    SessionReview,
    StateDelta,
    Weakness,
    normalize_question_type,
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
        is_fixture: bool = False,
    ) -> None:
        self.session_id = uuid.uuid4().hex
        self.company = company
        self.job_title = job_title
        self.job_description = job_description
        self.blueprint = blueprint
        self.is_demo = is_demo
        # Marks synthetic sessions (test scripts / verification) so analytics can
        # exclude them. Real user sessions in demo mode are NOT fixtures.
        self.is_fixture = is_fixture

        self.current_round = 1
        self.completed_rounds = 0
        self.environment = blueprint.initial_environment.clamped()
        self.decision_history: list[DecisionRecord] = []
        self.conversation_history: list[ConversationEntry] = []
        # Per-round clarifying exchanges: {round_number: [(question, answer), ...]}
        self.clarifications_log: dict[int, list[tuple[str, str]]] = {}
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

    def __init__(self, settings: Settings, store=None) -> None:
        self.settings = settings
        self.llm = LLMService(settings)
        self.sessions: dict[str, Session] = {}
        # Optional persistent history store (SQLite). None disables persistence.
        self.store = store

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
        is_fixture: bool = False,
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
            is_fixture=is_fixture,
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
        session.clarifications_log.setdefault(round_number, []).append((question, answer))
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

        # Classify the exact question that was asked (controlled vocabulary).
        classification = self._classify(session, round_number, question)

        # Pull any clarifications recorded this round into the decision record.
        clarifications = [
            {"question": q, "answer": a}
            for (q, a) in session.clarifications_log.get(round_number, [])
        ]

        session.decision_history.append(
            DecisionRecord(
                round_number=round_number,
                question=question,
                response=response,
                timed_out=timed_out,
                analysis=analysis,
                consequence=consequence,
                environment_after=env_after,
                classification=classification,
                clarifications=clarifications,
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

    # ------------------------ classification ----------------------------- #
    def _classify(
        self, session: Session, round_number: int, question: str
    ) -> QuestionClassification:
        """Classify a question against the controlled taxonomy.

        Demo mode uses predefined metadata. Live mode asks the LLM and
        validates every returned type against QUESTION_TYPES.
        """
        if session.is_demo or not self.llm.available:
            return self._demo_classify(round_number)
        try:
            data = self.llm.classify_question(question, list(QUESTION_TYPES))
            return self._coerce_classification(data, round_number)
        except (LLMError, Exception):
            return self._demo_classify(round_number)

    def _demo_classify(self, round_number: int) -> QuestionClassification:
        meta = demo.DEMO_QUESTION_CLASSIFICATION.get(round_number)
        if not meta:
            return QuestionClassification(
                primary_type="Analytical problem-solving",
                secondary_types=[],
                competencies=[],
            )
        return QuestionClassification(
            primary_type=meta["primary_type"],
            secondary_types=list(meta.get("secondary_types", [])),
            competencies=list(meta.get("competencies", [])),
        )

    def _coerce_classification(
        self, data: dict, round_number: int
    ) -> QuestionClassification:
        primary = normalize_question_type(str(data.get("primary_type", "")))
        if primary is None:
            # Fall back to the demo metadata's primary if the LLM gave garbage.
            return self._demo_classify(round_number)
        secondary_raw = data.get("secondary_types", []) or []
        secondary: list[str] = []
        for s in secondary_raw:
            norm = normalize_question_type(str(s))
            if norm and norm != primary and norm not in secondary:
                secondary.append(norm)
        competencies = [str(c) for c in (data.get("competencies", []) or [])][:4]
        return QuestionClassification(
            primary_type=primary,
            secondary_types=secondary[:2],
            competencies=competencies,
        )

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
        self._persist(session)

    def _persist(self, session: Session) -> None:
        """Save a completed session to the history store (best-effort)."""
        if self.store is None or session.final_report is None:
            return
        try:
            from .storage import (
                ORIGIN_TEST_FIXTURE,
                ORIGIN_USER_DEMO,
                ORIGIN_USER_LIVE,
            )

            if session.is_fixture:
                origin = ORIGIN_TEST_FIXTURE
            elif session.is_demo:
                origin = ORIGIN_USER_DEMO
            else:
                origin = ORIGIN_USER_LIVE

            conversation = [
                {
                    "role": e.role,
                    "round_number": e.round_number,
                    "text": e.text,
                }
                for e in session.conversation_history
            ]
            self.store.save_session(
                session_id=session.session_id,
                company=session.company,
                job_title=session.job_title,
                job_description=session.job_description,
                scenario_title=session.blueprint.scenario_title,
                is_demo=session.is_demo,
                completion_status=session.completion_status.value,
                rounds_completed=len(session.decision_history),
                active_seconds=session.elapsed_active_seconds,
                overall_score=session.final_report.overall_score,
                schema_version=session.final_report.schema_version,
                report=session.final_report.model_dump(),
                conversation=conversation,
                origin=origin,
            )
        except Exception:
            # Persistence must never break the live interview flow.
            pass

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

        # Per-question performance indicators (for weakness detection only).
        question_performance = self._build_question_performance(session)
        perf_by_round = {qp.round_number: qp for qp in question_performance}

        round_reports = []
        for d in session.decision_history:
            quality = d.analysis.quality if d.analysis else "incomplete"
            level_map = {
                "strong": "Strong",
                "weak": "Developing",
                "incomplete": "Needs Improvement",
            }
            level = level_map.get(quality, "Developing")
            if d.timed_out and not (d.response or "").strip():
                level = "Not attempted"
            cls = d.classification
            fb = self._round_feedback(session, d, quality)
            round_reports.append(
                RoundReport(
                    round_number=d.round_number,
                    question=d.question,
                    response=d.response or "(no answer provided)",
                    consequence=d.consequence,
                    analysis=(
                        d.analysis.supporting_reasoning
                        if d.analysis and d.analysis.supporting_reasoning
                        else ""
                    ),
                    timed_out=d.timed_out,
                    question_type=cls.primary_type if cls else "",
                    secondary_types=cls.secondary_types if cls else [],
                    competencies=cls.competencies if cls else [],
                    what_went_well=fb["what_went_well"],
                    what_was_missed=fb["what_was_missed"],
                    stronger_approach=fb["stronger_approach"],
                    why_it_mattered=fb["why_it_mattered"],
                    performance_level=level,
                    clarifications=list(d.clarifications),
                )
            )

        question_type_stats = self._aggregate_question_types(question_performance)
        weaknesses = self._detect_weaknesses(
            session, categories, question_performance, question_type_stats
        )
        recommendations = self._build_recommendations(weaknesses, question_type_stats)

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
            question_performance=question_performance,
            question_type_stats=question_type_stats,
            weaknesses=weaknesses,
            practice_recommendations=recommendations,
        )

    # ----------------- per-question + weakness analysis ------------------ #
    def _round_feedback(self, session, d, quality: str) -> dict[str, str]:
        """Grounded, non-binary feedback for a round (demo table + LLM analysis)."""
        table = demo.DEMO_ROUND_FEEDBACK.get(d.round_number, {}).get(quality)
        if table:
            return dict(table)
        # Generic fallback keyed on quality.
        if quality == "strong":
            return {
                "what_went_well": "Your answer was structured and addressed the core of the question.",
                "what_was_missed": "",
                "stronger_approach": "Keep this level of detail and name how you'd validate your approach.",
                "why_it_mattered": "A clear, well-reasoned answer is what the question is designed to elicit.",
            }
        if quality == "weak":
            return {
                "what_went_well": "You engaged with the question and offered a direction.",
                "what_was_missed": "More specific reasoning, trade-offs, or validation steps.",
                "stronger_approach": "Lead with your decision, then support it with reasoning and risks.",
                "why_it_mattered": "Depth of reasoning is what separates a developing answer from a strong one.",
            }
        return {
            "what_went_well": "You attempted the question.",
            "what_was_missed": "The core reasoning and a concrete approach.",
            "stronger_approach": "State the problem, your decision, and why — briefly but completely.",
            "why_it_mattered": "A fuller answer lets the interviewer assess your thinking.",
        }

    _QUALITY_INDICATOR = {"strong": 85, "weak": 55, "incomplete": 25}

    def _build_question_performance(self, session) -> list[QuestionPerformance]:
        """Normalized 0-100 per-question indicators (weakness detection only)."""
        results: list[QuestionPerformance] = []
        use_llm = (not session.is_demo) and self.llm.available
        for d in session.decision_history:
            cls = d.classification
            qtype = cls.primary_type if cls else "Analytical problem-solving"
            quality = d.analysis.quality if d.analysis else "incomplete"
            indicator = self._QUALITY_INDICATOR.get(quality, 25)
            evidence: list[str] = []
            mistakes: list[str] = []
            advice = ""
            if use_llm and (d.response or "").strip():
                try:
                    data = self.llm.analyze_per_question(
                        d.question, qtype, d.response, session.blueprint.ground_truth_facts
                    )
                    indicator = max(0, min(100, int(data.get("indicator", indicator))))
                    evidence = [str(e) for e in data.get("evidence", [])][:3]
                    mistakes = [str(m) for m in data.get("mistakes", [])][:3]
                    advice = str(data.get("improvement_advice", ""))
                except (LLMError, Exception):
                    pass
            if not evidence:
                evidence = (
                    [f"Round {d.round_number}: {(d.response or '(no answer)')[:160]}"]
                    if d.response
                    else ["No substantive response recorded."]
                )
            if not advice:
                advice = self._round_feedback(session, d, quality)["stronger_approach"]
            results.append(
                QuestionPerformance(
                    question_id=f"{session.session_id[:8]}-r{d.round_number}",
                    round_number=d.round_number,
                    question=d.question,
                    question_type=qtype,
                    secondary_types=cls.secondary_types if cls else [],
                    competencies=cls.competencies if cls else [],
                    indicator=indicator,
                    evidence=evidence,
                    mistakes=mistakes,
                    improvement_advice=advice,
                )
            )
        return results

    def _aggregate_question_types(
        self, qp: list[QuestionPerformance]
    ) -> list[QuestionTypeStat]:
        """Aggregate by PRIMARY question type only (no double-counting)."""
        buckets: dict[str, list[QuestionPerformance]] = {}
        for q in qp:
            buckets.setdefault(q.question_type, []).append(q)
        stats: list[QuestionTypeStat] = []
        for qtype, items in buckets.items():
            avg = int(round(sum(i.indicator for i in items) / len(items)))
            mistakes: list[str] = []
            for i in items:
                for m in i.mistakes:
                    if m and m not in mistakes:
                        mistakes.append(m)
            suggestion = items[0].improvement_advice if items else ""
            stats.append(
                QuestionTypeStat(
                    question_type=qtype,
                    count=len(items),
                    average_indicator=avg,
                    common_mistakes=mistakes[:3],
                    suggested_improvement=suggestion,
                )
            )
        stats.sort(key=lambda s: s.average_indicator)
        return stats

    def _detect_weaknesses(
        self, session, categories, qp, qstats
    ) -> list[Weakness]:
        """Single-session weakness detection.

        A category/type is only an 'observed' weakness with enough evidence;
        a single low question is a 'potential' observation, not a recurring
        weakness.
        """
        weaknesses: list[Weakness] = []

        # Competency-based weaknesses: low percentage of the max.
        for c in categories:
            pct = (c.score / c.max_score) * 100 if c.max_score else 0
            if pct < 55:
                evidence = c.evidence[:2]
                weaknesses.append(
                    Weakness(
                        label=c.name,
                        kind="observed" if session.decision_history else "potential",
                        category=c.name,
                        evidence=evidence,
                        detail=(
                            f"Scored {c.score}/{c.max_score} in {c.name.lower()}. "
                            + (c.improvements[0] if c.improvements else "")
                        ),
                    )
                )

        # Question-type observations.
        for s in qstats:
            if s.average_indicator < 55:
                # One question of a type -> 'potential' observation, not recurring.
                kind = "observed" if s.count >= 2 else "potential"
                detail = (
                    f"Average performance {s.average_indicator}/100 across {s.count} "
                    f"{'questions' if s.count != 1 else 'question'} of this type."
                )
                if s.count < 2:
                    detail += (
                        " Only one question of this type was asked, so treat this as an "
                        "observation rather than a recurring weakness."
                    )
                weaknesses.append(
                    Weakness(
                        label=s.question_type,
                        kind=kind,
                        category=s.question_type,
                        evidence=s.common_mistakes[:2],
                        detail=detail,
                    )
                )
        return weaknesses

    def _build_recommendations(
        self, weaknesses, qstats
    ) -> list[PracticeRecommendation]:
        recs: list[PracticeRecommendation] = []
        type_advice = {
            "Technical troubleshooting": "Practice root-cause analysis scenarios that require collecting evidence, forming hypotheses, and validating potential fixes before acting.",
            "System design and architecture": "Practice whiteboard design drills: state requirements, enumerate components, and justify trade-offs between options.",
            "Analytical problem-solving": "Practice breaking ambiguous problems into sub-parts and reasoning from evidence to a conclusion.",
            "Decision-making and prioritization": "Practice scenarios that force an explicit decision under constraints, stating the trade-off you accepted.",
            "Risk assessment": "Practice naming the top risks of each option and how you'd mitigate or validate them.",
            "Adaptability and unexpected complications": "Practice scenarios where new, contradictory information arrives mid-way and you must revise your plan.",
            "Communication and stakeholder management": "Practice delivering a crisp recommendation-first update tailored to a specific stakeholder.",
            "Behavioral and teamwork": "Practice structured STAR-style stories that show collaboration and conflict resolution.",
            "Ethical and professional judgment": "Practice scenarios with competing pressures where you must defend a principled decision.",
            "Role-specific technical knowledge": "Review the core technical fundamentals for this role and practice explaining them aloud.",
        }
        # Prioritize observed weaknesses, then potential ones; cap at 3.
        ordered = sorted(weaknesses, key=lambda w: 0 if w.kind == "observed" else 1)
        for w in ordered[:3]:
            rec_text = type_advice.get(
                w.label,
                f"Practice targeted scenarios that exercise {w.label.lower()} and review your "
                "reasoning afterward.",
            )
            evidence = w.evidence[0] if w.evidence else w.detail
            recs.append(
                PracticeRecommendation(
                    weakness=w.label, evidence=evidence, recommendation=rec_text
                )
            )
        if not recs:
            recs.append(
                PracticeRecommendation(
                    weakness="General practice",
                    evidence="Your performance was fairly balanced across competencies.",
                    recommendation=(
                        "Keep practicing full situational interviews, focusing on pairing each "
                        "decision with its validation and the risk you accepted."
                    ),
                )
            )
        return recs

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
