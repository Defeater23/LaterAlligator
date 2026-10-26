"""
Automated unit tests for the What-If Attendance Simulator.
Validates the requirements from Section 7:
1. Current attendance above the threshold.
2. Current attendance below the threshold.
3. Zero remaining classes (R = 0).
4. All remaining classes attended (X = R, Y = 0).
5. All remaining classes missed (X = 0, Y = R).
6. A mixture of attended and missed classes.
7. Impossible recovery (mathematically unrecoverable).
8. Invalid input combinations (attend + miss > remaining, attended > conducted).
9. Percentage-only input without class counts (using C_est).
10. Dynamic input changes producing consistent recalculated results.
"""

from __future__ import annotations

import unittest
from fastapi.testclient import TestClient

from main import app
from train_model import (
    attendance_pct,
    calculate_simulation_scenarios,
    projected,
    projected_from_percentage,
)


class TestWhatIfSimulator(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_1_current_attendance_above_threshold(self):
        """Current attendance above threshold (e.g. 45/50 = 90% vs 75% threshold)."""
        res = calculate_simulation_scenarios(
            attended=45,
            conducted=50,
            remaining=10,
            threshold=75.0,
            attend=5,
            miss=5,
        )
        self.assertEqual(res["current_attendance"], 90.0)
        self.assertTrue(res["can_recover"])
        self.assertTrue(res["above_threshold"])
        self.assertGreater(res["projected_attendance"], 75.0)
        self.assertGreaterEqual(res["max_missable"], 5)

    def test_2_current_attendance_below_threshold(self):
        """Current attendance below threshold (e.g. 36/50 = 72% vs 75% threshold)."""
        res = calculate_simulation_scenarios(
            attended=36,
            conducted=50,
            remaining=14,
            threshold=75.0,
            attend=12,
            miss=2,
        )
        self.assertEqual(res["current_attendance"], 72.0)
        self.assertEqual(res["projected_attendance"], 75.0)
        self.assertTrue(res["above_threshold"])
        self.assertEqual(res["min_remaining_to_attend"], 12)
        self.assertEqual(res["max_missable"], 2)

    def test_3_zero_remaining_classes(self):
        """Zero remaining classes (R = 0) boundary condition."""
        res_pass = calculate_simulation_scenarios(
            attended=40,
            conducted=50,
            remaining=0,
            threshold=75.0,
            attend=0,
            miss=0,
        )
        self.assertEqual(res_pass["current_attendance"], 80.0)
        self.assertEqual(res_pass["projected_attendance"], 80.0)
        self.assertTrue(res_pass["above_threshold"])
        self.assertEqual(res_pass["min_remaining_to_attend"], 0)
        self.assertEqual(res_pass["max_missable"], 0)

        res_fail = calculate_simulation_scenarios(
            attended=35,
            conducted=50,
            remaining=0,
            threshold=75.0,
            attend=0,
            miss=0,
        )
        self.assertEqual(res_fail["current_attendance"], 70.0)
        self.assertEqual(res_fail["projected_attendance"], 70.0)
        self.assertFalse(res_fail["above_threshold"])
        self.assertFalse(res_fail["can_recover"])
        self.assertTrue(res_fail["is_unrecoverable"])

    def test_4_all_remaining_classes_attended(self):
        """Scenario A: All remaining classes attended (X = R, Y = 0)."""
        res = calculate_simulation_scenarios(
            attended=36,
            conducted=50,
            remaining=14,
            threshold=75.0,
            attend=14,
            miss=0,
        )
        # Final attendance: (36 + 14) / (50 + 14) = 50 / 64 = 78.125% -> 78.12%
        self.assertEqual(res["projected_attendance"], 78.12)
        self.assertEqual(res["scenario_a"]["attend"], 14)
        self.assertEqual(res["scenario_a"]["miss"], 0)
        self.assertEqual(res["scenario_a"]["projected"], 78.12)
        self.assertTrue(res["scenario_a"]["meets_threshold"])

    def test_5_all_remaining_classes_missed(self):
        """Scenario E: All remaining classes missed (X = 0, Y = R)."""
        res = calculate_simulation_scenarios(
            attended=36,
            conducted=50,
            remaining=14,
            threshold=75.0,
            attend=0,
            miss=14,
        )
        # Final attendance: (36 + 0) / (50 + 14) = 36 / 64 = 56.25%
        self.assertEqual(res["projected_attendance"], 56.25)
        self.assertFalse(res["above_threshold"])
        self.assertEqual(res["scenario_e"]["projected"], 56.25)

    def test_6_mixture_of_attended_and_missed_classes(self):
        """Mixture of attended and missed classes (X = 10, Y = 4 out of 14)."""
        res = calculate_simulation_scenarios(
            attended=36,
            conducted=50,
            remaining=14,
            threshold=75.0,
            attend=10,
            miss=4,
        )
        # Final attendance: (36 + 10) / (50 + 14) = 46 / 64 = 71.875% -> 71.88%
        self.assertEqual(res["projected_attendance"], 71.88)
        self.assertFalse(res["above_threshold"])
        self.assertEqual(res["margin_to_threshold"], -3.12)

    def test_7_impossible_recovery(self):
        """Impossible recovery: even 100% attendance cannot reach the threshold."""
        # 20 attended out of 50 = 40%, remaining = 10, threshold = 75%
        # Best case: (20 + 10) / (50 + 10) = 30 / 60 = 50.0% < 75%
        res = calculate_simulation_scenarios(
            attended=20,
            conducted=50,
            remaining=10,
            threshold=75.0,
            attend=10,
            miss=0,
        )
        self.assertFalse(res["can_recover"])
        self.assertTrue(res["is_unrecoverable"])
        self.assertIsNone(res["min_remaining_to_attend"])
        self.assertIsNone(res["max_missable"])
        self.assertIn("mathematically unrecoverable", res["recommendation"].lower())

    def test_8_invalid_input_combinations(self):
        """Invalid input combinations: attend + miss > remaining, conducted < attended."""
        # attend (10) + miss (10) > remaining (14)
        response_overflow = self.client.post(
            "/api/simulate",
            json={
                "attended": 36,
                "conducted": 50,
                "remaining": 14,
                "threshold": 75.0,
                "attend": 10,
                "miss": 10,
            },
        )
        self.assertEqual(response_overflow.status_code, 400)
        self.assertIn("cannot exceed remaining classes", response_overflow.json()["detail"])

        # conducted (30) < attended (40)
        response_inverted = self.client.post(
            "/api/simulate",
            json={
                "attended": 40,
                "conducted": 30,
                "remaining": 14,
                "threshold": 75.0,
                "attend": 10,
                "miss": 2,
            },
        )
        self.assertEqual(response_inverted.status_code, 400)
        self.assertIn("conducted classes must be >= attended classes", response_inverted.json()["detail"])

    def test_9_percentage_only_input_with_disclosed_c_est(self):
        """Percentage-only input without class counts, using disclosed C_est baseline."""
        res = calculate_simulation_scenarios(
            attended=None,
            conducted=None,
            remaining=10,
            threshold=75.0,
            attend=8,
            miss=2,
            current_pct=70.0,
            conducted_est=50,
        )
        # C_est = 50, A_est = 35. Projected: (35 + 8) / (50 + 10) = 43 / 60 = 71.67%
        self.assertEqual(res["current_attendance"], 70.0)
        self.assertEqual(res["projected_attendance"], 71.67)
        self.assertEqual(res["calculation_mode"], "percentage_approximation")
        self.assertIsNotNone(res["calculation_note"])
        self.assertIn("50 conducted classes", res["calculation_note"])

    def test_10_consistency_check_between_percentage_and_counts(self):
        """Consistency check: entered percentage contradicts class counts."""
        res = calculate_simulation_scenarios(
            attended=36,
            conducted=50,  # actual 72%
            remaining=14,
            threshold=75.0,
            attend=12,
            miss=2,
            current_pct=85.0,  # contradicts 72%
        )
        self.assertIsNotNone(res["inconsistent_warning"])
        self.assertIn("contradicts class counts", res["inconsistent_warning"])
        self.assertEqual(res["calculation_mode"], "exact_class_counts")
        # Exact calculation must be used despite conflicting percentage
        self.assertEqual(res["projected_attendance"], 75.0)

    def test_11_scenarios_comparison_a_b_c_d_e(self):
        """Ensure Scenarios A, B, C, D, E are generated with correct margins and compliance."""
        res = calculate_simulation_scenarios(
            attended=36,
            conducted=50,
            remaining=14,
            threshold=75.0,
            attend=12,
            miss=2,
        )
        scenarios = {s["id"]: s for s in res["scenario_comparison"]}
        self.assertIn("A", scenarios)
        self.assertIn("B", scenarios)
        self.assertIn("C", scenarios)
        self.assertIn("D", scenarios)
        self.assertIn("E", scenarios)

        # Scenario A: Attend all (14)
        self.assertEqual(scenarios["A"]["attend"], 14)
        self.assertTrue(scenarios["A"]["meets_threshold"])

        # Scenario B: Miss next (13 attend, 1 miss)
        self.assertEqual(scenarios["B"]["attend"], 13)
        self.assertEqual(scenarios["B"]["miss"], 1)

        # Scenario C: Active plan (12 attend, 2 miss)
        self.assertEqual(scenarios["C"]["attend"], 12)
        self.assertEqual(scenarios["C"]["miss"], 2)
        self.assertTrue(scenarios["C"]["meets_threshold"])

        # Scenario D: Break-even (12 attend, 2 miss)
        self.assertEqual(scenarios["D"]["attend"], 12)
        self.assertEqual(scenarios["D"]["miss"], 2)

    def test_11_semester_total_validation(self):
        """Simulate endpoint validation when conducted classes exceed semester_total."""
        res_invalid = self.client.post(
            "/api/simulate",
            json={
                "attended": 20,
                "conducted": 30,
                "remaining": 0,
                "threshold": 75.0,
                "attend": 0,
                "miss": 0,
                "semester_total": 25,
            },
        )
        self.assertEqual(res_invalid.status_code, 400)
        self.assertIn("cannot exceed total semester classes", res_invalid.json()["detail"])

        res_valid = self.client.post(
            "/api/simulate",
            json={
                "attended": 18,
                "conducted": 26,
                "remaining": 10,
                "threshold": 75.0,
                "attend": 8,
                "miss": 2,
                "semester_total": 36,
            },
        )
        self.assertEqual(res_valid.status_code, 200)
        self.assertEqual(res_valid.json()["projected_attendance"], 72.22)


if __name__ == "__main__":
    unittest.main()
