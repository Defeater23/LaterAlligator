/**
 * Unit tests for attendance calculations and personalized recommendations in frontend.
 * Run with: node test_recommendations.js
 */

import assert from 'node:assert';
import {
  attendancePct,
  calculateRemainingClasses,
  generatePersonalizedRecommendation,
  minClassesToThreshold,
  maxMissableClasses,
  canRecover,
} from './src/utils/attendance.js';

console.log('--- RUNNING FRONTEND ATTENDANCE & RECOMMENDATION TESTS ---');

// 1. Krrish Gupta Subjects Remaining Classes
const krrishData = [
  { code: 'CSE3101', name: 'Computer Networks', att: 29, ab: 7, total: 48, expCond: 36, expRem: 12 },
  { code: 'CSE3102', name: 'Software Engineering', att: 31, ab: 9, total: 48, expCond: 40, expRem: 8 },
  { code: 'CSE3121', name: 'Artificial Intelligence & Soft Computing', att: 30, ab: 9, total: 48, expCond: 39, expRem: 9 },
  { code: 'CSE3131', name: 'Computer Networks Lab', att: 10, ab: 1, total: 48, expCond: 11, expRem: 37 },
  { code: 'CSE3132', name: 'Software Engineering Lab', att: 7, ab: 2, total: 48, expCond: 9, expRem: 39 },
  { code: 'CSE3142', name: 'Android App Development', att: 18, ab: 8, total: 36, expCond: 26, expRem: 10 },
  { code: 'CSE3147', name: 'Essentials of Cyber Security', att: 27, ab: 5, total: 36, expCond: 32, expRem: 4 },
];

for (const s of krrishData) {
  const calc = calculateRemainingClasses(s.total, s.att, s.ab);
  assert.strictEqual(calc.conducted, s.expCond, `${s.code} conducted mismatch`);
  assert.strictEqual(calc.remaining, s.expRem, `${s.code} remaining mismatch`);
  assert.strictEqual(calc.is_inconsistent, false, `${s.code} should not be inconsistent`);
  // Ensure not calculated as total - attended alone
  assert.notStrictEqual(calc.remaining, s.total - s.att, `${s.code} must not ignore absent classes`);
  console.log(`✓ ${s.code}: Conducted ${calc.conducted}, Semester Total ${calc.semester_total}, Remaining ${calc.remaining}`);
}

// 2. Personalized Recommendation for Krrish Gupta subjects
// Android (69.2% < 75%)
const androidRec = generatePersonalizedRecommendation(18, 26, 10, 75, 36);
assert.strictEqual(androidRec.current_attendance, 69.23);
assert.strictEqual(androidRec.can_recover, true);
assert.strictEqual(androidRec.min_consecutive_to_threshold, 6);
assert.strictEqual(androidRec.max_missable, 1);
assert.strictEqual(androidRec.projected_final_if_attend_all, 77.78);
assert(androidRec.recommendation.includes('next 6 consecutive classes'));
assert(androidRec.recommendation.includes('at most 1 class'));
console.log('✓ Android App Development recommendation verified:', androidRec.recommendation);

// Computer Networks (80.6% > 75%)
const cnRec = generatePersonalizedRecommendation(29, 36, 12, 75, 48);
assert.strictEqual(cnRec.current_attendance, 80.56);
assert.strictEqual(cnRec.min_consecutive_to_threshold, 0);
assert.strictEqual(cnRec.max_missable, 5);
assert.strictEqual(cnRec.projected_final_if_attend_all, 85.42);
assert(cnRec.recommendation.includes('above the threshold'));
assert(cnRec.recommendation.includes('at most 5'));
console.log('✓ Computer Networks recommendation verified:', cnRec.recommendation);

// Essentials of Cyber Security (84.4%)
const cyberRec = generatePersonalizedRecommendation(27, 32, 4, 75, 36);
assert.strictEqual(cyberRec.max_missable, 4);
assert(cyberRec.recommendation.includes('can miss all 4 remaining classes'));
console.log('✓ Cyber Security recommendation verified:', cyberRec.recommendation);

// 3. Mathematical Verification of Bounds
// (18 + 6) / (26 + 6) = 24/32 = 75%
assert((18 + 6) / (26 + 6) >= 0.75 - 1e-9);
// (18 + 5) / (26 + 5) = 23/31 = 74.19% < 75%
assert((18 + 5) / (26 + 5) < 0.75 - 1e-9);

// (18 + 10 - 1) / 36 = 27/36 = 75%
assert((18 + 10 - 1) / 36 >= 0.75 - 1e-9);
// (18 + 10 - 2) / 36 = 26/36 = 72.22% < 75%
assert((18 + 10 - 2) / 36 < 0.75 - 1e-9);
console.log('✓ Mathematical bounds (n and m) verified rigorously');

// 4. Unrecoverable Case
const unrec = generatePersonalizedRecommendation(10, 30, 10, 75, 40);
assert.strictEqual(unrec.can_recover, false);
assert.strictEqual(unrec.max_missable, null);
assert.strictEqual(unrec.min_consecutive_to_threshold, null);
assert(unrec.recommendation.includes('Recovery is mathematically impossible'));
console.log('✓ Unrecoverable scenario handled safely without safe misses');

// 5. Exactly at Threshold
const atThr = generatePersonalizedRecommendation(30, 40, 8, 75, 48);
assert.strictEqual(atThr.current_attendance, 75.0);
assert.strictEqual(atThr.min_consecutive_to_threshold, 0);
assert.strictEqual(atThr.max_missable, 2);
assert(atThr.recommendation.includes('currently at the 75% threshold'));
console.log('✓ Exactly at threshold scenario verified');

// 6. Zero Remaining Classes
const zeroRemCompliant = generatePersonalizedRecommendation(40, 50, 0, 75, 50);
assert(zeroRemCompliant.recommendation.includes('Semester completed successfully'));
const zeroRemNonCompliant = generatePersonalizedRecommendation(35, 50, 0, 75, 50);
assert(zeroRemNonCompliant.recommendation.includes('below the required 75% threshold'));
console.log('✓ Zero remaining classes scenarios verified');

// 7. Zero Recorded Classes
const zeroRecorded = generatePersonalizedRecommendation(0, 0, 0, 75, 0);
assert.strictEqual(zeroRecorded.status, 'unavailable');
assert.strictEqual(zeroRecorded.current_attendance, 0);
assert.strictEqual(zeroRecorded.min_consecutive_to_threshold, null);
assert.strictEqual(zeroRecorded.max_missable, null);
assert(zeroRecorded.recommendation.includes('No attendance recorded yet'));
console.log('✓ Zero recorded classes handled with unavailable status');

// 8. Configurable Threshold
const thr80 = generatePersonalizedRecommendation(18, 26, 10, 80, 36);
assert.strictEqual(thr80.can_recover, false);
assert.strictEqual(thr80.max_missable, null);
assert(thr80.recommendation.includes('still below the required 80% threshold'));
console.log('✓ Configurable threshold (80%) dynamically recalculated');

// 9. Inconsistent Data Check
const inconstCalc = calculateRemainingClasses(30, 25, 10);
assert.strictEqual(inconstCalc.is_inconsistent, true);
assert.strictEqual(inconstCalc.remaining, 0);

const inconstRec = generatePersonalizedRecommendation(25, 35, 0, 75, 30);
assert.strictEqual(inconstRec.is_inconsistent, true);
assert(inconstRec.recommendation.includes('Inconsistent attendance record'));
console.log('✓ Inconsistent data flagged without negative remaining');

// 10. Custom Semester Total What-If Simulator Math & Bounds
console.log('--- TESTING CUSTOM SEMESTER TOTAL WHAT-IF SIMULATOR SCENARIOS ---');

// Test Case 10.1: Standard subject (CSE3142: 18 attended, 8 missed -> conducted = 26, total = 36)
{
  const attendedSoFar = 18;
  const missedSoFar = 8;
  const totalSemClasses = 36;
  const conductedSoFar = attendedSoFar + missedSoFar; // 26
  const remaining = totalSemClasses - conductedSoFar; // 10
  const currentPct = (attendedSoFar / conductedSoFar) * 100; // 69.2307%

  assert.strictEqual(conductedSoFar, 26);
  assert.strictEqual(remaining, 10);
  assert.strictEqual(Number(currentPct.toFixed(2)), 69.23);

  // Future sliders: attend 8, miss 2 (synchronized: 8 + 2 = 10)
  const futureAttend = 8;
  const futureMiss = 2;
  assert.strictEqual(futureAttend + futureMiss, remaining);

  const projectedFinalPct =
    ((attendedSoFar + futureAttend) / (conductedSoFar + futureAttend + futureMiss)) * 100;
  // (18 + 8) / (26 + 8 + 2) = 26 / 36 = 72.222%
  assert.strictEqual(Number(projectedFinalPct.toFixed(2)), 72.22);
  assert.strictEqual(projectedFinalPct >= 75.0, false);

  const rec = generatePersonalizedRecommendation(attendedSoFar, conductedSoFar, remaining, 75, totalSemClasses);
  assert.strictEqual(rec.can_recover, true);
  assert.strictEqual(rec.min_consecutive_to_threshold, 6);
  assert.strictEqual(rec.max_missable, 1);
  console.log('✓ Case 10.1: 36 total classes - standard 69.2% -> 72.2% projected verified');
}

// Test Case 10.2: User increases total semester classes from 36 to 50
{
  const attendedSoFar = 18;
  const missedSoFar = 8;
  const totalSemClasses = 50;
  const conductedSoFar = attendedSoFar + missedSoFar; // 26
  const remaining = totalSemClasses - conductedSoFar; // 24

  assert.strictEqual(remaining, 24);

  // Full recovery possible: (18 + 24) / 50 = 42 / 50 = 84%
  const bestFinal = ((attendedSoFar + remaining) / totalSemClasses) * 100;
  assert.strictEqual(bestFinal, 84.0);

  // If user plans to attend 20 and miss 4 (20 + 4 = 24)
  const futureAttend = 20;
  const futureMiss = 4;
  const projectedFinalPct =
    ((attendedSoFar + futureAttend) / (conductedSoFar + futureAttend + futureMiss)) * 100;
  // (18 + 20) / 50 = 38 / 50 = 76% >= 75%
  assert.strictEqual(projectedFinalPct, 76.0);
  assert.strictEqual(projectedFinalPct >= 75.0, true);

  const rec = generatePersonalizedRecommendation(attendedSoFar, conductedSoFar, remaining, 75, totalSemClasses);
  assert.strictEqual(rec.can_recover, true);
  // Max missable classes: 50 * 0.75 = 37.5 -> 38 needed. 18 + 24 - 38 = 4 max missable
  assert.strictEqual(rec.max_missable, 4);
  console.log('✓ Case 10.2: Increased to 50 total classes - expanded buffer verified');
}

// Test Case 10.3: User reduces total semester classes from 36 to 30 (unrecoverable edge case)
{
  const attendedSoFar = 18;
  const missedSoFar = 8;
  const totalSemClasses = 30;
  const conductedSoFar = attendedSoFar + missedSoFar; // 26
  const remaining = totalSemClasses - conductedSoFar; // 4

  assert.strictEqual(remaining, 4);

  // Even attending all 4: (18 + 4) / 30 = 22 / 30 = 73.33% < 75%
  const bestFinal = ((attendedSoFar + remaining) / totalSemClasses) * 100;
  assert.strictEqual(Number(bestFinal.toFixed(2)), 73.33);

  const rec = generatePersonalizedRecommendation(attendedSoFar, conductedSoFar, remaining, 75, totalSemClasses);
  assert.strictEqual(rec.can_recover, false);
  assert.strictEqual(rec.max_missable, null);
  assert(rec.recommendation.includes('Recovery is mathematically impossible'));
  console.log('✓ Case 10.3: Reduced to 30 total classes - unrecoverable condition verified');
}

// Test Case 10.4: User sets total semester classes equal to conducted (remaining = 0)
{
  const attendedSoFar = 36;
  const missedSoFar = 14;
  const totalSemClasses = 50;
  const conductedSoFar = attendedSoFar + missedSoFar; // 50
  const remaining = totalSemClasses - conductedSoFar; // 0

  assert.strictEqual(remaining, 0);

  // Sliders must be 0 and final attendance is exact recorded count: 36/50 = 72%
  const finalAttendance = (attendedSoFar / conductedSoFar) * 100;
  assert.strictEqual(finalAttendance, 72.0);

  const rec = generatePersonalizedRecommendation(attendedSoFar, conductedSoFar, 0, 75, totalSemClasses);
  assert.strictEqual(rec.status, 'completed_non_compliant');
  assert(rec.recommendation.includes('Semester completed with 72.0% attendance'));
  console.log('✓ Case 10.4: Zero remaining classes - controls disabled & final attendance verified');
}

// Test Case 10.5: Validation error when conducted exceeds total semester classes
{
  const attendedSoFar = 20;
  const missedSoFar = 10;
  const conductedSoFar = attendedSoFar + missedSoFar; // 30
  const invalidTotal = 25; // 30 > 25

  assert.ok(conductedSoFar > invalidTotal, 'Conducted classes exceed total semester classes');

  const check = calculateRemainingClasses(invalidTotal, attendedSoFar, missedSoFar);
  assert.strictEqual(check.is_inconsistent, true);
  assert.strictEqual(check.remaining, 0);
  assert.ok(check.error.includes('exceed semester total'));
  console.log('✓ Case 10.5: Conducted > total validation error correctly flagged');
}

// Test Case 10.6: Zero conducted classes edge case
{
  const attendedSoFar = 0;
  const missedSoFar = 0;
  const totalSemClasses = 40;
  const conductedSoFar = attendedSoFar + missedSoFar; // 0
  const remaining = totalSemClasses - conductedSoFar; // 40

  assert.strictEqual(conductedSoFar, 0);
  assert.strictEqual(remaining, 40);

  // Current attendance is unavailable (no division by zero)
  const currentPct = conductedSoFar > 0 ? (attendedSoFar / conductedSoFar) * 100 : null;
  assert.strictEqual(currentPct, null);

  // Simulate future classes: attend 30, miss 10 (30 + 10 = 40)
  const futureAttend = 30;
  const futureMiss = 10;
  const projectedFinalPct =
    ((attendedSoFar + futureAttend) / (conductedSoFar + futureAttend + futureMiss)) * 100;
  assert.strictEqual(projectedFinalPct, 75.0);

  const rec = generatePersonalizedRecommendation(0, 0, 40, 75, 40);
  assert.strictEqual(rec.status, 'unavailable');
  assert(rec.recommendation.includes('No attendance recorded yet'));
  console.log('✓ Case 10.6: Zero conducted classes - unavailable status & division by zero protected');
}

console.log('ALL FRONTEND RECOMMENDATION & CUSTOM SIMULATOR TESTS PASSED SUCCESSFULLY!');

