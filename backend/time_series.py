"""
Time-Series Analysis and Chronological Attendance Feature Engineering.

Analyzes individual, time-ordered class records for each subject to detect:
- Multi-window rolling attendance (5, 10, 20 classes).
- Absence behavior (streaks, clustering, acceleration).
- Trend direction (improving, stable, deteriorating).
- Adaptive behavioral forecasting (EWMA / momentum) combined with mathematical feasibility.
"""

from __future__ import annotations

import math
from typing import Any


def normalize_status(val: Any) -> bool | None:
    """Normalize diverse attendance representations to boolean.

    Returns:
      True if present/attended.
      False if absent/missed.
      None if unrecognized or invalid.
    """
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        if val == 1:
            return True
        if val == 0:
            return False
        return None

    s = str(val).strip().lower()
    if s in ("present", "p", "attended", "attend", "yes", "1"):
        return True
    if s in ("absent", "a_absent", "missed", "miss", "no", "m", "0"):
        return False
    # In legacy contexts, 'a' could mean attended or absent.
    # Default 'a' to attended if paired with 'm' (attended vs missed),
    # or absent if paired with 'p' (present vs absent).
    if s == "a":
        return True
    return None


def parse_chronological_records(records: list[Any]) -> list[dict[str, Any]]:
    """Parse, clean, validate, and sort chronological attendance records."""
    if not records:
        return []

    parsed: list[dict[str, Any]] = []

    for idx, item in enumerate(records):
        if isinstance(item, dict):
            # Dict record with session, date, status
            status_raw = item.get("status")
            if status_raw is None:
                status_raw = item.get("attended") or item.get("present")
            status = normalize_status(status_raw)
            if status is None:
                continue

            session_idx = item.get("session")
            if session_idx is None:
                session_idx = idx + 1
            date_str = str(item.get("date") or f"session_{session_idx}")

            parsed.append(
                {
                    "session": int(session_idx),
                    "date": date_str,
                    "present": bool(status),
                }
            )
        else:
            # Simple string or boolean in list
            status = normalize_status(item)
            if status is None:
                continue
            parsed.append(
                {
                    "session": idx + 1,
                    "date": f"session_{idx + 1}",
                    "present": bool(status),
                }
            )

    # Sort chronologically by session number or date
    parsed.sort(key=lambda r: (r["session"], r["date"]))
    return parsed


def extract_time_series_features(
    history: list[Any],
    threshold: float,
    conducted_override: int | None = None,
    attended_override: int | None = None,
    remaining: int = 0,
) -> dict[str, Any]:
    """Extract chronological time-series patterns and behavioral features.

    Marks multi-session windows as insufficient when history is inadequate
    rather than inventing records.
    """
    clean_history = parse_chronological_records(history)
    n_records = len(clean_history)

    # Determine conducted and attended classes
    if n_records > 0:
        conducted = n_records
        attended = sum(1 for r in clean_history if r["present"])
        missed = conducted - attended
        status_sequence = [r["present"] for r in clean_history]
    else:
        conducted = max(0, int(conducted_override or 0))
        attended = max(0, min(conducted, int(attended_override or 0)))
        missed = conducted - attended
        status_sequence = []

    # A. Overall Attendance
    if conducted > 0:
        overall_pct = (attended / conducted) * 100.0
    else:
        overall_pct = 100.0

    margin = overall_pct - float(threshold)

    # B. Multi-Window Recent Attendance
    def compute_window(window_size: int) -> dict[str, Any]:
        if len(status_sequence) < window_size:
            return {
                "available": False,
                "window_size": window_size,
                "attended": None,
                "rate": None,
                "absences": None,
            }
        sub = status_sequence[-window_size:]
        att_sub = sum(1 for p in sub if p)
        return {
            "available": True,
            "window_size": window_size,
            "attended": att_sub,
            "rate": round(att_sub / window_size, 4),
            "absences": window_size - att_sub,
        }

    w5 = compute_window(5)
    w10 = compute_window(10)
    w20 = compute_window(20)

    # C. Absence Behavior (Streaks, Clustering, Acceleration)
    if status_sequence:
        # Current consecutive absence streak
        curr_streak = 0
        for p in reversed(status_sequence):
            if not p:
                curr_streak += 1
            else:
                break

        # Longest consecutive absence streak
        longest_streak = 0
        running_streak = 0
        for p in status_sequence:
            if not p:
                running_streak += 1
                if running_streak > longest_streak:
                    longest_streak = running_streak
            else:
                running_streak = 0

        # Classes since most recent absence
        since_last = 0
        for p in reversed(status_sequence):
            if p:
                since_last += 1
            else:
                break
        # If never missed any class:
        if missed == 0:
            since_last = conducted

        # Absence acceleration: compare recent 10 (or second half) with earlier 10 (or first half)
        if len(status_sequence) >= 10:
            mid = len(status_sequence) // 2
            first_half = status_sequence[:mid]
            second_half = status_sequence[mid:]
            first_abs_rate = sum(1 for p in first_half if not p) / max(1, len(first_half))
            second_abs_rate = sum(1 for p in second_half if not p) / max(1, len(second_half))
            acceleration = round(second_abs_rate - first_abs_rate, 4)
            is_accelerating = acceleration >= 0.15
        elif w5["available"]:
            overall_abs_rate = missed / max(1, conducted)
            recent_5_abs_rate = w5["absences"] / 5.0
            acceleration = round(recent_5_abs_rate - overall_abs_rate, 4)
            is_accelerating = acceleration >= 0.20
        else:
            acceleration = 0.0
            is_accelerating = False

        # Clustering index: check if absences occur in tight clusters
        # Measures ratio of consecutive absence pairs to total absences
        if missed >= 2:
            consec_pairs = sum(
                1 for i in range(len(status_sequence) - 1)
                if not status_sequence[i] and not status_sequence[i + 1]
            )
            clustering_index = round(consec_pairs / max(1, missed - 1), 4)
        else:
            clustering_index = 0.0

    else:
        curr_streak = 0
        longest_streak = 0
        since_last = conducted if missed == 0 else 0
        acceleration = 0.0
        is_accelerating = False
        clustering_index = 0.0

    # D. Attendance Trends & Momentum
    # Reference recent rate: prefer w10, fallback to w5, fallback to overall
    if w10["available"]:
        recent_reference_rate = w10["rate"] * 100.0
        recent_window_used = 10
    elif w5["available"]:
        recent_reference_rate = w5["rate"] * 100.0
        recent_window_used = 5
    else:
        recent_reference_rate = overall_pct
        recent_window_used = 0

    recent_vs_overall_delta = round(recent_reference_rate - overall_pct, 2)

    if recent_vs_overall_delta <= -5.0 or curr_streak >= 2:
        trend_direction = "deteriorating"
    elif recent_vs_overall_delta >= 5.0 and curr_streak == 0:
        trend_direction = "improving"
    else:
        trend_direction = "stable"

    significant_shift = abs(recent_vs_overall_delta) >= 15.0 and (w10["available"] or w5["available"])

    # E. Behavioral Time-Series Forecast (Adaptive EWMA)
    # Weights recent performance (alpha=0.6) with historical baseline (1-alpha=0.4)
    # If absence is accelerating, adaptively dampens forecast
    if recent_window_used > 0:
        rec_fraction = recent_reference_rate / 100.0
        ov_fraction = overall_pct / 100.0
        adaptive_forecast_rate = (0.65 * rec_fraction) + (0.35 * ov_fraction)
        if is_accelerating and adaptive_forecast_rate > 0.40:
            adaptive_forecast_rate = max(0.20, adaptive_forecast_rate - 0.10)
    else:
        adaptive_forecast_rate = overall_pct / 100.0

    adaptive_forecast_rate = max(0.0, min(1.0, adaptive_forecast_rate))

    # Expected final attendance under behavioral forecast
    r_rem = max(0, int(remaining))
    exp_attend_future = int(round(r_rem * adaptive_forecast_rate))
    exp_miss_future = r_rem - exp_attend_future
    total_final = conducted + r_rem

    if total_final > 0:
        expected_final_pct = round(((attended + exp_attend_future) / total_final) * 100.0, 2)
        best_case_pct = round(((attended + r_rem) / total_final) * 100.0, 2)
        worst_case_pct = round((attended / total_final) * 100.0, 2)
    else:
        expected_final_pct = 100.0
        best_case_pct = 100.0
        worst_case_pct = 100.0

    return {
        "conducted": conducted,
        "attended": attended,
        "missed": missed,
        "overall_attendance_pct": round(overall_pct, 2),
        "margin_to_threshold": round(margin, 2),
        "history_length": n_records,
        "has_full_history": n_records >= 10,
        "window_5": w5,
        "window_10": w10,
        "window_20": w20,
        "recent_window_used": recent_window_used,
        "recent_reference_rate": round(recent_reference_rate, 2),
        "recent_vs_overall_delta": recent_vs_overall_delta,
        "current_consecutive_absences": curr_streak,
        "longest_consecutive_absences": longest_streak,
        "sessions_since_last_absence": since_last,
        "absence_acceleration": acceleration,
        "is_absence_accelerating": is_accelerating,
        "absence_clustering_index": clustering_index,
        "trend_direction": trend_direction,
        "significant_shift_detected": significant_shift,
        "adaptive_forecast_rate": round(adaptive_forecast_rate, 4),
        "expected_final_attendance": expected_final_pct,
        "best_case_attendance": best_case_pct,
        "worst_case_attendance": worst_case_pct,
    }
