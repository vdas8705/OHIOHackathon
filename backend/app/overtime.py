"""Overtime penalties for timed sections.

A "section" is one interview question: each has its own response timer
(RESPONSE_SECONDS_PER_ROUND) and an equal share of the 100-point score.
When a section's timer runs out the candidate may keep going; the longer they
go over, the larger the percentage of THAT section's possible points that is
deducted. Other sections are never affected.

OVERTIME_POLICY is the single place to change tier lengths and percentages.
The frontend receives the scaled tiers in the simulation state, so the live
timer and the final scoring always agree.
"""
from __future__ import annotations

import math
from typing import Optional

from .models import RESPONSE_SECONDS_PER_ROUND, TOTAL_ROUNDS

OVERTIME_POLICY: dict = {
    # Tier boundaries below are written for a section with this time limit.
    "reference_limit_seconds": 90,
    # If a section has a different limit, every boundary is scaled by
    # (section limit / reference limit). At 90s each tier is 30s, i.e. one
    # third of the section's own time.
    "scale_with_section_limit": True,
    # Cumulative penalty, as a % of the section's POSSIBLE points.
    # "over_up_to_seconds" is inclusive; None means "and beyond" (the maximum).
    "tiers": [
        {"over_up_to_seconds": 30, "penalty_pct": 5},
        {"over_up_to_seconds": 60, "penalty_pct": 15},
        {"over_up_to_seconds": 90, "penalty_pct": 30},
        {"over_up_to_seconds": 120, "penalty_pct": 50},
        {"over_up_to_seconds": None, "penalty_pct": 60},
    ],
}

# Each question's share of the 100-point score.
SECTION_POINTS = 100 // TOTAL_ROUNDS


def scaled_tiers(limit_seconds: int = RESPONSE_SECONDS_PER_ROUND) -> list[dict]:
    """Tiers for a section with this limit: [{tier, starts_after, ends_at, penalty_pct}]."""
    scale = (
        limit_seconds / OVERTIME_POLICY["reference_limit_seconds"]
        if OVERTIME_POLICY["scale_with_section_limit"]
        else 1.0
    )
    out = []
    start = 0
    for i, t in enumerate(OVERTIME_POLICY["tiers"], start=1):
        end = None if t["over_up_to_seconds"] is None else round(t["over_up_to_seconds"] * scale)
        out.append(
            {"tier": i, "starts_after_seconds": start, "ends_at_seconds": end, "penalty_pct": t["penalty_pct"]}
        )
        if end is not None:
            start = end
    return out


def tier_for(overtime_seconds: int, limit_seconds: int = RESPONSE_SECONDS_PER_ROUND) -> tuple[int, int]:
    """(tier number, cumulative penalty %) for this much overtime. Tier 0 = on time."""
    if overtime_seconds <= 0:
        return 0, 0
    for t in scaled_tiers(limit_seconds):
        if t["ends_at_seconds"] is None or overtime_seconds <= t["ends_at_seconds"]:
            return t["tier"], t["penalty_pct"]
    last = scaled_tiers(limit_seconds)[-1]
    return last["tier"], last["penalty_pct"]


def allocate_section_points(total: int, weights: list[float], cap: int = SECTION_POINTS) -> list[int]:
    """Split the overall score across sections in proportion to their per-question
    performance, capping each at its possible points. Integers that sum to the
    allocated total (largest-remainder rounding)."""
    n = len(weights)
    if n == 0 or total <= 0:
        return [0] * n
    alloc = [0.0] * n
    active = set(range(n))
    target = min(float(total), float(cap * n))
    while active:
        remaining = target - sum(alloc)
        if remaining <= 1e-9:
            break
        wsum = sum(max(0.0, weights[i]) for i in active)
        capped_now = False
        for i in list(active):
            share = (max(0.0, weights[i]) / wsum if wsum > 0 else 1 / len(active)) * remaining
            give = min(cap - alloc[i], share)
            alloc[i] += give
            if alloc[i] >= cap - 1e-9:
                active.discard(i)
                capped_now = True
        if not capped_now:
            break
    return _round_preserving_sum(alloc, [cap] * n)


def distribute_deduction(total: int, maxes: list[int], scores: list[int]) -> list[int]:
    """Spread an integer deduction across categories by weight, never taking a
    category below zero."""
    n = len(maxes)
    if total <= 0 or n == 0:
        return [0] * n
    total = min(total, sum(scores))
    msum = sum(maxes) or n
    raw = [total * (m / msum) for m in maxes]
    return _round_preserving_sum(raw, scores, target=total)


def _round_preserving_sum(values: list[float], caps: list[int], target: Optional[int] = None) -> list[int]:
    target = round(sum(values)) if target is None else target
    out = [min(caps[i], math.floor(v)) for i, v in enumerate(values)]
    order = sorted(range(len(values)), key=lambda i: values[i] - math.floor(values[i]), reverse=True)
    # Hand out the remaining units by largest remainder, then to anyone with room.
    for pool in (order, list(range(len(values)))):
        for i in pool:
            if sum(out) >= target:
                break
            if out[i] < caps[i]:
                out[i] += 1
    return out
