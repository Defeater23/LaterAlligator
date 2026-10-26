"""
Comprehensive unit and integration tests for attendance calculations and personalized recommendations.
Tests all requirements:
1. Every subject of Krrish Gupta against expected remaining classes, conducted, and totals.
2. Attendance below threshold but recoverable (with verification of n and m bounds).
3. Attendance below threshold and unrecoverable (no misleading safe absences).
4. Attendance exactly at threshold.
5. Attendance above threshold (calculates safe misses, does not prescribe extra classes to reach).
6. Zero remaining classes (completed compliant and non-compliant).
7. Zero recorded classes (no attendance recorded).
8. Configured threshold of 75% vs different configured threshold (e.g. 80%).
9. Mathematical validity: one fewer attended class violates recovery; one more absence violates threshold.
10. Inconsistent data where conducted classes exceed semester total.
"""

from __future__ import annotations

import unittest
from train_model import (
    calculate_remaining_classes,
    generate_personalized_recommendation,
    min_classes_to_threshold,
    max_missable_classes,
    can_recover,
    best_case_attendance,
    worst_case_attendance,
)


class TestPersonalizedRecommendations(unittest.TestCase):
    def test_krrish_gupta_subjects_remaining_classes(self):
        """Test all 7 configured subjects for Krrish Gupta against the specification."""
        krrish_data = [
            # code, name, attended, absent, sem_total, expected_cond, expected_rem
            ("CSE3101", "Computer Networks", 29, 7, 48, 36, 12),
            ("CSE3102", "Software Engineering", 31, 9, 48, 40, 8),
            ("CSE3121", "Artificial Intelligence & Soft Computing", 30, 9, 48, 39, 9),
            ("CSE3131", "Computer Networks Lab", 10, 1, 48, 11, 37),
            ("CSE3132", "Software Engineering Lab", 7, 2, 48, 9, 39),
            ("CSE3142", "Android App Development", 18, 8, 36, 26, 10),
            ("CSE3147", "Essentials of Cyber Security", 27, 5, 36, 32, 4),
        ]

        for code, name, att, ab, sem_tot, exp_cond, exp_rem in krrish_data:
            with self.subTest(subject=code):
                res = calculate_remaining_classes(sem_tot, att, ab)
                self.assertFalse(res["is_inconsistent"])
                self.assertIsNone(res["error"])
                self.assertEqual(res["conducted"], exp_cond)
                self.assertEqual(res["semester_total"], sem_tot)
                self.assertEqual(res["remaining"], exp_rem)
                # Verify formula: remaining = semester_total - (attended + absent)
                self.assertEqual(res["remaining"], sem_tot - (att + ab))
                # Verify NOT calculated as semester_total - attended alone
                self.assertNotEqual(res["remaining"], sem_tot - att)

    def test_krrish_gupta_personalized_recommendations(self):
        """Verify dynamic recommendation generation for each of Krrish Gupta's subjects at 75%."""
        # 1. Computer Networks: 29/36 (80.6% > 75%), R=12, sem_tot=48
        cn = generate_personalized_recommendation(29, 36, 12, threshold=75.0, semester_total=48)
        self.assertAlmostEqual(cn["current_attendance"], 80.56, places=1)
        self.assertEqual(cn["attended"], 29)
        self.assertEqual(cn["absent"], 7)
        self.assertEqual(cn["conducted"], 36)
        self.assertEqual(cn["remaining"], 12)
        self.assertEqual(cn["semester_total"], 48)
        self.assertTrue(cn["can_recover"])
        self.assertEqual(cn["max_missable"], 5)
        self.assertEqual(cn["min_consecutive_to_threshold"], 0)
        self.assertAlmostEqual(cn["projected_final_if_attend_all"], 85.42, places=1)
        self.assertIn("above the threshold", cn["recommendation"])
        self.assertIn("at most 5", cn["recommendation"])

        # 2. Android App Development: 18/26 (69.2% < 75%), R=10, sem_tot=36
        android = generate_personalized_recommendation(18, 26, 10, threshold=75.0, semester_total=36)
        self.assertAlmostEqual(android["current_attendance"], 69.23, places=1)
        self.assertTrue(android["can_recover"])
        self.assertEqual(android["min_consecutive_to_threshold"], 6)
        self.assertEqual(android["max_missable"], 1)
        self.assertAlmostEqual(android["projected_final_if_attend_all"], 77.78, places=1)
        self.assertIn("next 6 consecutive classes", android["recommendation"])
        self.assertIn("at most 1 class", android["recommendation"])

        # 3. Essentials of Cyber Security: 27/32 (84.4%), R=4, sem_tot=36
        cyber = generate_personalized_recommendation(27, 32, 4, threshold=75.0, semester_total=36)
        self.assertAlmostEqual(cyber["current_attendance"], 84.38, places=1)
        self.assertEqual(cyber["max_missable"], 4)
        self.assertIn("can miss all 4 remaining classes", cyber["recommendation"])

    def test_attendance_below_threshold_recoverable_mathematical_bounds(self):
        """Verify minimum n and maximum m bounds: n satisfies threshold, n-1 violates; m satisfies, m+1 violates."""
        # A = 18, C = 26, R = 10, T = 75.0
        n = min_classes_to_threshold(18, 26, 10, 75.0)
        self.assertEqual(n, 6)
        # Verify n = 6 satisfies: (18 + 6)/(26 + 6) = 24/32 = 75.0% >= 75%
        self.assertGreaterEqual((18 + n) / (26 + n), 0.75 - 1e-9)
        # Verify n - 1 = 5 violates: (18 + 5)/(26 + 5) = 23/31 = 74.19% < 75%
        self.assertLess((18 + (n - 1)) / (26 + (n - 1)), 0.75 - 1e-9)

        m = max_missable_classes(18, 26, 10, 75.0)
        self.assertEqual(m, 1)
        # Verify m = 1 satisfies: (18 + 10 - 1)/36 = 27/36 = 75.0% >= 75%
        self.assertGreaterEqual((18 + 10 - m) / 36, 0.75 - 1e-9)
        # Verify m + 1 = 2 violates: (18 + 10 - 2)/36 = 26/36 = 72.22% < 75%
        self.assertLess((18 + 10 - (m + 1)) / 36, 0.75 - 1e-9)

    def test_attendance_below_threshold_unrecoverable(self):
        """Unrecoverable case: best possible final < threshold, max_missable is None."""
        rec = generate_personalized_recommendation(10, 30, 10, threshold=75.0, semester_total=40)
        self.assertFalse(rec["can_recover"])
        self.assertAlmostEqual(rec["projected_final_if_attend_all"], 50.0)
        self.assertIsNone(rec["max_missable"])
        self.assertIsNone(rec["min_consecutive_to_threshold"])
        self.assertIn("Recovery is mathematically impossible", rec["recommendation"])
        self.assertIn("50.0%", rec["recommendation"])

    def test_attendance_exactly_at_threshold(self):
        """Attendance exactly at threshold: 30/40 = 75.0%."""
        rec = generate_personalized_recommendation(30, 40, 8, threshold=75.0, semester_total=48)
        self.assertAlmostEqual(rec["current_attendance"], 75.0)
        self.assertEqual(rec["min_consecutive_to_threshold"], 0)
        self.assertEqual(rec["max_missable"], 2)
        # Verify m = 2 satisfies: (30 + 8 - 2)/48 = 36/48 = 75.0%
        self.assertGreaterEqual((30 + 8 - 2) / 48, 0.75 - 1e-9)
        # Verify m + 1 = 3 violates: (30 + 8 - 3)/48 = 35/48 = 72.9% < 75%
        self.assertLess((30 + 8 - 3) / 48, 0.75 - 1e-9)
        self.assertIn("currently at the 75% threshold", rec["recommendation"])

    def test_attendance_above_threshold(self):
        """Attendance above threshold: does not prescribe extra classes to reach it."""
        rec = generate_personalized_recommendation(29, 36, 12, threshold=75.0, semester_total=48)
        self.assertAlmostEqual(rec["current_attendance"], 80.56, places=1)
        self.assertEqual(rec["min_consecutive_to_threshold"], 0)
        self.assertEqual(rec["max_missable"], 5)
        self.assertIn("above the threshold", rec["recommendation"])
        self.assertNotIn("need to attend", rec["recommendation"].lower())

    def test_zero_remaining_classes(self):
        """Zero remaining classes: completed compliant and completed non-compliant."""
        comp = generate_personalized_recommendation(40, 50, 0, threshold=75.0, semester_total=50)
        self.assertEqual(comp["status"], "completed_compliant")
        self.assertIn("Semester completed successfully with 80.0%", comp["recommendation"])

        non_comp = generate_personalized_recommendation(35, 50, 0, threshold=75.0, semester_total=50)
        self.assertEqual(non_comp["status"], "completed_non_compliant")
        self.assertIn("Semester completed with 70.0% attendance, which is below", non_comp["recommendation"])

    def test_zero_recorded_classes(self):
        """Subject with no classes conducted yet: unavailable status and clear guidance."""
        rec = generate_personalized_recommendation(0, 0, 0, threshold=75.0, semester_total=0)
        self.assertEqual(rec["status"], "unavailable")
        self.assertEqual(rec["current_attendance"], 0.0)
        self.assertIsNone(rec["min_consecutive_to_threshold"])
        self.assertIsNone(rec["max_missable"])
        self.assertIn("No attendance recorded yet for this subject", rec["recommendation"])

    def test_configurable_threshold_sensitivity(self):
        """Changing threshold alters feasibility dynamically."""
        # Android: 18/26, R=10. At 75%, recoverable with n=6, m=1.
        rec_75 = generate_personalized_recommendation(18, 26, 10, threshold=75.0, semester_total=36)
        self.assertTrue(rec_75["can_recover"])
        self.assertEqual(rec_75["max_missable"], 1)

        # At 80%, best final is 28/36 = 77.78% < 80% -> unrecoverable!
        rec_80 = generate_personalized_recommendation(18, 26, 10, threshold=80.0, semester_total=36)
        self.assertFalse(rec_80["can_recover"])
        self.assertIsNone(rec_80["max_missable"])
        self.assertIn("still below the required 80% threshold", rec_80["recommendation"])

    def test_inconsistent_data_handling(self):
        """Conducted classes exceed semester total: flags inconsistency without negative remaining."""
        res = calculate_remaining_classes(semester_total=30, attended=25, absent=10)
        self.assertTrue(res["is_inconsistent"])
        self.assertIn("exceed semester total", res["error"])
        self.assertEqual(res["remaining"], 0)

        rec = generate_personalized_recommendation(25, 35, 0, threshold=75.0, semester_total=30)
        self.assertTrue(rec["is_inconsistent"])
        self.assertEqual(rec["status"], "inconsistent")
        self.assertIn("Inconsistent attendance record", rec["recommendation"])


if __name__ == "__main__":
    unittest.main()
