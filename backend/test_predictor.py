"""
Comprehensive Automated Test Suite for Attendance Risk Prediction Engine.

Validates all 14 required evaluation scenarios, mathematical proofs,
monotonicity guarantees, boundary conditions, and model inference.
"""

from __future__ import annotations

import unittest
from train_model import (
    attendance_pct,
    attendance_trend,
    best_case_attendance,
    build_features,
    can_recover,
    consecutive_absences,
    expected_final_attendance,
    label_risk,
    max_missable_classes,
    min_classes_to_threshold,
    min_remaining_to_attend,
    projected,
    recent_absence_rate,
    worst_case_attendance,
)
from main import predict_subject


class TestAttendanceMathematics(unittest.TestCase):
    """Test pure mathematical foundations and closed-form equations."""

    def test_current_attendance_standard(self):
        self.assertAlmostEqual(attendance_pct(36, 50), 72.0, places=2)
        self.assertAlmostEqual(attendance_pct(42, 54), 77.77777777777779, places=2)
        self.assertAlmostEqual(attendance_pct(47, 54), 87.03703703703704, places=2)

    def test_zero_and_invalid_denominators(self):
        # Scenario 9: Zero classes and boundary conditions
        self.assertEqual(attendance_pct(0, 0), 100.0)
        self.assertEqual(attendance_pct(0, -5), 100.0)
        self.assertEqual(attendance_pct(-5, 50), 0.0)
        self.assertEqual(attendance_pct(60, 50), 100.0)  # Clamped

    def test_projected_monotonicity(self):
        # Scenario 12: Increasing future attendance cannot decrease final %
        base = projected(30, 40, 5, 5)  # 35/50 = 70.0%
        more_attend = projected(30, 40, 6, 5)  # 36/51 = 70.588%
        more_miss = projected(30, 40, 5, 6)  # 35/51 = 68.627%

        self.assertGreater(more_attend, base)
        self.assertLess(more_miss, base)

    def test_closed_form_formula_n_verification(self):
        # Scenario 4: Below threshold, recovery possible
        # A = 36, C = 50, R = 14, threshold = 75%
        # r*C - A = 37.5 - 36 = 1.5; 1 - r = 0.25; N = ceil(1.5 / 0.25) = 6
        n = min_classes_to_threshold(36, 50, 14, 75.0)
        self.assertEqual(n, 6)
        # Verify: (36 + 6) / (50 + 6) = 42/56 = 75.0% >= 75.0%
        self.assertGreaterEqual((36 + n) / (50 + n), 0.75)

    def test_min_remaining_to_attend_out_of_r(self):
        # A = 36, C = 50, R = 14, threshold = 75%
        # Total = 64; 75% of 64 = 48; needed = 48 - 36 = 12 of 14 classes
        k = min_remaining_to_attend(36, 50, 14, 75.0)
        self.assertEqual(k, 12)
        # Verify: (36 + 12) / 64 = 48/64 = 75.0%
        self.assertAlmostEqual(projected(36, 50, k, 14 - k), 75.0, places=2)

    def test_max_missable_classes(self):
        # A = 36, C = 50, R = 14, threshold = 75% -> max missable = 2 (attending 12)
        m = max_missable_classes(36, 50, 14, 75.0)
        self.assertEqual(m, 2)
        self.assertGreaterEqual(projected(36, 50, 14 - m, m), 75.0)
        # If student misses 3, attendance falls below 75%
        self.assertLess(projected(36, 50, 14 - (m + 1), m + 1), 75.0)


class TestFourteenScenarios(unittest.TestCase):
    """Rigorous evaluation across all 14 scenarios specified in prompt."""

    def test_scenario_1_high_attendance_sufficient_remaining(self):
        # Scenario 1: High attendance with sufficient remaining classes
        pred = predict_subject(attended=45, conducted=50, remaining=15, threshold=75.0)
        self.assertEqual(pred["risk"], "Low")
        self.assertEqual(pred["compliance_status"], "Compliant")
        self.assertTrue(pred["can_recover"])
        self.assertEqual(pred["min_classes_to_threshold"], 0)
        self.assertGreater(pred["max_missable"], 5)

    def test_scenario_2_attendance_just_above_threshold(self):
        # Scenario 2: Attendance just above threshold (vulnerable margin)
        # 38/50 = 76.0%, margin = +1.0% above 75%
        pred = predict_subject(
            attended=38,
            conducted=50,
            remaining=10,
            threshold=75.0,
            recent_pattern=["A", "M", "A", "M", "A"],
        )
        # Missing next class immediately (38/51 = 74.5%) breaches threshold -> High or Moderate risk
        self.assertIn(pred["risk"], ["Moderate", "High"])
        self.assertEqual(pred["compliance_status"], "Compliant")
        self.assertLess(pred["features"]["immediate_miss_pct"], 75.0)

    def test_scenario_3_attendance_exactly_at_threshold(self):
        # Scenario 3: Attendance exactly at threshold
        # 45/60 = 75.0%, margin = 0.0%
        pred = predict_subject(
            attended=45, conducted=60, remaining=12, threshold=75.0
        )
        self.assertEqual(pred["compliance_status"], "Compliant")
        self.assertEqual(pred["current_attendance"], 75.0)
        # Missing next class immediately (45/61 = 73.8%) breaches 75%
        self.assertLess(pred["features"]["immediate_miss_pct"], 75.0)
        self.assertIn(pred["risk"], ["Moderate", "High"])

    def test_scenario_4_below_threshold_recovery_possible(self):
        # Scenario 4: Below threshold with recovery possible
        # 36/50 = 72.0%, threshold = 75%, rem = 14. Best case = 50/64 = 78.125% >= 75%
        pred = predict_subject(
            attended=36,
            conducted=50,
            remaining=14,
            threshold=75.0,
            recent_pattern=["A", "M", "M", "A", "M"],
        )
        self.assertEqual(pred["compliance_status"], "Non-Compliant")
        self.assertTrue(pred["can_recover"])
        self.assertEqual(pred["risk"], "High")  # Requires 12 of 14 classes (85.7%)
        self.assertEqual(pred["min_classes_to_threshold"], 6)
        self.assertEqual(pred["min_remaining_to_attend"], 12)

    def test_scenario_5_below_threshold_recovery_impossible(self):
        # Scenario 5: Below threshold with recovery impossible
        # 30/50 = 60.0%, threshold = 75%, rem = 8.
        # Best case = (30 + 8) / 58 = 38 / 58 = 65.5% < 75%
        pred = predict_subject(
            attended=30, conducted=50, remaining=8, threshold=75.0
        )
        self.assertEqual(pred["compliance_status"], "Non-Compliant")
        self.assertFalse(pred["can_recover"])
        self.assertEqual(pred["risk"], "High")
        self.assertIsNone(pred["min_classes_to_threshold"])
        self.assertIsNone(pred["max_missable"])
        self.assertIn("cannot reach", pred["factors"][1]["detail"].lower())

    def test_scenario_6_student_expecting_multiple_absences(self):
        # Scenario 6: Student expecting multiple future absences
        # Currently 42/50 = 84.0%, threshold = 75%, rem = 10.
        # If student misses 4 classes out of 10: projected = (42 + 6)/60 = 48/60 = 80.0%
        # If student misses 6 classes out of 10: projected = (42 + 4)/60 = 46/60 = 76.67%
        # If student misses 7 classes out of 10: projected = (42 + 3)/60 = 45/60 = 75.0%
        # If student misses 8 classes out of 10: projected = (42 + 2)/60 = 44/60 = 73.33% (Breach!)
        max_miss = max_missable_classes(42, 50, 10, 75.0)
        self.assertEqual(max_miss, 7)
        self.assertGreaterEqual(projected(42, 50, 10 - 7, 7), 75.0)
        self.assertLess(projected(42, 50, 10 - 8, 8), 75.0)

    def test_scenario_7_recent_consecutive_absences(self):
        # Scenario 7: Recent consecutive absences when ordered records exist
        pattern = ["A", "A", "M", "M", "M"]
        self.assertEqual(consecutive_absences(pattern), 3)
        self.assertAlmostEqual(recent_absence_rate(pattern), 0.6, places=2)

        pred = predict_subject(
            attended=40,
            conducted=50,
            remaining=10,
            threshold=75.0,
            recent_pattern=pattern,
        )
        # 3 consecutive absences increases risk
        self.assertIn(pred["risk"], ["Moderate", "High"])
        factor_titles = [f["factor"] for f in pred["factors"]]
        self.assertIn("Consecutive Absence Streak", factor_titles)

    def test_scenario_8_missing_historical_data(self):
        # Scenario 8: Missing historical data (null / empty pattern and trend)
        pred = predict_subject(
            attended=40,
            conducted=50,
            remaining=10,
            threshold=75.0,
            recent_pattern=[],
            weekly_trend=[],
        )
        self.assertEqual(pred["features"]["recent_absence_rate"], 0.0)
        self.assertEqual(pred["features"]["consecutive_absences"], 0)
        self.assertEqual(pred["features"]["attendance_trend"], 0.0)
        self.assertIsNotNone(pred["risk"])

    def test_scenario_9_zero_classes_and_boundaries(self):
        # Scenario 9: Zero classes and boundary handling
        pred = predict_subject(
            attended=0, conducted=0, remaining=40, threshold=75.0
        )
        self.assertEqual(pred["current_attendance"], 100.0)
        self.assertTrue(pred["can_recover"])

    def test_scenario_10_different_thresholds_per_subject(self):
        # Scenario 10: Different attendance thresholds (75% vs 80% vs 65%)
        # For attended=40, conducted=50 (80.0% attendance):
        pred_75 = predict_subject(attended=40, conducted=50, remaining=10, threshold=75.0)
        pred_80 = predict_subject(attended=40, conducted=50, remaining=10, threshold=80.0)
        pred_65 = predict_subject(attended=40, conducted=50, remaining=10, threshold=65.0)

        # Higher threshold reduces margin and increases risk
        self.assertGreater(pred_65["features"]["margin_to_threshold"], pred_75["features"]["margin_to_threshold"])
        self.assertGreater(pred_75["features"]["margin_to_threshold"], pred_80["features"]["margin_to_threshold"])
        self.assertGreaterEqual(pred_65["max_missable"], pred_75["max_missable"])
        self.assertGreaterEqual(pred_75["max_missable"], pred_80["max_missable"])

    def test_scenario_11_multiple_independent_subjects(self):
        # Scenario 11: Multiple subjects with independent records
        s1 = predict_subject(36, 50, 14, 75.0, recent_pattern=["A", "M", "M", "A", "M"])
        s2 = predict_subject(49, 54, 10, 75.0, recent_pattern=["A", "A", "A", "A", "A"])

        self.assertEqual(s1["risk"], "High")
        self.assertEqual(s2["risk"], "Low")
        self.assertNotEqual(s1["current_attendance"], s2["current_attendance"])

    def test_scenario_12_monotonicity_of_future_inputs(self):
        # Scenario 12: Monotonicity guarantees
        # For fixed A, C:
        # Increasing future attended can never decrease projected attendance
        A, C = 35, 50
        p1 = projected(A, C, 5, 5)
        p2 = projected(A, C, 6, 5)
        p3 = projected(A, C, 7, 5)
        self.assertLessEqual(p1, p2)
        self.assertLessEqual(p2, p3)

        # Increasing future absences can never increase projected attendance
        m1 = projected(A, C, 5, 4)
        m2 = projected(A, C, 5, 5)
        m3 = projected(A, C, 5, 6)
        self.assertGreaterEqual(m1, m2)
        self.assertGreaterEqual(m2, m3)

    def test_scenario_13_isolation_of_unrelated_subjects(self):
        # Scenario 13: Updating inputs for Subject A does not alter Subject B
        subj_a_before = predict_subject(36, 50, 14, 75.0)
        subj_b_before = predict_subject(47, 54, 12, 75.0)

        # Change Subject A inputs
        subj_a_after = predict_subject(40, 50, 14, 75.0)
        subj_b_after = predict_subject(47, 54, 12, 75.0)

        self.assertNotEqual(subj_a_before["current_attendance"], subj_a_after["current_attendance"])
        self.assertEqual(subj_b_before["current_attendance"], subj_b_after["current_attendance"])
        self.assertEqual(subj_b_before["risk"], subj_b_after["risk"])

    def test_scenario_14_boundary_conditions_last_remaining_class(self):
        # Scenario 14: Boundary conditions involving remaining = 1 and remaining = 0
        # A = 37, C = 50 (74.0%), threshold = 75.0%, remaining = 1
        # If attend the 1 class: 38/51 = 74.5% < 75% -> Recovery impossible!
        pred_rem1_unrec = predict_subject(37, 50, 1, 75.0)
        self.assertFalse(pred_rem1_unrec["can_recover"])
        self.assertEqual(pred_rem1_unrec["risk"], "High")

        # A = 37, C = 49 (75.51%), threshold = 75.0%, remaining = 1
        # If attend: 38/50 = 76.0% >= 75.0%
        # If miss: 37/50 = 74.0% < 75.0%
        pred_rem1_rec = predict_subject(37, 49, 1, 75.0)
        self.assertTrue(pred_rem1_rec["can_recover"])
        self.assertEqual(pred_rem1_rec["max_missable"], 0)
        self.assertEqual(pred_rem1_rec["min_remaining_to_attend"], 1)

        # Remaining = 0 (Semester completed)
        pred_rem0_pass = predict_subject(40, 50, 0, 75.0)
        self.assertEqual(pred_rem0_pass["risk"], "Low")
        self.assertEqual(pred_rem0_pass["compliance_status"], "Compliant")

        pred_rem0_fail = predict_subject(35, 50, 0, 75.0)
        self.assertEqual(pred_rem0_fail["risk"], "High")
        self.assertEqual(pred_rem0_fail["compliance_status"], "Non-Compliant")


if __name__ == "__main__":
    unittest.main()
