"""Predefined demo scenario and deterministic demo behaviour.

Used when no LLM API key is configured (demo mode) and also as the safe
fallback when a live LLM call fails validation.
"""
from __future__ import annotations

from .models import (
    ConsequenceGuide,
    EnvironmentState,
    InterviewerTurn,
    NarrativeStage,
    ScenarioBlueprint,
)

DEMO_JOB_DESCRIPTION = """Amazon is seeking a Cloud Hardware Development Engineer to design and \
validate next-generation cloud server hardware. Responsibilities include debugging hardware \
issues at the board and system level, performing thermal and reliability analysis, using \
simulation and lab testing tools, collaborating with cross-functional engineering and \
manufacturing teams, and developing test plans and automated analysis pipelines. The ideal \
candidate has strong fundamentals in electrical engineering, signal integrity, and thermal \
management, and can communicate technical risk clearly to stakeholders."""

DEMO_COMPANY = "Amazon"
DEMO_JOB_TITLE = "Cloud Hardware Development Engineer"
DEMO_COMPANY_INFO = (
    "Amazon Web Services designs custom server hardware at large scale. The team values "
    "customer obsession, bias for action, and disagreeing and committing. Reliability and "
    "operational excellence are core priorities."
)


def demo_blueprint() -> ScenarioBlueprint:
    """A fully-authored five-round hardware thermal validation scenario."""
    return ScenarioBlueprint(
        scenario_title="Thermal Anomaly During Server Validation",
        target_role=DEMO_JOB_TITLE,
        challenge_summary=(
            "During final validation of a new cloud server rack, several nodes are reporting "
            "unexpectedly high temperatures under sustained load, threatening the launch "
            "schedule."
        ),
        competencies=[
            "Hardware debugging",
            "Thermal and reliability analysis",
            "Test planning",
            "Cross-functional communication",
            "Risk assessment",
        ],
        initial_context=(
            "You are validating a new dual-socket server design in the thermal lab. Three of "
            "twelve nodes trip a thermal throttling threshold during a sustained CPU stress "
            "test, while the other nine pass. Launch qualification is due in two weeks."
        ),
        stakeholders=[
            "Your engineering manager",
            "A manufacturing partner",
            "A fellow validation engineer",
            "The program launch lead",
        ],
        ground_truth_facts=[
            "The three failing nodes came from the same manufacturing lot.",
            "A recent BIOS fan-curve update was applied to all nodes last week.",
            "Thermal interface material (TIM) application is manual on this prototype line.",
            "Ambient lab temperature logging shows normal, stable conditions.",
            "The CPUs themselves pass standalone burn-in on a reference board.",
        ],
        initial_environment=EnvironmentState(
            technical_stability=65,
            risk_level=55,
            stakeholder_confidence=60,
            progress=10,
        ),
        stages=[
            NarrativeStage(
                round_number=1,
                focus="Initial investigation",
                development=(
                    "Three of twelve nodes are tripping thermal throttling under sustained "
                    "load during validation, and the launch qualification deadline is two "
                    "weeks away."
                ),
                question=(
                    "How would you structure your initial investigation to isolate the root "
                    "cause of the thermal anomaly?"
                ),
            ),
            NarrativeStage(
                round_number=2,
                focus="New evidence",
                development=(
                    "Your data collection shows the three failing nodes all came from the "
                    "same manufacturing lot, and a BIOS fan-curve update was pushed to every "
                    "node last week."
                ),
                question=(
                    "Given this new evidence, what are your leading hypotheses and how would "
                    "you test them?"
                ),
            ),
            NarrativeStage(
                round_number=3,
                focus="Conflicting signal",
                development=(
                    "You find the failing nodes' onboard sensors disagree with an external "
                    "thermal camera by several degrees, and manufacturing says re-applying "
                    "thermal interface material on the line will cost three days of schedule."
                ),
                question=(
                    "How do you handle the conflicting sensor data and the schedule pressure?"
                ),
            ),
            NarrativeStage(
                round_number=4,
                focus="Stakeholder coordination",
                development=(
                    "Your manager needs an update for the launch lead, and the manufacturing "
                    "partner wants a decision on whether to rework the suspect lot now or "
                    "ship with a mitigation."
                ),
                question=(
                    "How do you revise your plan and communicate a recommendation to these "
                    "stakeholders?"
                ),
            ),
            NarrativeStage(
                round_number=5,
                focus="Resolution",
                development=(
                    "You have narrowed the cause and need to close out validation."
                ),
                question=(
                    "Walk me through your proposed resolution, your validation plan to confirm "
                    "the fix, the remaining risks, and how you'll communicate readiness."
                ),
            ),
        ],
        consequences=ConsequenceGuide(
            strong=(
                "A rigorous, hypothesis-driven approach that controls variables and communicates "
                "risk clearly steadily improves stability and stakeholder confidence."
            ),
            weak=(
                "Jumping to conclusions or ignoring data raises risk and erodes stakeholder "
                "confidence."
            ),
            incomplete=(
                "A vague or partial plan leaves the root cause uncertain and keeps risk elevated."
            ),
        ),
        evaluation_guidance=(
            "Reward structured debugging, controlling one variable at a time, correlating the "
            "lot and BIOS evidence, validating sensors against ground truth, quantifying risk, "
            "and clear stakeholder communication."
        ),
    )


# Deterministic consequence text per round, keyed by response quality.
DEMO_CONSEQUENCES: dict[int, dict[str, str]] = {
    1: {
        "strong": "Good — a structured, data-first plan. Your team begins systematic logging.",
        "weak": "The team runs with a narrow guess; some time is spent chasing the wrong lead.",
        "incomplete": "The plan is thin, so the investigation starts without a clear structure.",
    },
    2: {
        "strong": "You correctly flag the lot and BIOS change as the top variables to isolate.",
        "weak": "A hypothesis is picked without a clear way to confirm it.",
        "incomplete": "Hypotheses remain vague, so testing direction stays uncertain.",
    },
    3: {
        "strong": "You validate sensors against the thermal camera before trusting the data.",
        "weak": "The conflicting data is largely dismissed, adding reliability risk.",
        "incomplete": "The sensor conflict is noted but not resolved.",
    },
    4: {
        "strong": "You give stakeholders a clear, risk-weighted recommendation and timeline.",
        "weak": "The update is unclear, leaving stakeholders uncertain about next steps.",
        "incomplete": "The communication is partial and omits the key trade-offs.",
    },
    5: {
        "strong": "You close out with a credible fix, a validation plan, and named residual risks.",
        "weak": "The resolution lacks a concrete validation plan.",
        "incomplete": "The wrap-up leaves the fix and validation underspecified.",
    },
}


def demo_turn(blueprint: ScenarioBlueprint, round_number: int) -> InterviewerTurn:
    stage = next(s for s in blueprint.stages if s.round_number == round_number)
    return InterviewerTurn(
        round_number=round_number,
        development=stage.development,
        question=stage.question,
    )


def demo_clarification_answer(blueprint: ScenarioBlueprint, question: str) -> str:
    """Answer a clarifying question using only known scenario facts."""
    facts = " ".join(blueprint.ground_truth_facts)
    return (
        "Here's what we know from the lab so far: "
        + facts
        + " I can't speculate beyond that — use what you have to decide how to proceed."
    )


DEMO_EXAMPLE_RESPONSES: dict[int, str] = {
    1: (
        "I'd start by confirming the failure is reproducible and controlling variables: isolate "
        "the three failing nodes, log per-component temperatures, verify ambient conditions, and "
        "compare against the passing nodes to find what differs."
    ),
    2: (
        "My leading hypotheses are a bad manufacturing lot — possibly TIM application — or the "
        "BIOS fan-curve change. I'd revert the BIOS on one failing node, and re-seat/re-apply TIM "
        "on another, changing one variable at a time."
    ),
    3: (
        "I'd validate the onboard sensors against the thermal camera and a calibrated probe before "
        "trusting either. If sensors are off, that's a firmware/calibration issue; if real, I'd "
        "weigh a 3-day TIM rework against the schedule and quantify the risk."
    ),
    4: (
        "I'd give the launch lead a concise risk summary: likely root cause, confidence level, the "
        "rework-vs-mitigation options with timelines, and my recommendation. I'd align with "
        "manufacturing on the rework decision."
    ),
    5: (
        "Proposed fix: correct the TIM process and re-validate the suspect lot, with corrected BIOS "
        "fan curves. Validation: re-run sustained load on reworked nodes plus a sample from the "
        "lot. Residual risk: lot-to-lot variation; I'd add a thermal screen to the test plan and "
        "report readiness with data."
    ),
}
