/**
 * Time-Series Analysis and Chronological Attendance Feature Engineering.
 * Client-side implementation maintaining strict parity with backend/time_series.py.
 */

export function normalizeStatus(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') {
    if (val === 1) return true;
    if (val === 0) return false;
    return null;
  }
  const s = String(val || '').trim().toLowerCase();
  if (['present', 'p', 'attended', 'attend', 'yes', '1'].includes(s)) return true;
  if (['absent', 'a_absent', 'missed', 'miss', 'no', 'm', '0'].includes(s)) return false;
  if (s === 'a') return true;
  return null;
}

export function parseChronologicalRecords(records) {
  if (!Array.isArray(records) || !records.length) return [];

  const parsed = [];
  records.forEach((item, idx) => {
    if (item && typeof item === 'object') {
      const statusRaw = item.status != null ? item.status : item.attended != null ? item.attended : item.present;
      const status = normalizeStatus(statusRaw);
      if (status === null) return;
      const session = item.session != null ? Number(item.session) : idx + 1;
      const date = String(item.date || `session_${session}`);
      parsed.push({ session, date, present: status });
    } else {
      const status = normalizeStatus(item);
      if (status === null) return;
      parsed.push({ session: idx + 1, date: `session_${idx + 1}`, present: status });
    }
  });

  parsed.sort((a, b) => a.session - b.session);
  return parsed;
}

export function extractTimeSeriesFeatures({
  history = [],
  threshold = 75,
  conductedOverride = 0,
  attendedOverride = 0,
  remaining = 0,
}) {
  const cleanHistory = parseChronologicalRecords(history);
  const nRecords = cleanHistory.length;

  let conducted, attended, missed, statusSequence;

  if (nRecords > 0) {
    conducted = nRecords;
    attended = cleanHistory.filter((r) => r.present).length;
    missed = conducted - attended;
    statusSequence = cleanHistory.map((r) => r.present);
  } else {
    conducted = Math.max(0, Number(conductedOverride) || 0);
    attended = Math.max(0, Math.min(conducted, Number(attendedOverride) || 0));
    missed = conducted - attended;
    statusSequence = [];
  }

  const overallPct = conducted > 0 ? (attended / conducted) * 100 : 100;
  const margin = overallPct - Number(threshold);

  function computeWindow(windowSize) {
    if (statusSequence.length < windowSize) {
      return {
        available: false,
        window_size: windowSize,
        attended: null,
        rate: null,
        absences: null,
      };
    }
    const sub = statusSequence.slice(-windowSize);
    const attSub = sub.filter(Boolean).length;
    return {
      available: true,
      window_size: windowSize,
      attended: attSub,
      rate: Number((attSub / windowSize).toFixed(4)),
      absences: windowSize - attSub,
    };
  }

  const w5 = computeWindow(5);
  const w10 = computeWindow(10);
  const w20 = computeWindow(20);

  let currStreak = 0;
  let longestStreak = 0;
  let sinceLast = 0;
  let acceleration = 0;
  let isAccelerating = false;
  let clusteringIndex = 0;

  if (statusSequence.length > 0) {
    // Current streak
    for (let i = statusSequence.length - 1; i >= 0; i -= 1) {
      if (!statusSequence[i]) currStreak += 1;
      else break;
    }

    // Longest streak
    let runStreak = 0;
    statusSequence.forEach((p) => {
      if (!p) {
        runStreak += 1;
        if (runStreak > longestStreak) longestStreak = runStreak;
      } else {
        runStreak = 0;
      }
    });

    // Sessions since last absence
    for (let i = statusSequence.length - 1; i >= 0; i -= 1) {
      if (statusSequence[i]) sinceLast += 1;
      else break;
    }
    if (missed === 0) sinceLast = conducted;

    // Absence acceleration
    if (statusSequence.length >= 10) {
      const mid = Math.floor(statusSequence.length / 2);
      const firstHalf = statusSequence.slice(0, mid);
      const secondHalf = statusSequence.slice(mid);
      const firstRate = firstHalf.filter((p) => !p).length / Math.max(1, firstHalf.length);
      const secondRate = secondHalf.filter((p) => !p).length / Math.max(1, secondHalf.length);
      acceleration = Number((secondRate - firstRate).toFixed(4));
      isAccelerating = acceleration >= 0.15;
    } else if (w5.available) {
      const overallAbsRate = missed / Math.max(1, conducted);
      const recentAbsRate = w5.absences / 5;
      acceleration = Number((recentAbsRate - overallAbsRate).toFixed(4));
      isAccelerating = acceleration >= 0.2;
    }

    // Clustering index
    if (missed >= 2) {
      let consecPairs = 0;
      for (let i = 0; i < statusSequence.length - 1; i += 1) {
        if (!statusSequence[i] && !statusSequence[i + 1]) consecPairs += 1;
      }
      clusteringIndex = Number((consecPairs / Math.max(1, missed - 1)).toFixed(4));
    }
  } else {
    sinceLast = missed === 0 ? conducted : 0;
  }

  let recentReferenceRate = overallPct;
  let recentWindowUsed = 0;

  if (w10.available) {
    recentReferenceRate = w10.rate * 100;
    recentWindowUsed = 10;
  } else if (w5.available) {
    recentReferenceRate = w5.rate * 100;
    recentWindowUsed = 5;
  }

  const recentVsOverallDelta = Number((recentReferenceRate - overallPct).toFixed(2));

  let trendDirection = 'stable';
  if (recentVsOverallDelta <= -5.0 || currStreak >= 2) {
    trendDirection = 'deteriorating';
  } else if (recentVsOverallDelta >= 5.0 && currStreak === 0) {
    trendDirection = 'improving';
  }

  const significantShift = Math.abs(recentVsOverallDelta) >= 15.0 && (w10.available || w5.available);

  // Behavioral EWMA Forecast
  let adaptiveForecastRate = overallPct / 100;
  if (recentWindowUsed > 0) {
    const recFraction = recentReferenceRate / 100;
    const ovFraction = overallPct / 100;
    adaptiveForecastRate = 0.65 * recFraction + 0.35 * ovFraction;
    if (isAccelerating && adaptiveForecastRate > 0.4) {
      adaptiveForecastRate = Math.max(0.2, adaptiveForecastRate - 0.1);
    }
  }
  adaptiveForecastRate = Math.max(0, Math.min(1, adaptiveForecastRate));

  const rRem = Math.max(0, Number(remaining) || 0);
  const expAttend = Math.round(rRem * adaptiveForecastRate);
  const totalFinal = conducted + rRem;

  let expectedFinalPct = 100;
  let bestCasePct = 100;
  let worstCasePct = 100;

  if (totalFinal > 0) {
    expectedFinalPct = Number((((attended + expAttend) / totalFinal) * 100).toFixed(2));
    bestCasePct = Number((((attended + rRem) / totalFinal) * 100).toFixed(2));
    worstCasePct = Number(((attended / totalFinal) * 100).toFixed(2));
  }

  return {
    conducted,
    attended,
    missed,
    overall_attendance_pct: Number(overallPct.toFixed(2)),
    margin_to_threshold: Number(margin.toFixed(2)),
    history_length: nRecords,
    has_full_history: nRecords >= 10,
    window_5: w5,
    window_10: w10,
    window_20: w20,
    recent_window_used: recentWindowUsed,
    recent_reference_rate: Number(recentReferenceRate.toFixed(2)),
    recent_vs_overall_delta: recentVsOverallDelta,
    current_consecutive_absences: currStreak,
    longest_consecutive_absences: longestStreak,
    sessions_since_last_absence: sinceLast,
    absence_acceleration: acceleration,
    is_absence_accelerating: isAccelerating,
    absence_clustering_index: clusteringIndex,
    trend_direction: trendDirection,
    significant_shift_detected: significantShift,
    adaptive_forecast_rate: Number(adaptiveForecastRate.toFixed(4)),
    expected_final_attendance: expectedFinalPct,
    best_case_attendance: bestCasePct,
    worst_case_attendance: worstCasePct,
  };
}
