import { SAMPLE_STUDENT } from '../data/sampleData';
import {
  attendancePct,
  bestCaseAttendance,
  calculateSimulatorScenarios,
  canRecover,
  maxMissableClasses,
  minClassesToThreshold,
  minRemainingToAttend,
  projectedAttendance,
} from '../utils/attendance';
import { buildAlerts, classifyRisk } from '../utils/riskEngine';

// Use same-origin `/api` in dev (Vite proxy) or set VITE_API_URL for a remote API.
const API_BASE = import.meta.env.VITE_API_URL || '';

async function fetchJson(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}`);
  }
  return res.json();
}

function enrichLocal(thresholdOverride) {
  const payload = structuredClone(SAMPLE_STUDENT);
  const threshold = thresholdOverride ?? payload.student.threshold;
  payload.student.threshold = threshold;

  const subjects = payload.subjects.map((subj) => ({
    ...subj,
    prediction: classifyRisk({
      attended: subj.attended,
      conducted: subj.conducted,
      remaining: subj.remaining,
      threshold,
      recentPattern: subj.recent_pattern,
      weeklyTrend: subj.weekly_trend,
      attendanceHistory: subj.attendance_history,
      semesterTotal: subj.semester_total,
    }),
  }));

  const risk_counts = { Low: 0, Moderate: 0, High: 0 };
  subjects.forEach((s) => {
    if (risk_counts[s.prediction.risk] !== undefined) {
      risk_counts[s.prediction.risk] += 1;
    }
  });

  const recorded = subjects.filter((s) => s.has_records !== false && s.conducted > 0);
  const total_attended = recorded.reduce((a, s) => a + s.attended, 0);
  const total_conducted = recorded.reduce((a, s) => a + s.conducted, 0);
  const total_remaining = subjects.reduce((a, s) => a + s.remaining, 0);
  const overall =
    total_conducted > 0
      ? Number(((total_attended / total_conducted) * 100).toFixed(2))
      : 0;

  return {
    student: payload.student,
    subjects,
    summary: {
      overall_attendance: overall,
      total_attended,
      total_conducted,
      total_missed: total_conducted - total_attended,
      total_remaining,
      threshold,
      risk_counts,
      overall_risk:
        risk_counts.High > 0
          ? 'High'
          : risk_counts.Moderate > 0
            ? 'Moderate'
            : 'Low',
      compliance_status: overall >= threshold ? 'Compliant' : 'Non-Compliant',
    },
    alerts: buildAlerts(subjects, threshold),
    cohort_summary: payload.cohort_summary,
    prediction_type: 'rule_based_simulation',
    apiOnline: false,
  };
}

export async function loadStudentDashboard(threshold) {
  try {
    const url = threshold != null ? `/api/student?threshold=${threshold}` : '/api/student';
    const data = await fetchJson(url);
    return { ...data, apiOnline: true };
  } catch {
    return enrichLocal(threshold);
  }
}

export async function predictSubject(body) {
  try {
    const data = await fetchJson('/api/predict', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { ...data, apiOnline: true };
  } catch {
    return {
      ...classifyRisk({
        attended: body.attended,
        conducted: body.conducted,
        remaining: body.remaining,
        threshold: body.threshold,
        recentPattern: body.recent_pattern,
        weeklyTrend: body.weekly_trend,
        attendanceHistory: body.attendance_history,
        semesterTotal: body.semester_total,
      }),
      apiOnline: false,
    };
  }
}

export async function simulateScenario(body) {
  try {
    const data = await fetchJson('/api/simulate', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { ...data, apiOnline: true };
  } catch {
    const sim = calculateSimulatorScenarios({
      attended: body.attended,
      conducted: body.conducted,
      percentage: body.percentage ?? body.current_pct,
      remaining: body.remaining,
      threshold: body.threshold,
      attend: body.attend,
      miss: body.miss,
      conductedEst: body.conducted_est || 50,
      semesterTotal: body.semester_total ?? body.semesterTotal,
    });
    return {
      ...sim,
      apiOnline: false,
    };
  }
}

export async function loadMetrics() {
  try {
    return await fetchJson('/api/metrics');
  } catch {
    return null;
  }
}

export async function loadMethodology() {
  try {
    return await fetchJson('/api/methodology');
  } catch {
    return null;
  }
}

export { API_BASE };
