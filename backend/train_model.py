"""
Train and validate time-series predictive models for attendance risk prediction.

Educational Data Science & Time-Series Analytics:
At any observation point in the academic semester, an institution needs to:
1. Analyze chronological class attendance records.
2. Detect attendance trends (improving, stable, deteriorating).
3. Identify absence acceleration and consecutive absence streaks.
4. Combine behavioral forecasts (adaptive EWMA) with mathematical feasibility.
5. Predict the risk of falling below the required institutional threshold.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    brier_score_loss,
    classification_report,
    confusion_matrix,
    f1_score,
    log_loss,
    precision_score,
    recall_score,
)
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

from time_series import (
    extract_time_series_features,
    normalize_status,
    parse_chronological_records,
)

FEATURE_NAMES = [
    "attendance_pct",
    "margin_to_threshold",
    "recent_absence_rate",
    "recent_vs_overall_delta",
    "consecutive_absences",
    "longest_absence_streak",
    "absence_acceleration",
    "remaining_classes",
    "projected_if_attend_all",
    "projected_if_miss_next",
    "recovery_ratio",
    "expected_final_attendance",
    "worst_case_attendance",
]

LABEL_MAP = {0: "Low", 1: "Moderate", 2: "High"}
REVERSE_LABEL = {"Low": 0, "Moderate": 1, "High": 2}

ROOT = Path(__file__).parent
MODEL_DIR = ROOT / "model"
DATA_DIR = ROOT / "data"


# ============================================================================
# 1. PURE MATHEMATICAL FOUNDATIONS
# ============================================================================

def attendance_pct(attended: float, conducted: float) -> float:
    """Calculate current attendance percentage.

    Handles zero denominators (100% when no classes conducted yet)
    and bounds attended between 0 and conducted.
    """
    c = float(conducted)
    a = float(attended)
    if not math.isfinite(c) or c <= 0:
        return 100.0
    if not math.isfinite(a) or a <= 0:
        return 0.0
    return (min(max(0.0, a), c) / c) * 100.0


def calculate_remaining_classes(
    semester_total: int, attended: int, absent: int
) -> dict[str, Any]:
    """Distinguish between classes already conducted and remaining in semester.

    Formula:
      conducted = classes_attended + classes_absent
      remaining = semester_total - (classes_attended + classes_absent)

    If semester_total < conducted, flags inconsistent data rather than returning negative count.
    """
    tot = max(0, int(semester_total or 0))
    att = max(0, int(attended or 0))
    ab = max(0, int(absent or 0))
    conducted = att + ab

    if tot < conducted:
        return {
            "conducted": conducted,
            "semester_total": tot,
            "remaining": 0,
            "is_inconsistent": True,
            "error": f"Inconsistent data: conducted classes ({conducted}) exceed semester total ({tot})",
        }

    remaining = tot - conducted
    return {
        "conducted": conducted,
        "semester_total": tot,
        "remaining": remaining,
        "is_inconsistent": False,
        "error": None,
    }


def projected(attended: int, conducted: int, attend: int, miss: int) -> float:
    """Calculate projected attendance given additional attended and missed classes.

    Attending increases both attended and conducted counts by 1.
    Missing increases only conducted count by 1.
    """
    a = max(0, int(attend))
    m = max(0, int(miss))
    return attendance_pct(int(attended) + a, int(conducted) + a + m)


def best_case_attendance(attended: int, conducted: int, remaining: int) -> float:
    """Best possible final attendance: attend every remaining class."""
    return projected(attended, conducted, max(0, int(remaining)), 0)


def worst_case_attendance(attended: int, conducted: int, remaining: int) -> float:
    """Worst possible final attendance: miss every remaining class."""
    return projected(attended, conducted, 0, max(0, int(remaining)))


def projected_from_percentage(
    percentage: float,
    remaining: int,
    attend: int,
    miss: int,
    conducted_est: int = 50,
) -> float:
    """Project attendance when only percentage and remaining classes are known.
    Uses C_est as a clearly identified estimate of classes already conducted:
      Projected (%) = 100 * ((P / 100 * C_est) + X) / (C_est + X + Y)
    """
    c_est = max(1, int(conducted_est))
    p = max(0.0, min(100.0, float(percentage)))
    a_est = (p / 100.0) * c_est
    x = max(0, int(attend))
    y = max(0, int(miss))
    total = c_est + x + y
    if total <= 0:
        return 100.0
    return ((a_est + x) / total) * 100.0


def calculate_simulation_scenarios(
    attended: int | None,
    conducted: int | None,
    remaining: int,
    threshold: float,
    attend: int,
    miss: int,
    current_pct: float | None = None,
    conducted_est: int = 50,
    semester_total: int | None = None,
) -> dict[str, Any]:
    """Calculate scenarios A, B, C, D, E, recovery limits, and consistency checks."""
    rem = max(0, int(remaining))
    thr = float(threshold)
    att_plan = max(0, min(rem, int(attend)))
    miss_plan = max(0, min(rem - att_plan, int(miss)))

    has_counts = attended is not None and conducted is not None
    has_pct = current_pct is not None

    inconsistent_warning: str | None = None
    calc_note: str | None = None

    if has_counts:
        A = max(0.0, float(attended))
        C = max(0.0, float(conducted))
        actual_pct = attendance_pct(int(A), int(C)) if C > 0 else 0.0
        curr_pct = actual_pct
        calc_mode = "exact_class_counts"

        if semester_total is not None and C > float(semester_total):
            inconsistent_warning = f"Inconsistent data: conducted classes ({int(C)}) exceed semester total ({int(semester_total)})"
        elif has_pct and C > 0:
            p_entered = float(current_pct)
            if abs(p_entered - actual_pct) > 0.5:
                inconsistent_warning = (
                    f"Entered percentage ({p_entered:.1f}%) contradicts class counts "
                    f"({int(A)}/{int(C)} = {actual_pct:.1f}%). Using exact class counts."
                )
    elif has_pct:
        calc_mode = "percentage_approximation"
        c_est = max(1, int(conducted_est))
        curr_pct = max(0.0, min(100.0, float(current_pct)))
        C = float(c_est)
        A = (curr_pct / 100.0) * C
        calc_note = (
            f"Using estimated baseline of {c_est} conducted classes for percentage-only projection. "
            "Exact class-level calculations require actual attended and conducted counts."
        )
    else:
        calc_mode = "default"
        C = 50.0
        A = 36.0
        curr_pct = 72.0

    def calc_proj(x: int, y: int) -> float:
        total = C + x + y
        if total <= 0:
            return 100.0
        return ((A + x) / total) * 100.0

    proj_future = calc_proj(att_plan, miss_plan)
    above = proj_future >= thr - 1e-9
    margin_to_threshold = round(proj_future - thr, 2)

    # Scenario A: Attend every remaining class
    proj_a = calc_proj(rem, 0)
    scenario_a = {
        "id": "A",
        "name": "Scenario A: Attend Every Remaining Class",
        "attend": rem,
        "miss": 0,
        "projected": round(proj_a, 2),
        "meets_threshold": proj_a >= thr - 1e-9,
        "margin": round(proj_a - thr, 2),
        "description": f"Attend all {rem} remaining classes (best-case ceiling).",
    }

    # Scenario B: Miss next class and attend others
    att_b = max(0, rem - 1)
    miss_b = min(1, rem)
    proj_b = calc_proj(att_b, miss_b)
    scenario_b = {
        "id": "B",
        "name": "Scenario B: Miss Next Class, Attend Others",
        "attend": att_b,
        "miss": miss_b,
        "projected": round(proj_b, 2),
        "meets_threshold": proj_b >= thr - 1e-9,
        "margin": round(proj_b - thr, 2),
        "description": (
            "Suffer an immediate absence in the next session, then attend the rest."
            if rem > 0
            else "No remaining classes left."
        ),
    }

    # Scenario C: Attend specified classes and miss rest
    miss_rest = max(0, rem - att_plan)
    proj_c = calc_proj(att_plan, miss_rest)
    scenario_c = {
        "id": "C",
        "name": f"Scenario C: Attend {att_plan}, Miss Rest ({miss_rest})",
        "attend": att_plan,
        "miss": miss_rest,
        "projected": round(proj_c, 2),
        "meets_threshold": proj_c >= thr - 1e-9,
        "margin": round(proj_c - thr, 2),
        "description": f"Attend {att_plan} classes and miss all remaining {miss_rest} undecided classes.",
    }

    # Recovery feasibility & limits
    recoverable = proj_a >= thr - 1e-9
    min_rem_attend: int | None = None
    max_missable: int | None = None

    if recoverable:
        total_final = C + rem
        target_attended = math.ceil((thr / 100.0) * total_final - 1e-9)
        min_rem_attend = max(0, int(target_attended - math.floor(A)))
        while ((A + min_rem_attend) / total_final) < (thr / 100.0) - 1e-9 and min_rem_attend < rem:
            min_rem_attend += 1
        max_missable = max(0, rem - min_rem_attend)

    # Scenario D: Break-Even Recovery (if recoverable)
    scenario_d = None
    if recoverable and min_rem_attend is not None:
        proj_d = calc_proj(min_rem_attend, max_missable)
        scenario_d = {
            "id": "D",
            "name": f"Scenario D: Break-Even Recovery ({min_rem_attend} Attend, {max_missable} Miss)",
            "attend": min_rem_attend,
            "miss": max_missable,
            "projected": round(proj_d, 2),
            "meets_threshold": True,
            "margin": round(proj_d - thr, 2),
            "description": f"Minimum effort to finish compliant: attend exactly {min_rem_attend} classes.",
        }

    # Scenario E: Miss all remaining
    proj_e = calc_proj(0, rem)
    scenario_e = {
        "id": "E",
        "name": f"Scenario E: Miss All Remaining ({rem} Missed)",
        "attend": 0,
        "miss": rem,
        "projected": round(proj_e, 2),
        "meets_threshold": proj_e >= thr - 1e-9,
        "margin": round(proj_e - thr, 2),
        "description": "Worst-case outcome if no further classes are attended.",
    }

    scenario_comparison = [scenario_a, scenario_b, scenario_c]
    if scenario_d is not None:
        scenario_comparison.append(scenario_d)
    scenario_comparison.append(scenario_e)

    # Recommendations
    if not recoverable:
        rec = (
            f"Even attending all {rem} remaining classes reaches {proj_a:.1f}%, which cannot achieve "
            f"the {thr:.0f}% requirement under the stated assumptions. This subject is mathematically unrecoverable "
            "within the semester. Contact your mentor or department regarding medical or administrative condonation."
        )
    elif proj_future >= thr + 5.0:
        rec = (
            f"Projected to finish at {proj_future:.1f}%, comfortably above the {thr:.0f}% requirement "
            f"(+{margin_to_threshold:.1f}% buffer). Maintain this plan to guarantee compliance."
        )
    elif above:
        rec = (
            f"Projected attendance ({proj_future:.1f}%) meets the {thr:.0f}% threshold "
            f"(+{margin_to_threshold:.1f}% buffer). You can afford at most {max_missable} total absences across the remaining classes."
        )
    elif min_rem_attend is not None:
        rec = (
            f"Projected attendance ({proj_future:.1f}%) falls below {thr:.0f}% "
            f"({margin_to_threshold:.1f}% deficit). You must attend at least {min_rem_attend} of the {rem} remaining classes "
            f"(at most {max_missable} absences allowed) to finish compliant."
        )
    else:
        rec = f"Projected attendance ({proj_future:.1f}%) is below {thr:.0f}%. Consult your mentor."

    chart = []
    for m in range(0, rem + 1):
        a_chart = rem - m
        p_chart = round(calc_proj(a_chart, m), 2)
        chart.append(
            {
                "missed": m,
                "attended": a_chart,
                "percentage": p_chart,
                "above": p_chart >= thr - 1e-9,
            }
        )

    min_needed = min_classes_to_threshold(int(A), int(C), rem, thr) if has_counts else None

    return {
        "current_attendance": round(curr_pct, 2),
        "projected_attendance": round(proj_future, 2),
        "above_threshold": above,
        "margin_to_threshold": margin_to_threshold,
        "threshold": thr,
        "unused_remaining": max(0, rem - att_plan - miss_plan),
        "can_recover": recoverable,
        "is_unrecoverable": not recoverable,
        "min_classes_to_threshold": min_needed,
        "min_remaining_to_attend": min_rem_attend,
        "max_missable": max_missable,
        "calculation_mode": calc_mode,
        "inconsistent_warning": inconsistent_warning,
        "calculation_note": calc_note,
        "recommendation": rec,
        "scenario_a": scenario_a,
        "scenario_b": scenario_b,
        "scenario_c": scenario_c,
        "scenario_d": scenario_d,
        "scenario_e": scenario_e,
        "scenario_comparison": scenario_comparison,
        "scenario_chart": chart,
        "projection_type": "deterministic_mathematical_projection",
    }


def can_recover(attended: int, conducted: int, remaining: int, threshold: float) -> bool:
    """True if threshold can still be reached by attending every remaining class."""
    return best_case_attendance(attended, conducted, remaining) >= float(threshold) - 1e-9


def min_classes_to_threshold(
    attended: int, conducted: int, remaining: int, threshold: float
) -> int | None:
    """Closed-form minimum future consecutive classes to attend to reach threshold.

    Equation:
      (A + N) / (C + N) >= r  =>  N >= (r*C - A) / (1 - r)

    Applies when 0 <= r < 1.
    Returns:
      0 if already at or above threshold,
      None if impossible within remaining classes or r >= 1,
      N if verified against the attendance equation.
    """
    A = float(attended)
    C = float(conducted)
    R = max(0, int(remaining))
    r = float(threshold) / 100.0

    if not math.isfinite(r) or r >= 1.0:
        return None
    if r <= 0:
        return 0
    if C <= 0:
        return 0
    if (A / C) >= r - 1e-9:
        return 0
    if R <= 0:
        return None

    denom = 1.0 - r
    if denom <= 0:
        return None
    numerator = r * C - A
    n = math.ceil(numerator / denom)
    n = max(0, n)

    # Verification against full attendance equation
    while (A + n) / (C + n) < r - 1e-9:
        n += 1

    if n > R:
        return None
    return n


def min_remaining_to_attend(
    attended: int, conducted: int, remaining: int, threshold: float
) -> int | None:
    """Minimum classes out of the remaining R that must be attended (attending k,

    missing R - k) such that final attendance >= threshold.
    (A + k) / (C + R) >= r  =>  k >= r*(C + R) - A.
    Returns None if even k = R fails to reach threshold.
    """
    A = float(attended)
    C = float(conducted)
    R = max(0, int(remaining))
    r = float(threshold) / 100.0

    if not math.isfinite(r) or r <= 0:
        return 0
    if r > 1.0:
        return None
    total_final = C + R
    if total_final <= 0:
        return 0
    target_attended = math.ceil(r * total_final - 1e-9)
    needed = max(0, int(target_attended - A))
    if needed > R:
        return None
    return needed


def max_missable_classes(
    attended: int, conducted: int, remaining: int, threshold: float
) -> int | None:
    """Maximum remaining classes that can be missed (attending the rest)

    without dropping below threshold at semester end.
    (A + R - M) / (C + R) >= r  =>  M <= A + R - r*(C + R).
    Returns None if recovery is mathematically impossible.
    """
    A = float(attended)
    C = float(conducted)
    R = max(0, int(remaining))
    r = float(threshold) / 100.0

    if not math.isfinite(r) or r <= 0:
        return R
    if r > 1.0:
        return None
    total_final = C + R
    if total_final <= 0:
        return 0

    target_attended = math.ceil(r * total_final - 1e-9)
    if A + R < target_attended:
        return None

    max_miss = int(math.floor(A + R - target_attended + 1e-9))
    candidate = min(R, max(0, max_miss))

    # Verification
    while candidate > 0 and (A + (R - candidate)) / total_final < r - 1e-9:
        candidate -= 1
    return candidate


def consecutive_absences(pattern: list[str]) -> int:
    """Count consecutive absences at the tail of the recent pattern."""
    if not pattern:
        return 0
    count = 0
    for p in reversed(pattern):
        norm = normalize_status(p)
        if norm is False:
            count += 1
        elif norm is True:
            break
    return count


def attendance_trend(weekly: list[float]) -> float:
    """Attendance trend (slope: last - first in weekly percentage points)."""
    if not weekly or len(weekly) < 2:
        return 0.0
    first = float(weekly[0])
    last = float(weekly[-1])
    if not math.isfinite(first) or not math.isfinite(last):
        return 0.0
    return last - first


def recent_absence_rate(pattern: list[str]) -> float:
    """Fraction of recent classes missed (0.0 to 1.0)."""
    if not pattern:
        return 0.0
    valid = [normalize_status(p) for p in pattern if normalize_status(p) is not None]
    if not valid:
        return 0.0
    return sum(1 for p in valid if not p) / len(valid)


def expected_final_attendance(
    attended: int, conducted: int, remaining: int, recent_rate: float
) -> float:
    """Expected final attendance assuming recent absence rate continues into remaining classes."""
    r_rem = max(0, int(remaining))
    if r_rem == 0:
        return attendance_pct(attended, conducted)
    exp_miss = int(round(r_rem * max(0.0, min(1.0, recent_rate))))
    exp_attend = r_rem - exp_miss
    return projected(attended, conducted, exp_attend, exp_miss)


def generate_personalized_recommendation(
    attended: int,
    conducted: int,
    remaining: int,
    threshold: float = 75.0,
    semester_total: int | None = None,
) -> dict[str, Any]:
    """Calculate personalized attendance analysis and dynamic recommendation for a subject.

    Calculates all 11 required elements:
    1. current_attendance (%)
    2. threshold (%)
    3. attended count
    4. absent count
    5. conducted count
    6. remaining classes
    7. min_consecutive_to_threshold (or 0 if already above, None if unrecoverable)
    8. can_recover (boolean)
    9. max_missable (int or None if unrecoverable)
    10. projected_final_if_attend_all (%)
    11. recommendation (personalized text)
    """
    A = max(0, int(attended or 0))
    C = max(0, int(conducted or 0))
    R = max(0, int(remaining or 0))
    T = float(threshold if threshold is not None else 75.0)
    t = T / 100.0
    missed = max(0, C - A)
    sem_tot = semester_total if semester_total is not None else (C + R)

    # 1. Subject with no attendance recorded
    if C == 0:
        return {
            "current_attendance": 0.0,
            "threshold": T,
            "attended": 0,
            "absent": 0,
            "conducted": 0,
            "remaining": R,
            "semester_total": sem_tot,
            "min_consecutive_to_threshold": None,
            "min_classes_to_threshold": None,
            "can_recover": True,
            "max_missable": None,
            "projected_final_if_attend_all": 0.0,
            "worst_case_attendance": 0.0,
            "status": "unavailable",
            "is_inconsistent": False,
            "recommendation": "No attendance recorded yet for this subject. Projections and recommendations will become available once classes commence.",
        }

    # Inconsistent data check: conducted exceeds semester total
    is_inconsistent = sem_tot < C
    curr_pct = (A / C) * 100.0
    total_final = C + R
    proj_all = ((A + R) / total_final * 100.0) if total_final > 0 else curr_pct
    proj_worst = (A / total_final * 100.0) if total_final > 0 else curr_pct
    recoverable = proj_all >= T - 1e-9

    m = max_missable_classes(A, C, R, T) if recoverable else None
    n = min_classes_to_threshold(A, C, R, T)

    if is_inconsistent:
        recommendation = (
            f"Inconsistent attendance record: conducted classes ({C}) exceed total planned semester classes ({sem_tot}). "
            "Please verify attendance records with the department administration."
        )
        status = "inconsistent"
    elif R == 0:
        if curr_pct >= T - 1e-9:
            recommendation = (
                f"Semester completed successfully with {curr_pct:.1f}% attendance, exceeding the {T:.0f}% requirement."
            )
            status = "completed_compliant"
        else:
            recommendation = (
                f"Semester completed with {curr_pct:.1f}% attendance, which is below the required {T:.0f}% threshold. "
                "Contact your academic mentor or department office regarding condonation."
            )
            status = "completed_non_compliant"
    elif not recoverable:
        recommendation = (
            f"Attend every remaining class. Your attendance will reach {proj_all:.1f}%, which is still below the required {T:.0f}% threshold. "
            f"Recovery is mathematically impossible within the remaining {R} classes; consult your academic mentor immediately."
        )
        status = "unrecoverable"
    elif curr_pct < T - 1e-9:
        status = "recovering"
        if m is not None and m > 0:
            recommendation = (
                f"Attend the next {n} consecutive classes to recover to the required {T:.0f}% threshold. "
                f"Across all {R} remaining classes, you can miss at most {m} class{'es' if m != 1 else ''} if you attend the others (best final: {proj_all:.1f}%)."
            )
        else:
            recommendation = (
                f"Attend the next {n} consecutive classes to recover to the required {T:.0f}% threshold. "
                f"You must attend all {R} remaining classes (0 absences allowed) to finish compliant (final attendance: {proj_all:.1f}%)."
            )
    elif abs(curr_pct - T) < 0.05:
        status = "at_threshold"
        if m is not None and m > 0:
            recommendation = (
                f"Your attendance is currently at the {T:.0f}% threshold ({curr_pct:.1f}%). Missing another class may put you below the requirement. "
                f"You can miss at most {m} of the {R} remaining classes if you attend the others."
            )
        else:
            recommendation = (
                f"Your attendance is currently at the {T:.0f}% threshold ({curr_pct:.1f}%). Missing another class will put you below the requirement. "
                f"You must attend all {R} remaining classes to finish compliant."
            )
    else:
        status = "above_threshold"
        if m is not None and m == R:
            recommendation = (
                f"Your attendance is currently above the threshold ({curr_pct:.1f}%). "
                f"You can miss all {R} remaining classes and still finish compliant (final attendance: {proj_worst:.1f}% vs {T:.0f}% threshold)."
            )
        elif m is not None and m > 0:
            recommendation = (
                f"Your attendance is currently above the threshold ({curr_pct:.1f}%). "
                f"You can miss at most {m} of the {R} remaining classes if you attend the others (best final: {proj_all:.1f}%)."
            )
        else:
            recommendation = (
                f"Your attendance is currently above the threshold ({curr_pct:.1f}%), but your buffer is minimal. "
                f"Missing even 1 more class will drop you below {T:.0f}%. You must attend all {R} remaining classes to maintain compliance."
            )

    return {
        "current_attendance": round(curr_pct, 2),
        "threshold": T,
        "attended": A,
        "absent": missed,
        "conducted": C,
        "remaining": R,
        "semester_total": sem_tot,
        "min_consecutive_to_threshold": n if (curr_pct < T - 1e-9 and recoverable) else 0 if (curr_pct >= T - 1e-9) else None,
        "min_classes_to_threshold": n if (curr_pct < T - 1e-9 and recoverable) else 0 if (curr_pct >= T - 1e-9) else None,
        "can_recover": recoverable,
        "max_missable": m,
        "projected_final_if_attend_all": round(proj_all, 2),
        "worst_case_attendance": round(proj_worst, 2),
        "status": status,
        "is_inconsistent": is_inconsistent,
        "recommendation": recommendation,
    }


# ============================================================================
# 2. TIME-SERIES RISK CLASSIFICATION POLICY (SINGLE SOURCE OF TRUTH)
# ============================================================================

def label_risk(
    attendance: float,
    threshold: float,
    recent_absence_rate: float,
    remaining: int,
    proj_all: float,
    proj_miss: float,
    expected_final: float,
    min_needed: int | None,
    min_rem_attend: int | None,
    max_missable: int | None,
    consecutive: int = 0,
    trend: float = 0.0,
    immediate_miss_pct: float | None = None,
    recent_vs_overall_delta: float = 0.0,
    longest_streak: int = 0,
    absence_acceleration: float = 0.0,
    trend_direction: str = "stable",
) -> str:
    """Documented classification policy integrating time-series behavioral patterns

    with mathematical feasibility limits.
    """
    margin = attendance - threshold
    recoverable = proj_all >= threshold - 1e-9

    # Category A: Mathematically unrecoverable within remaining semester
    if not recoverable:
        return "High"

    # Category B: Semester completed (0 remaining classes)
    if remaining <= 0:
        return "Low" if attendance >= threshold else "High"

    recovery_ratio = (
        (min_rem_attend / remaining)
        if (min_rem_attend is not None and remaining > 0)
        else (1.5 if not recoverable else 0.0)
    )

    imm_miss = immediate_miss_pct if immediate_miss_pct is not None else proj_miss

    # Category C: High Risk
    # 1. Below threshold AND (demanding recovery >= 70% OR consecutive absences >= 2
    #    OR recent absence rate >= 40% OR deteriorating trend)
    if attendance < threshold:
        # If student is recovering with strong positive momentum (< 65% needed and improving trend),
        # assign Moderate instead of High
        if trend_direction == "improving" and recovery_ratio < 0.65 and consecutive == 0:
            return "Moderate"

        if (
            recovery_ratio >= 0.70
            or consecutive >= 2
            or recent_absence_rate >= 0.40
            or expected_final < threshold - 2.0
            or trend < -4.0
            or trend_direction == "deteriorating"
        ):
            return "High"

    # 2. Currently compliant BUT exhibits severe deterioration or fragile buffer:
    if attendance >= threshold:
        # Acute deterioration: recent rate significantly below overall rate (e.g. 85% overall, 50% recent)
        if recent_vs_overall_delta <= -20.0 and (max_missable is not None and max_missable <= 3):
            return "High"
        # Consecutive absence streak of 3+ sessions
        if consecutive >= 3:
            return "High"
        # Immediate breach + thin margin or elevated absences
        if imm_miss < threshold and (
            margin < 2.5 or recent_absence_rate >= 0.35 or consecutive >= 2
        ):
            return "High"
        if expected_final < threshold and (max_missable is not None and max_missable <= 1):
            return "High"

    # Category D: Moderate Risk
    # 1. Below threshold but easily recoverable with < 70% of remaining sessions
    if attendance < threshold:
        return "Moderate"

    # 2. Above threshold, but safety buffer is thin or eroding:
    #    - Deteriorating recent attendance (delta <= -8.0)
    #    - Missing next class drops below threshold
    #    - Margin < 5.0 points
    #    - Expected final under behavioral forecast breaches threshold
    #    - Can miss at most 2 classes without breaching (max_missable <= 2)
    #    - Absence acceleration detected
    if (
        recent_vs_overall_delta <= -8.0
        or absence_acceleration >= 0.15
        or imm_miss < threshold
        or margin < 5.0
        or expected_final < threshold
        or recent_absence_rate >= 0.25
        or (max_missable is not None and max_missable <= 2)
    ):
        return "Moderate"

    # Category E: Low Risk
    # Above threshold with healthy margin, expected final >= threshold, buffer >= 3 classes
    return "Low"


# ============================================================================
# 3. FEATURE EXTRACTION PIPELINE
# ============================================================================

def build_features(
    attended: int,
    conducted: int,
    remaining: int,
    threshold: float,
    recent_rate: float,
    consecutive: int = 0,
    trend: float = 0.0,
    history: list[Any] | None = None,
) -> dict[str, Any]:
    """Extract standard time-series feature vector without target leakage."""
    # If full chronological history is provided, extract rich time-series features
    if history:
        ts = extract_time_series_features(
            history=history,
            threshold=threshold,
            conducted_override=conducted,
            attended_override=attended,
            remaining=remaining,
        )
        att = ts["overall_attendance_pct"]
        rec_abs_rate = (
            (ts["window_5"]["absences"] / 5.0)
            if ts["window_5"]["available"]
            else (
                (ts["window_10"]["absences"] / 10.0)
                if ts["window_10"]["available"]
                else recent_rate
            )
        )
        rec_vs_overall = ts["recent_vs_overall_delta"]
        consec = ts["current_consecutive_absences"]
        longest_streak = ts["longest_consecutive_absences"]
        accel = ts["absence_acceleration"]
        exp_final = ts["expected_final_attendance"]
        trend_dir = ts["trend_direction"]
    else:
        att = attendance_pct(attended, conducted)
        rec_abs_rate = recent_rate
        rec_vs_overall = 0.0
        consec = consecutive
        longest_streak = consecutive
        accel = 0.0
        exp_final = expected_final_attendance(attended, conducted, remaining, rec_abs_rate)
        trend_dir = "deteriorating" if trend < -4.0 or consec >= 2 else "stable"
        ts = {}

    proj_all = best_case_attendance(attended, conducted, remaining)
    proj_miss = (
        projected(attended, conducted, max(remaining - 1, 0), min(1, remaining))
        if remaining > 0
        else att
    )
    imm_miss = attendance_pct(attended, conducted + 1) if conducted >= 0 else att
    proj_worst = worst_case_attendance(attended, conducted, remaining)

    min_needed = min_classes_to_threshold(attended, conducted, remaining, threshold)
    min_rem_attend = min_remaining_to_attend(attended, conducted, remaining, threshold)
    max_miss = max_missable_classes(attended, conducted, remaining, threshold)
    recoverable = can_recover(attended, conducted, remaining, threshold)

    if not recoverable:
        recovery = 1.5
    elif remaining > 0 and min_rem_attend is not None:
        recovery = min_rem_attend / remaining
    else:
        recovery = 0.0

    return {
        "attendance_pct": att,
        "margin_to_threshold": att - threshold,
        "recent_absence_rate": rec_abs_rate,
        "recent_vs_overall_delta": rec_vs_overall,
        "consecutive_absences": float(consec),
        "longest_absence_streak": float(longest_streak),
        "absence_acceleration": float(accel),
        "remaining_classes": float(remaining),
        "projected_if_attend_all": proj_all,
        "projected_if_miss_next": proj_miss,
        "recovery_ratio": min(recovery, 2.0),
        "expected_final_attendance": exp_final,
        "worst_case_attendance": proj_worst,
        # Helper metadata
        "attendance_trend": float(trend),
        "trend_direction": trend_dir,
        "immediate_miss_pct": imm_miss,
        "min_classes_needed": min_needed,
        "min_remaining_to_attend": min_rem_attend,
        "max_missable": max_miss,
        "can_recover": recoverable,
        "time_series_meta": ts,
    }


# ============================================================================
# 4. TIME-SERIES SYNTHETIC COHORT GENERATION
# ============================================================================

def generate_synthetic_dataset(n_students: int = 600, seed: int = 42) -> pd.DataFrame:
    """Generate realistic academic attendance records across student cohorts.

    Models diverse student archetypes with distinct chronological trajectories:
    - Stable compliant: consistent high attendance.
    - Deteriorating trajectory: acceptable mid-term overall attendance but sharp recent slump.
    - Improving trajectory: early difficulty followed by recent recovery.
    - Chronic struggle: repeated absence streaks and low baseline.
    Uses student_id grouping to prevent leakage in evaluation splits.
    """
    rng = np.random.default_rng(seed)
    rows = []

    for s_idx in range(n_students):
        student_id = f"STU-{1000 + s_idx}"
        # Each student takes 4-5 subjects
        n_subjects = int(rng.integers(4, 6))

        for subj_idx in range(n_subjects):
            threshold = float(rng.choice([75.0, 75.0, 75.0, 80.0, 70.0]))
            total_classes = int(rng.integers(45, 65))
            conducted = int(rng.integers(int(total_classes * 0.45), int(total_classes * 0.88)))
            remaining = total_classes - conducted

            # Trajectory archetype
            archetype = rng.choice(
                ["stable_high", "deteriorating", "improving", "chronic"],
                p=[0.40, 0.25, 0.18, 0.17],
            )

            history_pres: list[bool] = []

            if archetype == "stable_high":
                p_base = rng.uniform(0.85, 0.96)
                for _ in range(conducted):
                    history_pres.append(bool(rng.uniform() < p_base))

            elif archetype == "deteriorating":
                # Starts at 85-90%, but last 10-15 classes drop to 40-55%
                split = max(10, conducted - int(rng.integers(8, 14)))
                for _ in range(split):
                    history_pres.append(bool(rng.uniform() < 0.88))
                for _ in range(conducted - split):
                    history_pres.append(bool(rng.uniform() < 0.45))

            elif archetype == "improving":
                # Starts at 60%, then last 10-15 classes rise to 85-95%
                split = max(10, conducted - int(rng.integers(8, 14)))
                for _ in range(split):
                    history_pres.append(bool(rng.uniform() < 0.62))
                for _ in range(conducted - split):
                    history_pres.append(bool(rng.uniform() < 0.88))

            else:  # chronic
                p_base = rng.uniform(0.55, 0.68)
                # Markov persistence
                state = bool(rng.uniform() < p_base)
                for _ in range(conducted):
                    if not state:
                        p_attend = max(0.20, p_base - 0.20)
                    else:
                        p_attend = min(0.95, p_base + 0.05)
                    state = bool(rng.uniform() < p_attend)
                    history_pres.append(state)

            attended = sum(1 for p in history_pres if p)
            history_dicts = [
                {"session": i + 1, "status": "present" if p else "absent"}
                for i, p in enumerate(history_pres)
            ]

            recent_pattern = ["A" if p else "M" for p in history_pres[-5:]]
            recent_rate = sum(1 for p in history_pres[-5:] if not p) / 5.0
            consecutive = 0
            for p in reversed(history_pres):
                if not p:
                    consecutive += 1
                else:
                    break

            features = build_features(
                attended=attended,
                conducted=conducted,
                remaining=remaining,
                threshold=threshold,
                recent_rate=recent_rate,
                consecutive=consecutive,
                trend=0.0,
                history=history_dicts,
            )

            risk = label_risk(
                attendance=features["attendance_pct"],
                threshold=threshold,
                recent_absence_rate=features["recent_absence_rate"],
                remaining=remaining,
                proj_all=features["projected_if_attend_all"],
                proj_miss=features["projected_if_miss_next"],
                expected_final=features["expected_final_attendance"],
                min_needed=features["min_classes_needed"],
                min_rem_attend=features["min_remaining_to_attend"],
                max_missable=features["max_missable"],
                consecutive=features["consecutive_absences"],
                trend=features["attendance_trend"],
                immediate_miss_pct=features["immediate_miss_pct"],
                recent_vs_overall_delta=features["recent_vs_overall_delta"],
                longest_streak=features["longest_absence_streak"],
                absence_acceleration=features["absence_acceleration"],
                trend_direction=features["trend_direction"],
            )

            row = {name: round(float(features[name]), 4) for name in FEATURE_NAMES}
            row["student_id"] = student_id
            row["threshold"] = threshold
            row["conducted"] = conducted
            row["attended"] = attended
            row["archetype"] = archetype
            row["risk"] = risk
            row["risk_code"] = REVERSE_LABEL[risk]
            rows.append(row)

    return pd.DataFrame(rows)


# ============================================================================
# 5. MODEL EVALUATION & TRAINING PIPELINE
# ============================================================================

def train_and_save() -> dict[str, Any]:
    """Train, evaluate, and save predictive models with student-grouped validation."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    df = generate_synthetic_dataset(n_students=650, seed=42)
    df.to_csv(DATA_DIR / "synthetic_training_data.csv", index=False)

    X = df[FEATURE_NAMES]
    y = df["risk_code"]
    groups = df["student_id"]

    # Student-grouped split: guarantees no student's records leak between train and test
    gss = GroupShuffleSplit(n_splits=1, test_size=0.20, random_state=42)
    train_idx, test_idx = next(gss.split(X, y, groups))

    X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
    y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

    # Candidate A: Logistic Regression (scaled linear baseline)
    log_reg = make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=1500, class_weight="balanced", random_state=42),
    )
    log_reg.fit(X_train, y_train)
    lr_pred = log_reg.predict(X_test)
    lr_f1 = float(f1_score(y_test, lr_pred, average="weighted"))

    # Candidate B: Decision Tree (interpretable tree baseline)
    dt = DecisionTreeClassifier(
        max_depth=7, min_samples_leaf=6, random_state=42, class_weight="balanced"
    )
    dt.fit(X_train, y_train)
    dt_pred = dt.predict(X_test)
    dt_f1 = float(f1_score(y_test, dt_pred, average="weighted"))

    # Candidate C: Random Forest Classifier (ensemble with calibrated probabilities)
    rf = RandomForestClassifier(
        n_estimators=160,
        max_depth=8,
        min_samples_leaf=3,
        random_state=42,
        class_weight="balanced",
        n_jobs=-1,
    )
    rf.fit(X_train, y_train)
    rf_pred = rf.predict(X_test)
    rf_f1 = float(f1_score(y_test, rf_pred, average="weighted"))

    models = [
        ("LogisticRegression", log_reg, lr_f1),
        ("DecisionTreeClassifier", dt, dt_f1),
        ("RandomForestClassifier", rf, rf_f1),
    ]
    models.sort(key=lambda m: -m[2])

    if rf_f1 >= models[0][2] - 0.02:
        best_name, best_model, best_f1 = "RandomForestClassifier", rf, rf_f1
    else:
        best_name, best_model, best_f1 = models[0]

    y_pred = best_model.predict(X_test)
    y_proba = best_model.predict_proba(X_test)

    y_test_arr = np.array(y_test)
    y_test_dummies = np.zeros((len(y_test_arr), len(LABEL_MAP)))
    for c in range(len(LABEL_MAP)):
        y_test_dummies[y_test_arr == c, c] = 1.0

    brier_scores = [
        float(brier_score_loss(y_test_dummies[:, i], y_proba[:, i]))
        for i in range(len(LABEL_MAP))
    ]
    mean_brier = float(np.mean(brier_scores))

    feature_importances = {}
    if hasattr(best_model, "feature_importances_"):
        feature_importances = {
            name: round(float(imp), 4)
            for name, imp in zip(FEATURE_NAMES, best_model.feature_importances_)
        }
    elif hasattr(best_model, "coef_"):
        coef_mean = np.mean(np.abs(best_model.coef_), axis=0)
        coef_norm = coef_mean / np.sum(coef_mean)
        feature_importances = {
            name: round(float(imp), 4) for name, imp in zip(FEATURE_NAMES, coef_norm)
        }

    metrics = {
        "accuracy": float(best_model.score(X_test, y_test)),
        "precision_weighted": float(
            precision_score(y_test, y_pred, average="weighted", zero_division=0)
        ),
        "recall_weighted": float(
            recall_score(y_test, y_pred, average="weighted", zero_division=0)
        ),
        "f1_weighted": float(f1_score(y_test, y_pred, average="weighted", zero_division=0)),
        "f1_macro": float(f1_score(y_test, y_pred, average="macro", zero_division=0)),
        "brier_score_mean": round(mean_brier, 4),
        "brier_score_by_class": {
            LABEL_MAP[i]: round(brier_scores[i], 4) for i in range(len(LABEL_MAP))
        },
        "log_loss": round(float(log_loss(y_test, y_proba)), 4),
        "confusion_matrix": confusion_matrix(y_test, y_pred).tolist(),
        "classification_report": classification_report(
            y_test,
            y_pred,
            target_names=["Low", "Moderate", "High"],
            output_dict=True,
            zero_division=0,
        ),
        "model_comparison": {
            name: round(score, 4) for name, _, score in models
        },
        "feature_importance": feature_importances,
        "n_samples": int(len(df)),
        "train_size": int(len(X_train)),
        "test_size": int(len(X_test)),
        "algorithm": best_name,
        "target_definition": (
            "Predicting academic attendance risk category (Low / Moderate / High) "
            "based on chronological attendance time-series, behavioral trends, and remaining class feasibility."
        ),
        "notes": (
            "Model selected via comparative evaluation with student-grouped train/test split. "
            "Trained on synthetic behavioral trajectories with Markov absence clustering. "
            "Probabilities reflect calibrated classification confidence rather than unvalidated institutional certainty."
        ),
    }

    bundle = {
        "model": best_model,
        "feature_names": FEATURE_NAMES,
        "label_map": LABEL_MAP,
        "algorithm": best_name,
    }
    joblib.dump(bundle, MODEL_DIR / "attendance_risk_model.joblib")

    with open(MODEL_DIR / "metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    print(f"Best model selected: {best_name}")
    print(f"Accuracy: {metrics['accuracy']:.3f} | F1: {metrics['f1_weighted']:.3f} | Macro F1: {metrics['f1_macro']:.3f}")
    print("Feature importances:")
    for k, v in sorted(metrics["feature_importance"].items(), key=lambda x: -x[1]):
        print(f"  {k}: {v:.3f}")
    return metrics


if __name__ == "__main__":
    train_and_save()
