/**
 * Automated test suite for frontend attendance math and riskEngine.
 * Run with: node frontend/test_attendance.js
 */

import assert from 'node:assert/strict';
import {
  attendancePct,
  attendanceTrend,
  bestCaseAttendance,
  calculateSimulatorScenarios,
  canRecover,
  consecutiveAbsences,
  expectedFinalAttendance,
  maxMissableClasses,
  minClassesToThreshold,
  minRemainingToAttend,
  projectedAttendance,
  projectedFromPercentage,
  recentAbsenceRate,
  worstCaseAttendance,
} from './src/utils/attendance.js';
import { buildAlerts, classifyRisk } from './src/utils/riskEngine.js';

console.log('--- Running Frontend Attendance & RiskEngine Tests ---');

// 1. Attendance Mathematics & Edge Cases
assert.equal(attendancePct(36, 50), 72.0);
assert.equal(attendancePct(0, 0), 100.0);
assert.equal(attendancePct(0, -5), 100.0);
assert.equal(attendancePct(-5, 50), 0.0);
assert.equal(attendancePct(60, 50), 100.0); // Clamped

// 2. Projected Attendance Monotonicity (Scenario 12)
const pBase = projectedAttendance(30, 40, 5, 5);
const pMoreAttend = projectedAttendance(30, 40, 6, 5);
const pMoreMiss = projectedAttendance(30, 40, 5, 6);
assert.ok(pMoreAttend > pBase, 'Increasing attended classes must increase percentage');
assert.ok(pMoreMiss < pBase, 'Increasing missed classes must decrease percentage');

// 3. Closed-form N formula and verification
// A = 36, C = 50, R = 14, threshold = 75%
const n = minClassesToThreshold(36, 50, 14, 75);
assert.equal(n, 6, 'Should require 6 consecutive classes');
assert.ok((36 + n) / (50 + n) >= 0.75, 'Verified against (A + N)/(C + N) >= 0.75');

// 4. Min remaining classes to attend out of R
const k = minRemainingToAttend(36, 50, 14, 75);
assert.equal(k, 12, 'Must attend 12 of 14 remaining classes');
assert.ok(projectedAttendance(36, 50, k, 14 - k) >= 75.0);

// 5. Max missable classes & best/worst case bounds
const m = maxMissableClasses(36, 50, 14, 75);
assert.equal(m, 2, 'Can afford at most 2 absences');
assert.ok(projectedAttendance(36, 50, 14 - m, m) >= 75.0);
assert.ok(projectedAttendance(36, 50, 14 - (m + 1), m + 1) < 75.0);
assert.almostEqual = (actual, expected, eps = 1e-2) => assert.ok(Math.abs(actual - expected) < eps);
assert.almostEqual(bestCaseAttendance(36, 50, 14), 78.125);
assert.almostEqual(worstCaseAttendance(36, 50, 14), 56.25);
assert.almostEqual(expectedFinalAttendance(36, 50, 14, 0.6), 65.625);

// 6. Feasibility & Unrecoverable condition (Scenario 5)
// 30/50, threshold = 75%, rem = 8 -> best = 38/58 = 65.5% < 75%
assert.equal(canRecover(30, 50, 8, 75), false);
assert.equal(minClassesToThreshold(30, 50, 8, 75), null);
assert.equal(minRemainingToAttend(30, 50, 8, 75), null);
assert.equal(maxMissableClasses(30, 50, 8, 75), null);

// 7. Recent pattern & consecutive misses (Scenario 7)
const pat1 = ['A', 'A', 'M', 'M', 'M'];
assert.equal(consecutiveAbsences(pat1), 3);
assert.equal(recentAbsenceRate(pat1), 0.6);

const pat2 = ['A', 'M', 'M', 'A', 'M'];
assert.equal(consecutiveAbsences(pat2), 1);
assert.equal(recentAbsenceRate(pat2), 0.6);

// 8. Weekly trend
assert.equal(attendanceTrend([78, 76, 74, 72]), -6.0);
assert.equal(attendanceTrend([]), 0.0);
assert.equal(attendanceTrend([80]), 0.0);

// 9. Risk Classification Parity for Preloaded Subjects
// Data Structures: 36/50 (72%), rem=14, threshold=75% -> High
const dsRisk = classifyRisk({
  attended: 36,
  conducted: 50,
  remaining: 14,
  threshold: 75,
  recentPattern: ['A', 'M', 'M', 'A', 'M'],
  weeklyTrend: [78, 76, 74, 73, 72, 72],
});
assert.equal(dsRisk.risk, 'High');
assert.equal(dsRisk.compliance_status, 'Non-Compliant');
assert.equal(dsRisk.can_recover, true);
assert.equal(dsRisk.min_classes_to_threshold, 6);
assert.equal(dsRisk.min_remaining_to_attend, 12);
assert.equal(dsRisk.max_missable, 2);

// Artificial Intelligence: 42/54 (77.8%), rem=12, threshold=75% -> Moderate
const aiRisk = classifyRisk({
  attended: 42,
  conducted: 54,
  remaining: 12,
  threshold: 75,
  recentPattern: ['A', 'A', 'M', 'A', 'M'],
  weeklyTrend: [81, 80, 79, 78, 78, 78],
});
assert.equal(aiRisk.risk, 'Moderate');
assert.equal(aiRisk.compliance_status, 'Compliant');
assert.equal(aiRisk.max_missable, 4);

// Computer Networks: 47/54 (87.0%), rem=12, threshold=75% -> Low
const cnRisk = classifyRisk({
  attended: 47,
  conducted: 54,
  remaining: 12,
  threshold: 75,
  recentPattern: ['A', 'A', 'A', 'A', 'A'],
  weeklyTrend: [86, 86, 87, 87, 87, 87],
});
assert.equal(cnRisk.risk, 'Low');
assert.equal(cnRisk.compliance_status, 'Compliant');
assert.ok(cnRisk.max_missable >= 8);

// 10. Boundary conditions: remaining = 0 and remaining = 1 (Scenario 14)
const rem0Pass = classifyRisk({ attended: 40, conducted: 50, remaining: 0, threshold: 75 });
assert.equal(rem0Pass.risk, 'Low');
assert.equal(rem0Pass.compliance_status, 'Compliant');

const rem0Fail = classifyRisk({ attended: 35, conducted: 50, remaining: 0, threshold: 75 });
assert.equal(rem0Fail.risk, 'High');
assert.equal(rem0Fail.compliance_status, 'Non-Compliant');

// 12. Time-Series Feature Extraction and Window Analysis
import { extractTimeSeriesFeatures, parseChronologicalRecords, normalizeStatus } from './src/utils/timeSeries.js';

assert.equal(normalizeStatus('present'), true);
assert.equal(normalizeStatus('absent'), false);
assert.equal(normalizeStatus('attended'), true);
assert.equal(normalizeStatus('missed'), false);

// Time-series: Insufficient history flags
const shortHistory = [
  { session: 1, status: 'present' },
  { session: 2, status: 'present' },
  { session: 3, status: 'absent' },
];
const shortTs = extractTimeSeriesFeatures({ history: shortHistory, threshold: 75, remaining: 20 });
assert.equal(shortTs.history_length, 3);
assert.equal(shortTs.has_full_history, false);
assert.equal(shortTs.window_5.available, false);
assert.equal(shortTs.window_10.available, false);
assert.equal(shortTs.window_20.available, false);

// Time-series: Deteriorating despite high overall percentage
// 40 sessions: 39 present (97.5%), then 10 sessions: 5 present + 5 absent (50%)
const detHistory = [];
for (let i = 1; i <= 40; i++) detHistory.push({ session: i, status: i === 10 ? 'absent' : 'present' });
for (let i = 41; i <= 50; i++) detHistory.push({ session: i, status: i % 2 === 1 ? 'absent' : 'present' });

const detTs = extractTimeSeriesFeatures({ history: detHistory, threshold: 75, remaining: 10 });
assert.ok(detTs.overall_attendance_pct >= 85.0);
assert.equal(detTs.window_10.rate, 0.5);
assert.equal(detTs.trend_direction, 'deteriorating');
assert.ok(detTs.recent_vs_overall_delta <= -15.0);

const detRisk = classifyRisk({
  attended: detTs.attended,
  conducted: detTs.conducted,
  remaining: 10,
  threshold: 75,
  attendanceHistory: detHistory,
});
assert.ok(detRisk.factors.some((f) => f.factor === 'Acute Attendance Deterioration'));

// Time-series: Consecutive absence streak
const streakHistory = [];
for (let i = 1; i <= 20; i++) streakHistory.push({ session: i, status: 'present' });
streakHistory.push({ session: 21, status: 'absent' });
streakHistory.push({ session: 22, status: 'absent' });
streakHistory.push({ session: 23, status: 'absent' });

const streakTs = extractTimeSeriesFeatures({ history: streakHistory, threshold: 75, remaining: 10 });
assert.equal(streakTs.current_consecutive_absences, 3);
assert.equal(streakTs.longest_consecutive_absences, 3);

// Time-series: Identical overall attendance with different trajectories
const trajA = [];
for (let i = 1; i <= 20; i++) trajA.push({ session: i, status: 'present' });
for (let i = 21; i <= 30; i++) trajA.push({ session: i, status: [21, 22, 24, 26, 28, 30].includes(i) ? 'absent' : 'present' });

const trajB = [];
for (let i = 1; i <= 20; i++) trajB.push({ session: i, status: [2, 4, 7, 9, 13, 15].includes(i) ? 'absent' : 'present' });
for (let i = 21; i <= 30; i++) trajB.push({ session: i, status: 'present' });

const tsA = extractTimeSeriesFeatures({ history: trajA, threshold: 75, remaining: 15 });
const tsB = extractTimeSeriesFeatures({ history: trajB, threshold: 75, remaining: 15 });
assert.equal(tsA.overall_attendance_pct, tsB.overall_attendance_pct);
assert.equal(tsA.trend_direction, 'deteriorating');
assert.equal(tsB.trend_direction, 'improving');
assert.ok(tsA.expected_final_attendance < tsB.expected_final_attendance);

// 13. What-If Simulator Comprehensive Scenario Validations
// 13.1 Current attendance above threshold
const simAbove = calculateSimulatorScenarios({
  attended: 45,
  conducted: 50,
  remaining: 10,
  threshold: 75,
  attend: 5,
  miss: 5,
});
assert.equal(simAbove.current_attendance, 90.0);
assert.equal(simAbove.above_threshold, true);
assert.ok(simAbove.projected_attendance > 75.0);
assert.ok(simAbove.max_missable >= 5);

// 13.2 Current attendance below threshold
const simBelow = calculateSimulatorScenarios({
  attended: 36,
  conducted: 50,
  remaining: 14,
  threshold: 75,
  attend: 12,
  miss: 2,
});
assert.equal(simBelow.current_attendance, 72.0);
assert.equal(simBelow.projected_attendance, 75.0);
assert.equal(simBelow.above_threshold, true);
assert.equal(simBelow.min_remaining_to_attend, 12);
assert.equal(simBelow.max_missable, 2);

// 13.3 Zero remaining classes (R = 0)
const simR0Pass = calculateSimulatorScenarios({
  attended: 40,
  conducted: 50,
  remaining: 0,
  threshold: 75,
  attend: 0,
  miss: 0,
});
assert.equal(simR0Pass.projected_attendance, 80.0);
assert.equal(simR0Pass.above_threshold, true);

const simR0Fail = calculateSimulatorScenarios({
  attended: 35,
  conducted: 50,
  remaining: 0,
  threshold: 75,
  attend: 0,
  miss: 0,
});
assert.equal(simR0Fail.projected_attendance, 70.0);
assert.equal(simR0Fail.above_threshold, false);
assert.equal(simR0Fail.can_recover, false);
assert.equal(simR0Fail.is_unrecoverable, true);

// 13.4 All remaining classes attended (Scenario A)
const simAllAttend = calculateSimulatorScenarios({
  attended: 36,
  conducted: 50,
  remaining: 14,
  threshold: 75,
  attend: 14,
  miss: 0,
});
assert.equal(simAllAttend.projected_attendance, 78.13);
assert.equal(simAllAttend.scenario_a.attend, 14);
assert.equal(simAllAttend.scenario_a.miss, 0);
assert.equal(simAllAttend.scenario_a.meets_threshold, true);

// 13.5 All remaining classes missed (Scenario E)
const simAllMiss = calculateSimulatorScenarios({
  attended: 36,
  conducted: 50,
  remaining: 14,
  threshold: 75,
  attend: 0,
  miss: 14,
});
assert.equal(simAllMiss.projected_attendance, 56.25);
assert.equal(simAllMiss.above_threshold, false);
assert.equal(simAllMiss.scenario_e.projected, 56.25);

// 13.6 Mixture of attended and missed classes
const simMix = calculateSimulatorScenarios({
  attended: 36,
  conducted: 50,
  remaining: 14,
  threshold: 75,
  attend: 10,
  miss: 4,
});
assert.equal(simMix.projected_attendance, 71.88);
assert.equal(simMix.above_threshold, false);
assert.equal(simMix.margin_to_threshold, -3.13);

// 13.7 Impossible recovery (mathematically unrecoverable)
const simUnrec = calculateSimulatorScenarios({
  attended: 20,
  conducted: 50,
  remaining: 10,
  threshold: 75,
  attend: 10,
  miss: 0,
});
assert.equal(simUnrec.can_recover, false);
assert.equal(simUnrec.is_unrecoverable, true);
assert.equal(simUnrec.min_remaining_to_attend, null);
assert.equal(simUnrec.max_missable, null);
assert.ok(simUnrec.recommendation.toLowerCase().includes('unrecoverable'));

// 13.8 Percentage-only input without class counts
const simPctOnly = calculateSimulatorScenarios({
  percentage: 70.0,
  remaining: 10,
  threshold: 75,
  attend: 8,
  miss: 2,
  conductedEst: 50,
});
assert.equal(simPctOnly.current_attendance, 70.0);
assert.equal(simPctOnly.projected_attendance, 71.67);
assert.equal(simPctOnly.calculation_mode, 'percentage_approximation');
assert.ok(simPctOnly.calculation_note.includes('50 conducted classes'));

// 13.9 Consistency check between percentage and counts
const simInconsistent = calculateSimulatorScenarios({
  attended: 36,
  conducted: 50, // 72%
  percentage: 85.0, // Contradicts 72%
  remaining: 14,
  threshold: 75,
  attend: 12,
  miss: 2,
});
assert.ok(simInconsistent.inconsistent_warning !== null);
assert.ok(simInconsistent.inconsistent_warning.includes('contradicts class counts'));
assert.equal(simInconsistent.calculation_mode, 'exact_class_counts');
assert.equal(simInconsistent.projected_attendance, 75.0);

// 13.10 Scenarios A, B, C, D comparison consistency
assert.equal(simBelow.scenario_comparison.length >= 4, true);
assert.equal(simBelow.scenario_a.attend, 14);
assert.equal(simBelow.scenario_b.attend, 13);
assert.equal(simBelow.scenario_c.attend, 12);
assert.equal(simBelow.scenario_d.attend, 12);

console.log('✓ All 13 frontend, time-series, and simulator test suites passed successfully!');
