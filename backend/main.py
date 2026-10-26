"""
FastAPI backend for AI-Based Academic Attendance Risk Prediction and Early Warning System.

Exposes student sample data, time-series ML risk predictions, explainable factor analysis,
mathematical scenario simulations, and evaluation metrics.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from time_series import (
    extract_time_series_features,
    normalize_status,
    parse_chronological_records,
)
from train_model import (
    FEATURE_NAMES,
    LABEL_MAP,
    attendance_pct,
    attendance_trend,
    best_case_attendance,
    build_features,
    calculate_simulation_scenarios,
    can_recover,
    consecutive_absences,
    expected_final_attendance,
    generate_personalized_recommendation,
    label_risk,
    max_missable_classes,
    min_classes_to_threshold,
    min_remaining_to_attend,
    projected,
    projected_from_percentage,
    recent_absence_rate,
    train_and_save,
    worst_case_attendance,
)

ROOT = Path(__file__).parent
MODEL_PATH = ROOT / "model" / "attendance_risk_model.joblib"
METRICS_PATH = ROOT / "model" / "metrics.json"
SAMPLE_PATH = ROOT / "data" / "sample_student.json"

app = FastAPI(
    title="LaterAlligator API",
    description="Educational Data Science prototype: LaterAlligator Time-Series Attendance Risk Classifier & Early Warning System",
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_bundle: dict[str, Any] | None = None
_metrics: dict[str, Any] | None = None


def load_model() -> dict[str, Any]:
    global _bundle, _metrics
    if not MODEL_PATH.exists():
        train_and_save()
    _bundle = joblib.load(MODEL_PATH)
    if METRICS_PATH.exists():
        with open(METRICS_PATH, encoding="utf-8") as f:
            _metrics = json.load(f)
    return _bundle


def get_bundle() -> dict[str, Any]:
    global _bundle
    if _bundle is None:
        load_model()
    assert _bundle is not None
    return _bundle


def explain_prediction(
    features: dict[str, Any], risk: str, threshold: float
) -> list[dict[str, str]]:
    """Generate factor explanations grounded strictly in actual chronological evidence."""
    factors: list[dict[str, str]] = []
    margin = float(features["margin_to_threshold"])
    att = float(features["attendance_pct"])
    recent_abs = float(features["recent_absence_rate"])
    rec_vs_overall = float(features.get("recent_vs_overall_delta", 0.0))
    consecutive = int(features.get("consecutive_absences", 0))
    longest_streak = int(features.get("longest_absence_streak", consecutive))
    accel = float(features.get("absence_acceleration", 0.0))
    trend_dir = str(features.get("trend_direction", "stable"))
    remaining = int(features["remaining_classes"])
    proj_all = float(features["projected_if_attend_all"])
    proj_miss = float(features["projected_if_miss_next"])
    exp_final = float(features.get("expected_final_attendance", att))
    min_rem = features.get("min_remaining_to_attend")
    max_miss = features.get("max_missable")
    recoverable = bool(features.get("can_recover", True))
    ts_meta = features.get("time_series_meta") or {}

    # Factor 1: Current Compliance Status
    if att < threshold:
        factors.append(
            {
                "factor": "Below Required Threshold",
                "impact": "high",
                "detail": f"Current attendance ({att:.1f}%) is {abs(margin):.1f} points below the {threshold:.0f}% minimum requirement.",
            }
        )
    elif margin < 4.0:
        factors.append(
            {
                "factor": "Narrow Safety Margin",
                "impact": "high",
                "detail": f"Current attendance ({att:.1f}%) is only {margin:.1f} percentage points above the {threshold:.0f}% threshold.",
            }
        )
    else:
        factors.append(
            {
                "factor": "Comfortable Safety Margin",
                "impact": "low",
                "detail": f"Current attendance ({att:.1f}%) maintains a healthy {margin:.1f} point buffer above {threshold:.0f}%.",
            }
        )

    # Factor 2: Time-Series Trend & Deterioration Detection
    if rec_vs_overall <= -15.0:
        factors.append(
            {
                "factor": "Acute Attendance Deterioration",
                "impact": "high",
                "detail": f"Recent attendance is substantially lower than overall performance ({rec_vs_overall:+.1f} point shift), indicating emerging behavioral risk.",
            }
        )
    elif rec_vs_overall <= -6.0:
        factors.append(
            {
                "factor": "Downward Attendance Trend",
                "impact": "moderate",
                "detail": f"Recent attendance has softened by {abs(rec_vs_overall):.1f} points relative to the semester average.",
            }
        )
    elif rec_vs_overall >= 6.0 and consecutive == 0:
        factors.append(
            {
                "factor": "Improving Attendance Momentum",
                "impact": "low",
                "detail": f"Recent attendance demonstrates upward recovery ({rec_vs_overall:+.1f} points above overall average).",
            }
        )

    # Factor 3: Absence Acceleration & Streak Analysis
    if consecutive >= 2:
        factors.append(
            {
                "factor": "Consecutive Absence Streak",
                "impact": "high",
                "detail": f"Currently on a streak of {consecutive} consecutive missed classes (longest streak: {longest_streak}).",
            }
        )
    elif accel >= 0.15:
        factors.append(
            {
                "factor": "Absence Frequency Accelerating",
                "impact": "high",
                "detail": f"Absences have increased by {accel * 100:.0f}% in recent sessions compared to earlier weeks.",
            }
        )
    elif recent_abs >= 0.35:
        factors.append(
            {
                "factor": "Elevated Recent Absence Rate",
                "impact": "high",
                "detail": f"Missed {recent_abs * 100:.0f}% of recent sessions, placing pressure on remaining recovery capacity.",
            }
        )

    # Factor 4: Future Feasibility & Recovery
    if not recoverable:
        factors.append(
            {
                "factor": "Mathematically Unrecoverable",
                "impact": "high",
                "detail": f"Even perfect 100% attendance across all {remaining} remaining classes cannot reach the {threshold:.0f}% threshold (at most {proj_all:.1f}%).",
            }
        )
    elif min_rem is not None and remaining > 0:
        pct_needed = (min_rem / remaining) * 100.0
        if pct_needed >= 70.0:
            factors.append(
                {
                    "factor": "Demanding Recovery Window",
                    "impact": "high",
                    "detail": f"Must attend at least {min_rem} of the {remaining} remaining classes ({pct_needed:.0f}% attendance rate) to finish compliant.",
                }
            )
        elif att < threshold:
            factors.append(
                {
                    "factor": "Feasible Recovery Window",
                    "impact": "moderate",
                    "detail": f"Recovery is achievable: attend at least {min_rem} of the {remaining} remaining classes to reach {threshold:.0f}%.",
                }
            )

    # Factor 5: Sensitivity on Next Class
    if remaining > 0 and recoverable:
        if proj_miss < threshold:
            factors.append(
                {
                    "factor": "Zero Tolerance on Next Class",
                    "impact": "high",
                    "detail": f"Missing the next session drops attendance to {proj_miss:.1f}%, causing an immediate threshold violation.",
                }
            )
        elif max_miss is not None and max_miss <= 2:
            factors.append(
                {
                    "factor": "Thin Absence Buffer",
                    "impact": "moderate",
                    "detail": f"You can afford at most {max_miss} more absence{'s' if max_miss != 1 else ''} in the remaining {remaining} classes before breaching {threshold:.0f}%.",
                }
            )

    # Factor 6: Time-Series History Disclosure
    has_full = ts_meta.get("has_full_history", False)
    if has_full:
        factors.append(
            {
                "factor": "Chronological History Depth",
                "impact": "info",
                "detail": f"Analyzed {ts_meta.get('history_length', 0)} sequential class sessions with multi-window rolling verification.",
            }
        )
    else:
        factors.append(
            {
                "factor": "Historical Window Status",
                "impact": "info",
                "detail": "Extended multi-session windows (10- and 20-class) are marked as insufficient due to limited historical depth.",
            }
        )

    # Factor 7: Model Architecture
    factors.append(
        {
            "factor": "Classification Model",
            "impact": "info",
            "detail": f"Assigned {risk} risk via validated time-series ML model trained with student-grouped cross-validation.",
        }
    )

    return factors


def recommendation_for(
    risk: str, features: dict[str, Any], threshold: float, semester_total: int | None = None
) -> str:
    """Generate unambiguous, actionable guidance using exact calculated numbers."""
    att = float(features["attendance_pct"])
    remaining = int(features["remaining_classes"])
    cond = int(features.get("conducted", 50))
    att_count = int(features.get("attended", round((att / 100.0) * cond)))
    rec_data = generate_personalized_recommendation(
        attended=att_count,
        conducted=cond,
        remaining=remaining,
        threshold=threshold,
        semester_total=semester_total,
    )
    return rec_data["recommendation"]


def predict_subject(
    attended: int | None = None,
    conducted: int | None = None,
    remaining: int = 0,
    threshold: float = 75.0,
    recent_pattern: list[str] | None = None,
    weekly_trend: list[float] | None = None,
    attendance_history: list[Any] | None = None,
    semester_total: int | None = None,
) -> dict[str, Any]:
    """Execute time-series prediction pipeline using chronological attendance history."""
    clean_history = parse_chronological_records(attendance_history or [])
    pattern = recent_pattern or []
    trend_list = weekly_trend or []

    # If history is provided, derive conducted and attended from records
    if clean_history:
        n_cond = len(clean_history)
        n_att = sum(1 for r in clean_history if r["present"])
    else:
        n_cond = max(0, int(conducted or 0))
        n_att = max(0, min(n_cond, int(attended or 0)))

    recent_rate = recent_absence_rate(pattern)
    consec = consecutive_absences(pattern)
    trend = attendance_trend(trend_list)

    features = build_features(
        attended=n_att,
        conducted=n_cond,
        remaining=remaining,
        threshold=threshold,
        recent_rate=recent_rate,
        consecutive=consec,
        trend=trend,
        history=clean_history,
    )

    bundle = get_bundle()
    model = bundle["model"]
    algo = bundle.get("algorithm", "RandomForestClassifier")

    # Construct input vector matching FEATURE_NAMES exactly
    vector = pd.DataFrame(
        [[features[name] for name in FEATURE_NAMES]],
        columns=FEATURE_NAMES,
    )

    pred_code = int(model.predict(vector)[0])
    proba = model.predict_proba(vector)[0]
    risk = LABEL_MAP[pred_code]

    att = features["attendance_pct"]
    proj_all = features["projected_if_attend_all"]
    proj_miss = features["projected_if_miss_next"]
    proj_worst = features["worst_case_attendance"]
    exp_final = features["expected_final_attendance"]

    scenarios = {
        "attend_all": round(proj_all, 2),
        "miss_next": round(proj_miss, 2),
        "miss_two": round(
            projected(n_att, n_cond, max(remaining - 2, 0), min(2, remaining)),
            2,
        ),
        "miss_three": round(
            projected(n_att, n_cond, max(remaining - 3, 0), min(3, remaining)),
            2,
        ),
    }

    probabilities = {
        LABEL_MAP[i]: round(float(proba[i]), 4) for i in range(len(proba))
    }

    rec_analysis = generate_personalized_recommendation(
        attended=n_att,
        conducted=n_cond,
        remaining=remaining,
        threshold=threshold,
        semester_total=semester_total,
    )

    return {
        "risk": risk,
        "risk_code": pred_code,
        "probabilities": probabilities,
        "prediction_type": "trained_model",
        "model": algo,
        "features": {
            k: (round(float(v), 4) if isinstance(v, (float, int)) and not isinstance(v, bool) else v)
            for k, v in features.items()
            if k != "time_series_meta"
        },
        "time_series": features.get("time_series_meta", {}),
        "current_attendance": 100.0 if n_cond == 0 else rec_analysis["current_attendance"],
        "threshold": threshold,
        "attended": n_att,
        "absent": n_cond - n_att,
        "conducted": n_cond,
        "remaining": remaining,
        "semester_total": rec_analysis["semester_total"],
        "scenarios": scenarios,
        "min_classes_to_threshold": rec_analysis["min_classes_to_threshold"],
        "min_consecutive_to_threshold": rec_analysis["min_consecutive_to_threshold"],
        "min_remaining_to_attend": features["min_remaining_to_attend"],
        "max_missable": rec_analysis["max_missable"],
        "can_recover": rec_analysis["can_recover"],
        "expected_final_attendance": round(exp_final, 2),
        "worst_case_attendance": round(proj_worst, 2),
        "projected_final_if_attend_all": rec_analysis["projected_final_if_attend_all"],
        "compliance_status": "Compliant" if att >= threshold else "Non-Compliant",
        "factors": explain_prediction(features, risk, threshold),
        "recommendation": rec_analysis["recommendation"],
        "recommendation_analysis": rec_analysis,
        "disclaimer": (
            "Predictions are generated by a time-series machine learning model trained on simulated student attendance cohorts. "
            "Results provide academic risk indications, trend alerts, and scenario projections for early intervention."
        ),
    }


def generate_alerts(subjects: list[dict[str, Any]], threshold: float) -> list[dict[str, str]]:
    """Generate deduplicated, time-series grounded early warning alerts with distinct severities."""
    alerts: list[dict[str, str]] = []

    for subj in subjects:
        if not subj.get("has_records", True) or subj.get("conducted", 0) == 0:
            continue
        name = subj["name"]
        pred = subj["prediction"]
        risk = pred["risk"]
        att = pred["current_attendance"]
        if att is None:
            continue
        min_rem = pred.get("min_remaining_to_attend")
        max_miss = pred.get("max_missable")
        can_rec = pred.get("can_recover", True)
        remaining = subj["remaining"]
        miss_next = pred["scenarios"]["miss_next"]
        rec_delta = float(pred["features"].get("recent_vs_overall_delta", 0.0))

        # Alert 1: Unrecoverable subject
        if not can_rec:
            alerts.append(
                {
                    "severity": "critical",
                    "subject": name,
                    "message": f"{name}: attendance ({att:.1f}%) cannot reach {threshold:.0f}% even with 100% attendance in all {remaining} remaining classes — mentor contact required.",
                }
            )
            continue

        # Alert 2: Acute deterioration alert (even if currently compliant!)
        if rec_delta <= -15.0 and att >= threshold:
            alerts.append(
                {
                    "severity": "critical",
                    "subject": name,
                    "message": f"{name} shows acute recent deterioration ({rec_delta:+.1f} points below average) — emerging risk requires immediate intervention.",
                }
            )

        # Alert 3: High risk
        if risk == "High":
            if att < threshold:
                alerts.append(
                    {
                        "severity": "critical",
                        "subject": name,
                        "message": f"{name}: attendance is {att:.1f}% (below {threshold:.0f}%). Immediate corrective attendance required.",
                    }
                )
                if min_rem is not None and remaining > 0:
                    alerts.append(
                        {
                            "severity": "action",
                            "subject": name,
                            "message": f"Must attend at least {min_rem} of the next {remaining} classes in {name} to regain compliance.",
                        }
                    )
            elif rec_delta > -15.0:
                alerts.append(
                    {
                        "severity": "critical",
                        "subject": name,
                        "message": f"{name}: high risk due to critical buffer — missing 1 more class drops attendance to {miss_next:.1f}% (below {threshold:.0f}%).",
                    }
                )

        # Alert 4: Moderate risk
        elif risk == "Moderate":
            if rec_delta <= -6.0:
                alerts.append(
                    {
                        "severity": "warning",
                        "subject": name,
                        "message": f"{name}: recent attendance has softened by {abs(rec_delta):.1f} points — reverse the downward trend to protect compliance.",
                    }
                )
            elif miss_next < threshold:
                alerts.append(
                    {
                        "severity": "warning",
                        "subject": name,
                        "message": f"{name} ({att:.1f}%): missing the next class drops attendance to {miss_next:.1f}% (below {threshold:.0f}% minimum).",
                    }
                )
            else:
                alerts.append(
                    {
                        "severity": "warning",
                        "subject": name,
                        "message": f"{name} ({att:.1f}%): buffer is narrow (at most {max_miss} absences allowed across {remaining} remaining classes).",
                    }
                )

        # Alert 5: Low risk with small buffer caution
        elif remaining > 0 and max_miss is not None and max_miss <= 3:
            alerts.append(
                {
                    "severity": "info",
                    "subject": name,
                    "message": f"{name} is currently compliant ({att:.1f}%), but avoid consecutive absences to protect your {max_miss}-class buffer.",
                }
            )

    return alerts


# ============================================================================
# API MODELS & ROUTES
# ============================================================================

class PredictRequest(BaseModel):
    attended: int | None = None
    conducted: int | None = None
    remaining: int = Field(ge=0)
    semester_total: int | None = None
    threshold: float = Field(default=75.0, ge=50.0, le=100.0)
    attendance_history: list[dict[str, Any] | str] = Field(default_factory=list)
    recent_pattern: list[str] = Field(default_factory=list)
    weekly_trend: list[float] = Field(default_factory=list)
    attend_next: int | None = None
    miss_next: int | None = None


class SimulateRequest(BaseModel):
    attended: int | None = None
    conducted: int | None = None
    percentage: float | None = None
    current_pct: float | None = None
    conducted_est: int | None = None
    remaining: int = Field(ge=0)
    threshold: float = Field(default=75.0, ge=50.0, le=100.0)
    attend: int = Field(ge=0)
    miss: int = Field(ge=0)
    semester_total: int | None = None


@app.on_event("startup")
def startup() -> None:
    load_model()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "model_loaded": MODEL_PATH.exists()}


@app.get("/api/student")
def get_student(threshold: float | None = None) -> dict[str, Any]:
    if not SAMPLE_PATH.exists():
        raise HTTPException(404, "Sample student data not found")
    with open(SAMPLE_PATH, encoding="utf-8") as f:
        payload = json.load(f)

    if threshold is None:
        threshold = float(payload["student"]["threshold"])
    else:
        threshold = float(threshold)
        payload["student"]["threshold"] = threshold
    subjects_out = []
    risk_counts = {"Low": 0, "Moderate": 0, "High": 0}

    for subj in payload["subjects"]:
        if not subj.get("has_records", True) or subj.get("conducted", 0) == 0:
            pred = {
                "risk": "Unavailable",
                "risk_code": -1,
                "current_attendance": None,
                "displayed_attendance": subj.get("displayed_attendance", "No attendance recorded"),
                "has_records": False,
                "compliance_status": "Unavailable",
                "can_recover": True,
                "is_unrecoverable": False,
                "min_classes_to_threshold": None,
                "min_remaining_to_attend": None,
                "max_missable": None,
                "probabilities": {"Low": 0.0, "Moderate": 0.0, "High": 0.0},
                "factors": [],
                "scenarios": {
                    "attend_all": None,
                    "miss_next": None,
                    "miss_two": None,
                    "miss_three": None,
                },
                "model": "none",
                "features": {
                    "attendance_pct": 0.0,
                    "margin_to_threshold": 0.0,
                    "remaining_classes": 0,
                    "recent_absence_rate": 0.0,
                    "consecutive_absences": 0,
                    "longest_absence_streak": 0,
                    "absence_acceleration": 0.0,
                    "trend_direction": "stable",
                    "projected_if_attend_all": 0.0,
                    "projected_if_miss_next": 0.0,
                    "expected_final_attendance": 0.0,
                    "worst_case_attendance": 0.0,
                    "can_recover": True,
                },
                "recommendation": "No attendance recorded yet for this subject. Projections will become available once classes commence.",
            }
            subjects_out.append({**subj, "prediction": pred})
            continue

        pred = predict_subject(
            attended=subj["attended"],
            conducted=subj["conducted"],
            remaining=subj["remaining"],
            threshold=threshold,
            recent_pattern=subj.get("recent_pattern"),
            weekly_trend=subj.get("weekly_trend"),
            attendance_history=subj.get("attendance_history"),
            semester_total=subj.get("semester_total"),
        )
        risk_counts[pred["risk"]] += 1
        subjects_out.append({**subj, "prediction": pred})

    recorded = [s for s in payload["subjects"] if s.get("has_records", True) and s.get("conducted", 0) > 0]
    total_attended = sum(s["attended"] for s in recorded)
    total_conducted = sum(s["conducted"] for s in recorded)
    total_remaining = sum(s["remaining"] for s in payload["subjects"])
    overall = (total_attended / total_conducted * 100.0) if total_conducted > 0 else 0.0

    alerts = generate_alerts(subjects_out, threshold)

    overall_risk = (
        "High"
        if risk_counts["High"] > 0
        else "Moderate"
        if risk_counts["Moderate"] > 0
        else "Low"
    )

    return {
        "student": payload["student"],
        "subjects": subjects_out,
        "summary": {
            "overall_attendance": round(overall, 2),
            "total_attended": total_attended,
            "total_conducted": total_conducted,
            "total_missed": total_conducted - total_attended,
            "total_remaining": total_remaining,
            "threshold": threshold,
            "risk_counts": risk_counts,
            "overall_risk": overall_risk,
            "compliance_status": "Compliant" if overall >= threshold else "Non-Compliant",
        },
        "alerts": alerts,
        "cohort_summary": payload.get("cohort_summary"),
        "prediction_type": "trained_model",
    }


@app.post("/api/predict")
def predict(req: PredictRequest) -> dict[str, Any]:
    if req.conducted is not None and req.attended is not None and req.conducted < req.attended:
        raise HTTPException(400, "conducted classes must be >= attended classes")
    return predict_subject(
        attended=req.attended,
        conducted=req.conducted,
        remaining=req.remaining,
        threshold=req.threshold,
        recent_pattern=req.recent_pattern,
        weekly_trend=req.weekly_trend,
        attendance_history=req.attendance_history,
        semester_total=req.semester_total,
    )


@app.post("/api/simulate")
def simulate(req: SimulateRequest) -> dict[str, Any]:
    if req.conducted is not None and req.attended is not None and req.conducted < req.attended:
        raise HTTPException(400, "conducted classes must be >= attended classes")
    if req.semester_total is not None and req.conducted is not None and req.conducted > req.semester_total:
        raise HTTPException(
            400,
            f"conducted classes ({req.conducted}) cannot exceed total semester classes ({req.semester_total})",
        )
    if req.attend + req.miss > req.remaining:
        raise HTTPException(
            400,
            f"attend ({req.attend}) + miss ({req.miss}) cannot exceed remaining classes ({req.remaining})",
        )
    if req.attended is None and req.conducted is None and req.percentage is None and req.current_pct is None:
        raise HTTPException(400, "Either class counts (attended, conducted) or current percentage must be provided")

    pct_input = req.percentage if req.percentage is not None else req.current_pct
    c_est = req.conducted_est if req.conducted_est is not None and req.conducted_est > 0 else 50

    return calculate_simulation_scenarios(
        attended=req.attended,
        conducted=req.conducted,
        remaining=req.remaining,
        threshold=req.threshold,
        attend=req.attend,
        miss=req.miss,
        current_pct=pct_input,
        conducted_est=c_est,
        semester_total=req.semester_total,
    )


@app.get("/api/metrics")
def metrics() -> dict[str, Any]:
    get_bundle()
    if _metrics is None and METRICS_PATH.exists():
        with open(METRICS_PATH, encoding="utf-8") as f:
            return json.load(f)
    if _metrics is None:
        raise HTTPException(404, "Metrics not available")
    return _metrics


@app.get("/api/methodology")
def methodology() -> dict[str, Any]:
    return {
        "title": "LaterAlligator — AI Methodology: Attendance Risk Prediction & Early Warning System",
        "pipeline": [
            {
                "step": 1,
                "name": "Chronological Data Ingestion",
                "detail": (
                    "Ingest chronological class session logs: sequential timestamps, present/absent statuses, "
                    "remaining semester schedule, and institutional course calendars."
                ),
            },
            {
                "step": 2,
                "name": "Time-Series Pattern & Feature Extraction",
                "detail": (
                    "Compute multi-window rolling attendance (5, 10, 20 classes), consecutive streaks, "
                    "absence acceleration, trend momentum, and closed-form mathematical feasibility without future leakage."
                ),
            },
            {
                "step": 3,
                "name": "Model Training with Student-Grouped Splits",
                "detail": (
                    "Evaluate Logistic Regression, Decision Tree, and Random Forest classifiers using "
                    "GroupShuffleSplit to ensure student-level independence between training and validation."
                ),
            },
            {
                "step": 4,
                "name": "Adaptive Behavioral Forecasting & Risk Classification",
                "detail": (
                    "Combine adaptive EWMA behavioral projections with deterministic mathematical bounds "
                    "to classify risk (Low, Moderate, High) and output calibrated probabilities."
                ),
            },
            {
                "step": 5,
                "name": "Evidence-Based Explainable AI (XAI)",
                "detail": (
                    "Generate human-readable factor cards identifying deterioration velocity, consecutive streaks, "
                    "and recovery requirements grounded strictly in actual session records."
                ),
            },
            {
                "step": 6,
                "name": "Proactive Early Warning Alerts",
                "detail": (
                    "Issue early warnings before threshold violations occur when acute deterioration or absence acceleration is detected."
                ),
            },
            {
                "step": 7,
                "name": "What-If Scenario Simulation",
                "detail": (
                    "Provide deterministic interactive mathematical projections allowing students to simulate future attendance outcomes."
                ),
            },
        ],
        "assumptions": [
            "Attendance history is chronologically ordered with unique session indices.",
            "Attending increases attended and conducted counts by 1; missing increases conducted only.",
            "Default minimum required attendance is 75% unless customized by institution.",
            "Training utilizes realistic Markov behavioral simulations with absence clustering and trajectory archetypes.",
        ],
        "limitations": [
            "Rolling windows (e.g. 10 or 20 classes) are marked as insufficient when historical depth is inadequate.",
            "Medical leave and official institutional exemptions require separate administrative condonation.",
            "Synthetic validation results demonstrate pipeline validity but do not replace multi-semester institutional calibration.",
            "What-if projections represent deterministic mathematical bounds rather than behavioral forecasts.",
        ],
        "features": FEATURE_NAMES,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
