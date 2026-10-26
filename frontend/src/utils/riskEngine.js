import {
  attendancePct,
  attendanceTrend,
  bestCaseAttendance,
  canRecover,
  consecutiveAbsences,
  expectedFinalAttendance,
  generatePersonalizedRecommendation,
  maxMissableClasses,
  minClassesToThreshold,
  minRemainingToAttend,
  projectedAttendance,
  recentAbsenceRate,
  worstCaseAttendance,
} from './attendance.js';
import { extractTimeSeriesFeatures } from './timeSeries.js';

export { recentAbsenceRate };

export function classifyRisk({
  attended,
  conducted,
  remaining,
  threshold,
  recentPattern = [],
  weeklyTrend = [],
  attendanceHistory = [],
  semesterTotal = null,
}) {
  let att = Number(attended) || 0;
  let cond = Number(conducted) || 0;
  const rem = Math.max(0, Number(remaining) || 0);
  const thr = Number(threshold);

  const ts = extractTimeSeriesFeatures({
    history: attendanceHistory,
    threshold: thr,
    conductedOverride: cond,
    attendedOverride: att,
    remaining: rem,
  });

  if (cond === 0 && (!attendanceHistory || attendanceHistory.length === 0)) {
    return {
      risk: 'Unavailable',
      risk_code: -1,
      current_attendance: null,
      displayed_attendance: 'No attendance recorded',
      has_records: false,
      compliance_status: 'Unavailable',
      can_recover: true,
      is_unrecoverable: false,
      min_classes_to_threshold: null,
      min_remaining_to_attend: null,
      max_missable: null,
      probabilities: { Low: 0.0, Moderate: 0.0, High: 0.0 },
      factors: [],
      scenarios: { attend_all: null, miss_next: null, miss_two: null, miss_three: null },
      model: 'none',
      recommendation:
        'No attendance recorded yet for this subject. Projections will become available once classes commence.',
    };
  }

  const attendance = attendancePct(att, cond);
  const margin = attendance - thr;
  let recent = ts.window_5.available ? (ts.window_5.absences / 5.0) : recentAbsenceRate(recentPattern);
  let consec = ts.history_length > 0 ? ts.current_consecutive_absences : consecutiveAbsences(recentPattern);
  let trend = ts.history_length > 0 ? ts.recent_vs_overall_delta : attendanceTrend(weeklyTrend);

  const projAll = bestCaseAttendance(att, cond, rem);
  const projMiss =
    rem > 0
      ? projectedAttendance(att, cond, Math.max(rem - 1, 0), Math.min(1, rem))
      : attendance;
  const projWorst = worstCaseAttendance(att, cond, rem);
  const expFinal = ts.history_length > 0 ? ts.expected_final_attendance : expectedFinalAttendance(att, cond, rem, recent);

  const minNeeded = minClassesToThreshold(att, cond, rem, thr);
  const minRemAttend = minRemainingToAttend(att, cond, rem, thr);
  const maxMissable = maxMissableClasses(att, cond, rem, thr);
  const recoverable = canRecover(att, cond, rem, thr);

  const recoveryRatio =
    rem > 0 && minNeeded !== null ? minNeeded / rem : recoverable ? 0 : 1.5;

  let risk = 'Low';

  // 1. Unrecoverable -> strictly High Risk
  if (!recoverable) {
    risk = 'High';
  } else if (rem <= 0) {
    risk = attendance >= thr ? 'Low' : 'High';
  } else if (attendance < thr) {
    // 2. Below threshold: High if recovery is demanding or consecutive absences exist
    if (recoveryRatio >= 0.7 || consec >= 2 || trend < -4.0) {
      risk = 'High';
    } else {
      risk = 'Moderate';
    }
  } else {
    // 3. Above threshold: Evaluate vulnerability and deteriorating patterns
    if (
      projMiss < thr &&
      (margin < 2.5 || recent >= 0.35 || consec >= 2 || ts.significant_shift_detected)
    ) {
      risk = 'High';
    } else if (expFinal < thr && maxMissable !== null && maxMissable <= 1) {
      risk = 'High';
    } else if (consec >= 2 && maxMissable !== null && maxMissable <= 2) {
      risk = 'High';
    } else if (
      projMiss < thr ||
      margin < 5.0 ||
      expFinal < thr ||
      recent >= 0.25 ||
      consec >= 2 ||
      ts.trend_direction === 'deteriorating' ||
      ts.is_absence_accelerating ||
      (maxMissable !== null && maxMissable <= 2)
    ) {
      risk = 'Moderate';
    } else {
      risk = 'Low';
    }
  }

  // Soft probabilities estimation for offline transparency
  let pLow = 0.1;
  let pMod = 0.2;
  let pHigh = 0.7;

  if (risk === 'Low') {
    pLow = Math.min(0.95, 0.7 + Math.max(0, margin) * 0.02);
    pMod = Math.max(0.04, (1.0 - pLow) * 0.75);
    pHigh = Math.max(0.01, 1.0 - pLow - pMod);
  } else if (risk === 'Moderate') {
    pMod = 0.65;
    pHigh = attendance < thr ? 0.25 : 0.2;
    pLow = Math.max(0.05, 1.0 - pMod - pHigh);
  } else {
    pHigh = !recoverable ? 0.96 : Math.min(0.92, 0.72 + (thr - attendance) * 0.03);
    pMod = Math.max(0.05, (1.0 - pHigh) * 0.8);
    pLow = Math.max(0.01, 1.0 - pHigh - pMod);
  }

  // Evidence-grounded factor explanations
  const factors = [];

  // Compliance
  if (attendance < thr) {
    factors.push({
      factor: 'Below Required Threshold',
      impact: 'high',
      detail: `Current attendance (${attendance.toFixed(1)}%) is ${Math.abs(margin).toFixed(1)} points below the ${thr}% minimum requirement.`,
    });
  } else if (margin < 4.0) {
    factors.push({
      factor: 'Narrow Safety Margin',
      impact: 'high',
      detail: `Current attendance (${attendance.toFixed(1)}%) is only ${margin.toFixed(1)} percentage points above the ${thr}% threshold.`,
    });
  } else {
    factors.push({
      factor: 'Comfortable Safety Margin',
      impact: 'low',
      detail: `Current attendance (${attendance.toFixed(1)}%) maintains a healthy ${margin.toFixed(1)} point buffer above ${thr}%.`,
    });
  }

  // Time-Series Trend & Deterioration Detection
  const recDelta = ts.recent_vs_overall_delta;
  if (recDelta <= -15.0) {
    factors.push({
      factor: 'Acute Attendance Deterioration',
      impact: 'high',
      detail: `Recent attendance is substantially lower than overall performance (${recDelta >= 0 ? '+' : ''}${recDelta.toFixed(1)} point shift), indicating emerging behavioral risk.`,
    });
  } else if (recDelta <= -6.0) {
    factors.push({
      factor: 'Downward Attendance Trend',
      impact: 'moderate',
      detail: `Recent attendance has softened by ${Math.abs(recDelta).toFixed(1)} points relative to the semester average.`,
    });
  } else if (recDelta >= 6.0 && consec === 0) {
    factors.push({
      factor: 'Improving Attendance Momentum',
      impact: 'low',
      detail: `Recent attendance demonstrates upward recovery (+${recDelta.toFixed(1)} points above overall average).`,
    });
  }

  // Absence Acceleration & Streak Analysis
  if (consec >= 2) {
    factors.push({
      factor: 'Consecutive Absence Streak',
      impact: 'high',
      detail: `Currently on a streak of ${consec} consecutive missed classes (longest streak: ${ts.longest_consecutive_absences}).`,
    });
  } else if (ts.is_absence_accelerating) {
    factors.push({
      factor: 'Absence Frequency Accelerating',
      impact: 'high',
      detail: `Absences have increased by ${(ts.absence_acceleration * 100).toFixed(0)}% in recent sessions compared to earlier weeks.`,
    });
  } else if (recent >= 0.35) {
    factors.push({
      factor: 'Elevated Recent Absence Rate',
      impact: 'high',
      detail: `Missed ${(recent * 100).toFixed(0)}% of recent sessions, placing pressure on remaining recovery capacity.`,
    });
  }

  // Feasibility
  if (!recoverable) {
    factors.push({
      factor: 'Mathematically Unrecoverable',
      impact: 'high',
      detail: `Even perfect 100% attendance across all ${rem} remaining classes cannot reach the ${thr}% threshold (at most ${projAll.toFixed(1)}%).`,
    });
  } else if (minRemAttend !== null && rem > 0) {
    const pctNeeded = (minRemAttend / rem) * 100;
    if (pctNeeded >= 70) {
      factors.push({
        factor: 'Demanding Recovery Window',
        impact: 'high',
        detail: `Must attend at least ${minRemAttend} of the ${rem} remaining classes (${pctNeeded.toFixed(0)}% attendance rate) to finish compliant.`,
      });
    } else if (attendance < thr) {
      factors.push({
        factor: 'Feasible Recovery Window',
        impact: 'moderate',
        detail: `Recovery is achievable: attend at least ${minRemAttend} of the ${rem} remaining classes to reach ${thr}%.`,
      });
    }
  }

  // Sensitivity
  if (rem > 0 && recoverable) {
    if (projMiss < thr) {
      factors.push({
        factor: 'Zero Tolerance on Next Class',
        impact: 'high',
        detail: `Missing the very next class drops projected attendance to ${projMiss.toFixed(1)}%, causing an immediate threshold violation.`,
      });
    } else if (maxMissable !== null && maxMissable <= 2) {
      factors.push({
        factor: 'Thin Absence Buffer',
        impact: 'moderate',
        detail: `You can afford at most ${maxMissable} more absence${maxMissable === 1 ? '' : 's'} in the remaining ${rem} classes before breaching ${thr}%.`,
      });
    }
  }

  // Chronological History Depth
  if (ts.history_length >= 10) {
    factors.push({
      factor: 'Chronological History Depth',
      impact: 'info',
      detail: `Analyzed ${ts.history_length} sequential class sessions with multi-window rolling verification.`,
    });
  } else {
    factors.push({
      factor: 'Historical Window Status',
      impact: 'info',
      detail: 'Extended multi-session windows (10- and 20-class) are marked as insufficient due to limited historical depth.',
    });
  }

  // Actionable recommendations
  const recAnalysis = generatePersonalizedRecommendation(
    att,
    cond,
    rem,
    thr,
    semesterTotal,
  );
  const recommendation = recAnalysis.recommendation;

  return {
    risk,
    risk_code: risk === 'High' ? 2 : risk === 'Moderate' ? 1 : 0,
    probabilities: {
      Low: Number(pLow.toFixed(4)),
      Moderate: Number(pMod.toFixed(4)),
      High: Number(pHigh.toFixed(4)),
    },
    prediction_type: 'rule_based_simulation',
    model: 'Transparent rule engine',
    current_attendance: recAnalysis.current_attendance,
    threshold: thr,
    attended: att,
    absent: cond - att,
    conducted: cond,
    remaining: rem,
    semester_total: recAnalysis.semester_total,
    compliance_status: attendance >= thr ? 'Compliant' : 'Non-Compliant',
    features: {
      attendance_pct: Number(attendance.toFixed(4)),
      margin_to_threshold: Number(margin.toFixed(4)),
      recent_absence_rate: Number(recent.toFixed(4)),
      remaining_classes: rem,
      projected_if_attend_all: Number(projAll.toFixed(4)),
      projected_if_miss_next: Number(projMiss.toFixed(4)),
      recovery_ratio: Number(Math.min(recoveryRatio, 2).toFixed(4)),
      consecutive_absences: consec,
      attendance_trend: Number(trend.toFixed(4)),
      worst_case_attendance: Number(projWorst.toFixed(4)),
      expected_final_attendance: Number(expFinal.toFixed(4)),
      min_classes_needed: recAnalysis.min_classes_to_threshold,
      min_remaining_to_attend: minRemAttend,
      max_missable: recAnalysis.max_missable,
      can_recover: recAnalysis.can_recover,
      time_series_meta: {
        history_length: ts.history_length,
        has_full_history: ts.has_full_history,
        window_5: ts.window_5,
        window_10: ts.window_10,
        window_20: ts.window_20,
        trend_direction: ts.trend_direction,
        recent_vs_overall_delta: ts.recent_vs_overall_delta,
        absence_acceleration: ts.absence_acceleration,
        is_absence_accelerating: ts.is_absence_accelerating,
        longest_consecutive_absences: ts.longest_consecutive_absences,
      },
    },
    scenarios: {
      attend_all: Number(projAll.toFixed(2)),
      miss_next: Number(projMiss.toFixed(2)),
      miss_two: Number(
        projectedAttendance(
          att,
          cond,
          Math.max(rem - 2, 0),
          Math.min(2, rem),
        ).toFixed(2),
      ),
      miss_three: Number(
        projectedAttendance(
          att,
          cond,
          Math.max(rem - 3, 0),
          Math.min(3, rem),
        ).toFixed(2),
      ),
    },
    min_classes_to_threshold: recAnalysis.min_classes_to_threshold,
    min_consecutive_to_threshold: recAnalysis.min_consecutive_to_threshold,
    min_remaining_to_attend: minRemAttend,
    max_missable: recAnalysis.max_missable,
    can_recover: recAnalysis.can_recover,
    projected_final_if_attend_all: recAnalysis.projected_final_if_attend_all,
    worst_case_attendance: Number(projWorst.toFixed(2)),
    factors,
    recommendation,
    recommendation_analysis: recAnalysis,
    disclaimer:
      'Predictions use transparent attendance rules aligned with the offline decision boundaries. Validated for academic demonstration.',
  };
}

export function buildAlerts(subjects, threshold) {
  const alerts = [];

  subjects.forEach((subj) => {
    if (!subj.has_records || subj.conducted === 0 || subj.prediction?.current_attendance == null) {
      return;
    }
    const { name, remaining } = subj;
    const pred = subj.prediction;
    const {
      risk,
      current_attendance: att,
      scenarios,
      min_remaining_to_attend: minRem,
      max_missable: maxMiss,
      can_recover: canRec,
    } = pred;

    if (!canRec) {
      alerts.push({
        severity: 'critical',
        subject: name,
        message: `${name}: attendance (${att.toFixed(1)}%) cannot reach ${threshold}% even with 100% attendance in all ${remaining} remaining classes — mentor contact required.`,
      });
      return;
    }

    if (risk === 'High') {
      if (att < threshold) {
        alerts.push({
          severity: 'critical',
          subject: name,
          message: `${name}: attendance is ${att.toFixed(1)}% (below ${threshold}%). Immediate corrective attendance required.`,
        });
        if (minRem != null && remaining > 0) {
          alerts.push({
            severity: 'action',
            subject: name,
            message: `Must attend at least ${minRem} of the next ${remaining} classes in ${name} to regain compliance.`,
          });
        }
      } else {
        alerts.push({
          severity: 'critical',
          subject: name,
          message: `${name}: high risk due to critical buffer — missing 1 more class drops attendance to ${scenarios.miss_next.toFixed(1)}% (below ${threshold}%).`,
        });
      }
    } else if (risk === 'Moderate') {
      if (scenarios.miss_next < threshold) {
        alerts.push({
          severity: 'warning',
          subject: name,
          message: `${name} (${att.toFixed(1)}%): missing the next class drops attendance to ${scenarios.miss_next.toFixed(1)}% (below ${threshold}% minimum).`,
        });
      } else {
        alerts.push({
          severity: 'warning',
          subject: name,
          message: `${name} (${att.toFixed(1)}%): buffer is narrow (at most ${maxMiss} absences allowed across ${remaining} remaining classes).`,
        });
      }
    } else if (remaining > 0 && maxMiss != null && maxMiss <= 3) {
      alerts.push({
        severity: 'info',
        subject: name,
        message: `${name} is currently compliant (${att.toFixed(1)}%), but avoid consecutive absences to protect your ${maxMiss}-class buffer.`,
      });
    }
  });

  return alerts;
}
