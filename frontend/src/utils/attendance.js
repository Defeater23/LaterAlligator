/**
 * Pure attendance mathematics used across the dashboard.
 *
 * All functions operate on raw class counts (attended, conducted, remaining)
 * and a threshold expressed as a percentage (0-100). Internal calculations
 * use full precision; callers round only for display.
 */

export function attendancePct(attended, conducted) {
  const a = Number(attended);
  const c = Number(conducted);
  if (!Number.isFinite(c) || c <= 0) return 100;
  if (!Number.isFinite(a) || a <= 0) return 0;
  return (Math.min(Math.max(0, a), c) / c) * 100;
}

/**
 * Distinguish between classes already conducted and classes remaining in the semester.
 *
 * Formula:
 *   conducted = classesAttended + classesAbsent
 *   remaining = semesterTotalClasses - (classesAttended + classesAbsent)
 *
 * Flags inconsistent data if semesterTotalClasses < conducted.
 */
export function calculateRemainingClasses(semesterTotal, attended, absent) {
  const tot = Math.max(0, Math.round(Number(semesterTotal) || 0));
  const att = Math.max(0, Math.round(Number(attended) || 0));
  const abs = Math.max(0, Math.round(Number(absent) || 0));
  const conducted = att + abs;

  if (tot < conducted) {
    return {
      conducted,
      semester_total: tot,
      remaining: 0,
      is_inconsistent: true,
      error: `Inconsistent data: conducted classes (${conducted}) exceed semester total (${tot})`,
    };
  }

  const remaining = tot - conducted;
  return {
    conducted,
    semester_total: tot,
    remaining,
    is_inconsistent: false,
    error: null,
  };
}

/**
 * Attending increases attended + conducted by 1 each.
 * Missing increases only conducted by 1.
 * attend / miss are future classes over the remaining window.
 */
export function projectedAttendance(attended, conducted, attend, miss) {
  const a = Math.max(0, Number(attend) || 0);
  const m = Math.max(0, Number(miss) || 0);
  return attendancePct(
    (Number(attended) || 0) + a,
    (Number(conducted) || 0) + a + m,
  );
}

/** Best possible final attendance: attend every remaining class. */
export function bestCaseAttendance(attended, conducted, remaining) {
  return projectedAttendance(
    attended,
    conducted,
    Math.max(0, Number(remaining) || 0),
    0,
  );
}

/** Worst possible final attendance: miss every remaining class. */
export function worstCaseAttendance(attended, conducted, remaining) {
  return projectedAttendance(
    attended,
    conducted,
    0,
    Math.max(0, Number(remaining) || 0),
  );
}

/** True if the threshold can still be reached by attending every remaining class. */
export function canRecover(attended, conducted, remaining, threshold) {
  return bestCaseAttendance(attended, conducted, remaining) >= Number(threshold) - 1e-9;
}

/**
 * Closed-form minimum future consecutive classes that must be attended to reach the threshold.
 *
 *   (A + N) / (C + N) >= r
 *   => N >= (r*C - A) / (1 - r)
 *
 * Applies when 0 <= r < 1.
 * Returns 0 when already compliant, null when mathematically impossible
 * within remaining classes or r >= 1. Verified against (A + N) / (C + N) >= r.
 */
export function minClassesToThreshold(attended, conducted, remaining, threshold) {
  const A = Number(attended) || 0;
  const C = Number(conducted) || 0;
  const R = Math.max(0, Number(remaining) || 0);
  const r = Number(threshold) / 100;

  if (!Number.isFinite(r) || r >= 1) return null;
  if (r <= 0) return 0;
  if (C <= 0) return 0;
  if (A / C >= r - 1e-9) return 0;
  if (R <= 0) return null;

  const denom = 1 - r;
  if (denom <= 0) return null;

  const numerator = r * C - A;
  let n = Math.max(0, Math.ceil(numerator / denom));

  // Verification against the full attendance equation: (A + n) / (C + n) >= r
  while ((A + n) / (C + n) < r - 1e-9) {
    n += 1;
  }

  if (n > R) return null;
  return n;
}

/**
 * Minimum classes out of remaining R that must be attended (attending k, missing R - k)
 * so that final attendance >= threshold.
 *
 *   (A + k) / (C + R) >= r  =>  k >= r*(C + R) - A
 *
 * Returns null if recovery is impossible within remaining classes.
 */
export function minRemainingToAttend(attended, conducted, remaining, threshold) {
  const A = Number(attended) || 0;
  const C = Number(conducted) || 0;
  const R = Math.max(0, Number(remaining) || 0);
  const r = Number(threshold) / 100;

  if (!Number.isFinite(r) || r <= 0) return 0;
  if (r > 1) return null;
  const totalFinal = C + R;
  if (totalFinal <= 0) return 0;

  const targetAttended = Math.ceil(r * totalFinal - 1e-9);
  const needed = Math.max(0, targetAttended - A);
  if (needed > R) return null;
  return needed;
}

/**
 * Maximum additional remaining classes that can be missed (attending the rest)
 * without dropping below the threshold at semester end.
 *
 *   (A + R - M) / (C + R) >= r
 *   => M <= A + R - r*(C + R)
 *
 * Returns null when recovery is mathematically impossible.
 */
export function maxMissableClasses(attended, conducted, remaining, threshold) {
  const A = Number(attended) || 0;
  const C = Number(conducted) || 0;
  const R = Math.max(0, Number(remaining) || 0);
  const r = Number(threshold) / 100;

  if (!Number.isFinite(r) || r <= 0) return R;
  if (r > 1) return null;
  const totalFinal = C + R;
  if (totalFinal <= 0) return 0;

  const targetAttended = Math.ceil(r * totalFinal - 1e-9);
  if (A + R < targetAttended) return null;

  const maxMiss = Math.floor(A + R - targetAttended + 1e-9);
  let candidate = Math.min(R, Math.max(0, maxMiss));

  while (candidate > 0 && (A + (R - candidate)) / totalFinal < r - 1e-9) {
    candidate -= 1;
  }
  return candidate;
}

/** Fraction of recent classes missed (0-1). Returns 0 for empty/missing patterns. */
export function recentAbsenceRate(pattern = []) {
  if (!Array.isArray(pattern) || !pattern.length) return 0;
  const valid = pattern.filter((p) => p === 'A' || p === 'M');
  if (!valid.length) return 0;
  const missed = valid.filter((p) => p === 'M').length;
  return missed / valid.length;
}

/** Count of consecutive misses at the end of the recent pattern (0 if none). */
export function consecutiveAbsences(pattern = []) {
  if (!Array.isArray(pattern) || !pattern.length) return 0;
  let count = 0;
  for (let i = pattern.length - 1; i >= 0; i -= 1) {
    if (pattern[i] === 'M') count += 1;
    else if (pattern[i] === 'A') break;
  }
  return count;
}

/**
 * Attendance trend over weekly percentage history.
 * Returns the simple slope (last - first) in percentage points.
 * Returns 0 when fewer than 2 data points are available.
 */
export function attendanceTrend(weeklyTrend = []) {
  if (!Array.isArray(weeklyTrend) || weeklyTrend.length < 2) return 0;
  const first = Number(weeklyTrend[0]);
  const last = Number(weeklyTrend[weeklyTrend.length - 1]);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return 0;
  return last - first;
}

/** Expected final attendance assuming recent absence rate continues into remaining classes. */
export function expectedFinalAttendance(attended, conducted, remaining, recentRate) {
  const rRem = Math.max(0, Number(remaining) || 0);
  if (rRem === 0) return attendancePct(attended, conducted);
  const expMiss = Math.round(rRem * Math.max(0, Math.min(1, Number(recentRate) || 0)));
  const expAttend = rRem - expMiss;
  return projectedAttendance(attended, conducted, expAttend, expMiss);
}

/**
 * Calculate personalized attendance analysis and dynamic recommendation for a subject.
 *
 * Calculates all 11 required elements:
 * 1. current_attendance (%)
 * 2. threshold (%)
 * 3. attended count
 * 4. absent count
 * 5. conducted count
 * 6. remaining classes
 * 7. min_consecutive_to_threshold (or 0 if already above, null if unrecoverable)
 * 8. can_recover (boolean)
 * 9. max_missable (int or null if unrecoverable)
 * 10. projected_final_if_attend_all (%)
 * 11. recommendation (personalized text)
 */
export function generatePersonalizedRecommendation(
  attended,
  conducted,
  remaining,
  threshold = 75,
  semesterTotal = null,
) {
  const A = Math.max(0, Math.round(Number(attended) || 0));
  const C = Math.max(0, Math.round(Number(conducted) || 0));
  const R = Math.max(0, Math.round(Number(remaining) || 0));
  const T = Number(threshold != null ? threshold : 75);
  const t = T / 100;
  const missed = Math.max(0, C - A);
  const semTot = semesterTotal != null ? Number(semesterTotal) : C + R;

  if (C === 0) {
    return {
      current_attendance: 0,
      threshold: T,
      attended: 0,
      absent: 0,
      conducted: 0,
      remaining: R,
      semester_total: semTot,
      min_consecutive_to_threshold: null,
      min_classes_to_threshold: null,
      can_recover: true,
      max_missable: null,
      projected_final_if_attend_all: 0,
      worst_case_attendance: 0,
      status: 'unavailable',
      is_inconsistent: false,
      recommendation:
        'No attendance recorded yet for this subject. Projections and recommendations will become available once classes commence.',
    };
  }

  const isInconsistent = semTot < C;
  const currPct = (A / C) * 100;
  const totalFinal = C + R;
  const projAll = totalFinal > 0 ? ((A + R) / totalFinal) * 100 : currPct;
  const projWorst = totalFinal > 0 ? (A / totalFinal) * 100 : currPct;
  const recoverable = projAll >= T - 1e-9;

  const m = recoverable ? maxMissableClasses(A, C, R, T) : null;
  const n = minClassesToThreshold(A, C, R, T);

  let recommendation;
  let status;

  if (isInconsistent) {
    recommendation = `Inconsistent attendance record: conducted classes (${C}) exceed total planned semester classes (${semTot}). Please verify attendance records with the department administration.`;
    status = 'inconsistent';
  } else if (R === 0) {
    if (currPct >= T - 1e-9) {
      recommendation = `Semester completed successfully with ${currPct.toFixed(1)}% attendance, exceeding the ${T.toFixed(0)}% requirement.`;
      status = 'completed_compliant';
    } else {
      recommendation = `Semester completed with ${currPct.toFixed(1)}% attendance, which is below the required ${T.toFixed(0)}% threshold. Contact your academic mentor or department office regarding condonation.`;
      status = 'completed_non_compliant';
    }
  } else if (!recoverable) {
    recommendation = `Attend every remaining class. Your attendance will reach ${projAll.toFixed(1)}%, which is still below the required ${T.toFixed(0)}% threshold. Recovery is mathematically impossible within the remaining ${R} classes; consult your academic mentor immediately.`;
    status = 'unrecoverable';
  } else if (currPct < T - 1e-9) {
    status = 'recovering';
    if (m !== null && m > 0) {
      recommendation = `Attend the next ${n} consecutive classes to recover to the required ${T.toFixed(0)}% threshold. Across all ${R} remaining classes, you can miss at most ${m} class${m !== 1 ? 'es' : ''} if you attend the others (best final: ${projAll.toFixed(1)}%).`;
    } else {
      recommendation = `Attend the next ${n} consecutive classes to recover to the required ${T.toFixed(0)}% threshold. You must attend all ${R} remaining classes (0 absences allowed) to finish compliant (final attendance: ${projAll.toFixed(1)}%).`;
    }
  } else if (Math.abs(currPct - T) < 0.05) {
    status = 'at_threshold';
    if (m !== null && m > 0) {
      recommendation = `Your attendance is currently at the ${T.toFixed(0)}% threshold (${currPct.toFixed(1)}%). Missing another class may put you below the requirement. You can miss at most ${m} of the ${R} remaining classes if you attend the others.`;
    } else {
      recommendation = `Your attendance is currently at the ${T.toFixed(0)}% threshold (${currPct.toFixed(1)}%). Missing another class will put you below the requirement. You must attend all ${R} remaining classes to finish compliant.`;
    }
  } else {
    status = 'above_threshold';
    if (m !== null && m === R) {
      recommendation = `Your attendance is currently above the threshold (${currPct.toFixed(1)}%). You can miss all ${R} remaining classes and still finish compliant (final attendance: ${projWorst.toFixed(1)}% vs ${T.toFixed(0)}% threshold).`;
    } else if (m !== null && m > 0) {
      recommendation = `Your attendance is currently above the threshold (${currPct.toFixed(1)}%). You can miss at most ${m} of the ${R} remaining classes if you attend the others (best final: ${projAll.toFixed(1)}%).`;
    } else {
      recommendation = `Your attendance is currently above the threshold (${currPct.toFixed(1)}%), but your buffer is minimal. Missing even 1 more class will drop you below ${T.toFixed(0)}%. You must attend all ${R} remaining classes to maintain compliance.`;
    }
  }

  return {
    current_attendance: Number(currPct.toFixed(2)),
    threshold: T,
    attended: A,
    absent: missed,
    conducted: C,
    remaining: R,
    semester_total: semTot,
    min_consecutive_to_threshold: currPct < T - 1e-9 && recoverable ? n : currPct >= T - 1e-9 ? 0 : null,
    min_classes_to_threshold: currPct < T - 1e-9 && recoverable ? n : currPct >= T - 1e-9 ? 0 : null,
    can_recover: recoverable,
    max_missable: m,
    projected_final_if_attend_all: Number(projAll.toFixed(2)),
    worst_case_attendance: Number(projWorst.toFixed(2)),
    status,
    is_inconsistent: isInconsistent,
    recommendation,
  };
}

export function formatPct(value, digits = 1) {
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

export function riskFromScores(subjects) {
  if (subjects.some((s) => s.risk === 'High')) return 'High';
  if (subjects.some((s) => s.risk === 'Moderate')) return 'Moderate';
  return 'Low';
}

/**
 * Projected attendance when only current percentage and remaining classes are known.
 * Uses an explicitly identified baseline estimate of conducted classes:
 *   Projected (%) = 100 * ((P / 100 * C_est) + X) / (C_est + X + Y)
 */
export function projectedFromPercentage(percentage, remaining, attend, miss, conductedEst = 50) {
  const cEst = Math.max(1, Number(conductedEst) || 50);
  const p = Math.max(0, Math.min(100, Number(percentage) || 0));
  const aEst = (p / 100) * cEst;
  const a = Math.max(0, Number(attend) || 0);
  const m = Math.max(0, Number(miss) || 0);
  const total = cEst + a + m;
  if (total <= 0) return 100;
  return ((aEst + a) / total) * 100;
}

/**
 * Comprehensive simulator calculation engine computing scenarios A, B, C, D, E,
 * recovery bounds, and consistency checks.
 */
export function calculateSimulatorScenarios({
  attended,
  conducted,
  percentage,
  remaining,
  threshold,
  attend,
  miss,
  conductedEst = 50,
  semesterTotal = null,
}) {
  const rem = Math.max(0, Number(remaining) || 0);
  const thr = Number(threshold) || 75;
  const attPlan = Math.max(0, Math.min(rem, Number(attend) || 0));
  const missPlan = Math.max(0, Math.min(rem - attPlan, Number(miss) || 0));

  let A = 0;
  let C = 0;
  let currentPct = 0;
  let calcMode = 'exact_class_counts';
  let inconsistentWarning = null;
  let calculationNote = null;

  const hasCounts = attended != null && conducted != null;
  const hasPct = percentage != null && !Number.isNaN(Number(percentage));

  if (hasCounts) {
    A = Math.max(0, Number(attended) || 0);
    C = Math.max(0, Number(conducted) || 0);
    const actualPct = C > 0 ? attendancePct(A, C) : 0;
    currentPct = actualPct;
    calcMode = 'exact_class_counts';

    if (semesterTotal != null && C > Number(semesterTotal)) {
      inconsistentWarning = `Inconsistent data: conducted classes (${C}) exceed semester total (${semesterTotal}).`;
    } else if (hasPct && C > 0) {
      const pEntered = Number(percentage);
      if (Math.abs(pEntered - actualPct) > 0.5) {
        inconsistentWarning = `Entered percentage (${pEntered.toFixed(1)}%) contradicts class counts (${A}/${C} = ${actualPct.toFixed(1)}%). Using exact class counts.`;
      }
    }
  } else if (hasPct) {
    calcMode = 'percentage_approximation';
    const cEst = Math.max(1, Number(conductedEst) || 50);
    currentPct = Math.max(0, Math.min(100, Number(percentage) || 0));
    C = cEst;
    A = (currentPct / 100) * cEst;
    calculationNote = `Using estimated baseline of ${cEst} conducted classes for percentage-only projection. Exact class-level calculations require actual attended and conducted counts.`;
  } else {
    calcMode = 'default';
    C = 50;
    A = 36;
    currentPct = 72;
  }

  function calcProj(x, y) {
    const total = C + x + y;
    if (total <= 0) return 0;
    return ((A + x) / total) * 100;
  }

  const projFuture = calcProj(attPlan, missPlan);
  const above = projFuture >= thr - 1e-9;
  const marginToThreshold = Number((projFuture - thr).toFixed(2));

  // Scenario A: Attend every remaining class
  const projA = calcProj(rem, 0);
  const scenarioA = {
    id: 'A',
    name: 'Scenario A: Attend Every Remaining Class',
    attend: rem,
    miss: 0,
    projected: Number(projA.toFixed(2)),
    meets_threshold: projA >= thr - 1e-9,
    margin: Number((projA - thr).toFixed(2)),
    description: `Attend all ${rem} remaining classes (best-case ceiling).`,
  };

  // Scenario B: Miss next class and attend others
  const attB = Math.max(0, rem - 1);
  const missB = Math.min(1, rem);
  const projB = calcProj(attB, missB);
  const scenarioB = {
    id: 'B',
    name: 'Scenario B: Miss Next Class, Attend Others',
    attend: attB,
    miss: missB,
    projected: Number(projB.toFixed(2)),
    meets_threshold: projB >= thr - 1e-9,
    margin: Number((projB - thr).toFixed(2)),
    description: rem > 0 ? 'Suffer an immediate absence in the next session, then attend the rest.' : 'No remaining classes left.',
  };

  // Scenario C: Attend specified classes and miss the rest
  const missRest = Math.max(0, rem - attPlan);
  const projC = calcProj(attPlan, missRest);
  const scenarioC = {
    id: 'C',
    name: `Scenario C: Attend ${attPlan}, Miss Rest (${missRest})`,
    attend: attPlan,
    miss: missRest,
    projected: Number(projC.toFixed(2)),
    meets_threshold: projC >= thr - 1e-9,
    margin: Number((projC - thr).toFixed(2)),
    description: `Attend ${attPlan} classes and miss all remaining ${missRest} undecided classes.`,
  };

  // Recovery & Absence limits
  const recoverable = projA >= thr - 1e-9;
  let minRemAttend = null;
  let maxMissable = null;

  if (recoverable) {
    const totalFinal = C + rem;
    const targetAttended = Math.ceil((thr / 100) * totalFinal - 1e-9);
    minRemAttend = Math.max(0, targetAttended - Math.floor(A));
    while ((A + minRemAttend) / totalFinal < (thr / 100) - 1e-9 && minRemAttend < rem) {
      minRemAttend += 1;
    }
    maxMissable = Math.max(0, rem - minRemAttend);
  }

  // Scenario D: Break-Even Recovery (if recoverable)
  const scenarioD = recoverable && minRemAttend != null
    ? {
        id: 'D',
        name: `Scenario D: Break-Even Recovery (${minRemAttend} Attend, ${maxMissable} Miss)`,
        attend: minRemAttend,
        miss: maxMissable,
        projected: Number(calcProj(minRemAttend, maxMissable).toFixed(2)),
        meets_threshold: true,
        margin: Number((calcProj(minRemAttend, maxMissable) - thr).toFixed(2)),
        description: `Minimum effort to finish compliant: attend exactly ${minRemAttend} classes.`,
      }
    : null;

  // Scenario E: Miss all remaining
  const projE = calcProj(0, rem);
  const scenarioE = {
    id: 'E',
    name: `Scenario E: Miss All Remaining (${rem} Missed)`,
    attend: 0,
    miss: rem,
    projected: Number(projE.toFixed(2)),
    meets_threshold: projE >= thr - 1e-9,
    margin: Number((projE - thr).toFixed(2)),
    description: 'Worst-case outcome if no further classes are attended.',
  };

  const scenarioComparison = [scenarioA, scenarioB, scenarioC];
  if (scenarioD) scenarioComparison.push(scenarioD);
  scenarioComparison.push(scenarioE);

  // Recommendations
  let recommendation;
  if (!recoverable) {
    recommendation = `Even attending all ${rem} remaining classes reaches ${projA.toFixed(1)}%, which cannot achieve the ${thr}% requirement under the stated assumptions. This subject is mathematically unrecoverable within the semester. Contact your mentor or department regarding medical or administrative condonation.`;
  } else if (projFuture >= thr + 5) {
    recommendation = `Projected to finish at ${projFuture.toFixed(1)}%, comfortably above the ${thr}% requirement (+${marginToThreshold.toFixed(1)}% buffer). Maintain this plan to guarantee compliance.`;
  } else if (above) {
    recommendation = `Projected attendance (${projFuture.toFixed(1)}%) meets the ${thr}% threshold (+${marginToThreshold.toFixed(1)}% buffer). You can afford at most ${maxMissable} total absences across the remaining classes.`;
  } else if (minRemAttend != null) {
    recommendation = `Projected attendance (${projFuture.toFixed(1)}%) falls below ${thr}% (${marginToThreshold.toFixed(1)}% deficit). You must attend at least ${minRemAttend} of the ${rem} remaining classes (at most ${maxMissable} absences allowed) to finish compliant.`;
  } else {
    recommendation = `Projected attendance (${projFuture.toFixed(1)}%) is below ${thr}%. Consult your mentor.`;
  }

  // Full Chart
  const chart = [];
  for (let m = 0; m <= rem; m += 1) {
    const a = rem - m;
    const p = Number(calcProj(a, m).toFixed(2));
    chart.push({
      missed: m,
      attended: a,
      percentage: p,
      above: p >= thr - 1e-9,
    });
  }

  return {
    current_attendance: Number(currentPct.toFixed(2)),
    projected_attendance: Number(projFuture.toFixed(2)),
    above_threshold: above,
    margin_to_threshold: marginToThreshold,
    threshold: thr,
    unused_remaining: Math.max(0, rem - attPlan - missPlan),
    can_recover: recoverable,
    is_unrecoverable: !recoverable,
    min_classes_to_threshold: minClassesToThreshold(A, C, rem, thr),
    min_remaining_to_attend: minRemAttend,
    max_missable: maxMissable,
    calculation_mode: calcMode,
    inconsistent_warning: inconsistentWarning || null,
    calculation_note: calculationNote || null,
    recommendation,
    scenario_a: scenarioA,
    scenario_b: scenarioB,
    scenario_c: scenarioC,
    scenario_d: scenarioD,
    scenario_e: scenarioE,
    scenario_comparison: scenarioComparison,
    scenario_chart: chart,
    projection_type: 'deterministic_mathematical_projection',
  };
}
