"""
Comprehensive validation tests for the Time-Series Attendance Risk Engine.
Validates the 11 scenarios specified in Section 8 of the requirements:
1. Stable attendance over time.
2. Deteriorating attendance despite a high overall percentage (e.g., 85% overall, but 50% in last 10).
3. Improving attendance after a poor period.
4. Consecutive absences detection.
5. Increasing absence frequency (absence acceleration).
6. Insufficient historical records (explicit window availability flags).
7. Identical overall attendance percentages but different chronological patterns.
8. Subjects with different thresholds.
9. Recoverable and unrecoverable attendance deficits.
10. New attendance records changing the resulting analysis.
11. Data leakage prevention and strictly chronological feature extraction.
"""

from __future__ import annotations

import unittest
from typing import Any

from time_series import (
    extract_time_series_features,
    normalize_status,
    parse_chronological_records,
)
from train_model import (
    build_features,
    can_recover,
    min_classes_to_threshold,
    min_remaining_to_attend,
    max_missable_classes,
)
from main import predict_subject


class TestTimeSeriesAttendanceEngine(unittest.TestCase):
    def test_1_stable_attendance_over_time(self):
        """Scenario 1: Stable attendance over time maintains low delta and stable trend."""
        # 30 classes: 27 attended evenly spaced
        history = [{"session": i, "status": "absent" if i % 10 == 0 else "present"} for i in range(1, 31)]
        features = extract_time_series_features(history, threshold=75.0, remaining=10)

        self.assertEqual(features["conducted"], 30)
        self.assertEqual(features["attended"], 27)
        self.assertEqual(features["trend_direction"], "stable")
        self.assertFalse(features["is_absence_accelerating"])
        self.assertLessEqual(abs(features["recent_vs_overall_delta"]), 5.0)

    def test_2_deteriorating_attendance_despite_high_overall(self):
        """
        Scenario 2: Deteriorating attendance despite a high overall percentage.
        e.g., overall attendance is 85%, but attendance over the last 10 classes is 50%.
        """
        # First 40 classes: 39 attended (97.5%)
        # Last 10 classes: 5 attended (50.0%)
        # Total: 44/50 = 88.0% overall (compliant), but recent window is 50.0%
        history = [{"session": i, "status": "absent" if i == 10 else "present"} for i in range(1, 41)]
        history += [{"session": 40 + i, "status": "absent" if i % 2 == 1 else "present"} for i in range(1, 11)]

        features = extract_time_series_features(history, threshold=75.0, remaining=15)
        self.assertGreaterEqual(features["overall_attendance_pct"], 85.0)
        self.assertEqual(features["window_10"]["rate"], 0.5)
        self.assertEqual(features["trend_direction"], "deteriorating")
        self.assertLessEqual(features["recent_vs_overall_delta"], -15.0)
        self.assertTrue(features["significant_shift_detected"])

        # Check prediction engine identifies emerging risk despite being >= 75%
        pred = predict_subject(
            attended=features["attended"],
            conducted=features["conducted"],
            remaining=15,
            threshold=75.0,
            attendance_history=history,
        )
        # Even though overall is 88%, the severe drop from 97% to 50% must not be classified as comfortable Low risk
        self.assertIn(pred["risk"], ["Moderate", "High"])
        factor_names = [f["factor"] for f in pred["factors"]]
        self.assertIn("Acute Attendance Deterioration", factor_names)

    def test_3_improving_attendance_after_poor_period(self):
        """Scenario 3: Improving attendance after a poor period."""
        # First 20 classes: 10 attended (50.0%)
        # Last 10 classes: 9 attended (90.0%)
        # Total: 19/30 = 63.3% overall
        history = [{"session": i, "status": "absent" if i % 2 == 1 else "present"} for i in range(1, 21)]
        history += [{"session": 20 + i, "status": "absent" if i == 5 else "present"} for i in range(1, 11)]

        features = extract_time_series_features(history, threshold=75.0, remaining=20)
        self.assertGreaterEqual(features["window_10"]["rate"], 0.85)
        self.assertGreaterEqual(features["recent_vs_overall_delta"], 15.0)
        self.assertEqual(features["trend_direction"], "improving")

        pred = predict_subject(
            attended=features["attended"],
            conducted=features["conducted"],
            remaining=20,
            threshold=75.0,
            attendance_history=history,
        )
        factor_names = [f["factor"] for f in pred["factors"]]
        self.assertIn("Improving Attendance Momentum", factor_names)

    def test_4_consecutive_absences_detection(self):
        """Scenario 4: Consecutive absences detection (current streak and longest streak)."""
        # 25 classes with a current streak of 3 consecutive absences
        history = [{"session": i, "status": "present"} for i in range(1, 23)]
        history += [{"session": i, "status": "absent"} for i in range(23, 26)]

        features = extract_time_series_features(history, threshold=75.0, remaining=15)
        self.assertEqual(features["current_consecutive_absences"], 3)
        self.assertEqual(features["longest_consecutive_absences"], 3)
        self.assertEqual(features["sessions_since_last_absence"], 0)

        pred = predict_subject(
            attended=features["attended"],
            conducted=features["conducted"],
            remaining=15,
            threshold=75.0,
            attendance_history=history,
        )
        factor_names = [f["factor"] for f in pred["factors"]]
        self.assertIn("Consecutive Absence Streak", factor_names)

    def test_5_increasing_absence_frequency_acceleration(self):
        """Scenario 5: Increasing absence frequency (absence acceleration across windows)."""
        # First half (20 sessions): 1 absence (5% absence rate)
        # Second half (20 sessions): 8 absences (40% absence rate)
        history = [{"session": i, "status": "absent" if i == 5 else "present"} for i in range(1, 21)]
        history += [{"session": 20 + i, "status": "absent" if i in [2, 5, 8, 11, 14, 16, 18, 20] else "present"} for i in range(1, 21)]

        features = extract_time_series_features(history, threshold=75.0, remaining=10)
        self.assertTrue(features["is_absence_accelerating"])
        self.assertGreater(features["absence_acceleration"], 0.20)

    def test_6_insufficient_historical_records(self):
        """
        Scenario 6: Insufficient historical records.
        Verify that windows (window_5, window_10, window_20) are explicitly marked unavailable.
        """
        history = [
            {"session": 1, "status": "present"},
            {"session": 2, "status": "present"},
            {"session": 3, "status": "absent"},
        ]
        features = extract_time_series_features(history, threshold=75.0, remaining=25)
        self.assertEqual(features["history_length"], 3)
        self.assertFalse(features["has_full_history"])
        self.assertFalse(features["window_5"]["available"])
        self.assertFalse(features["window_10"]["available"])
        self.assertFalse(features["window_20"]["available"])
        self.assertIsNone(features["window_5"]["rate"])
        self.assertIsNone(features["window_10"]["rate"])

    def test_7_identical_overall_attendance_different_trajectories(self):
        """
        Scenario 7: Identical overall attendance percentages but different chronological patterns.
        Both students have 30 conducted, 24 attended (80.0% overall).
        Student A: Deteriorating (was 100% early on, then missed 6 of last 10).
        Student B: Improving (was 60% early on, then attended 100% of last 10).
        """
        # Student A: 20 present, then 4 present + 6 absent = 24/30 = 80.0%
        history_a = [{"session": i, "status": "present"} for i in range(1, 21)]
        history_a += [{"session": 20 + i, "status": "absent" if i in [1, 2, 4, 6, 8, 10] else "present"} for i in range(1, 11)]

        # Student B: 10 present + 6 absent, then 10 present = 24/30 = 80.0%
        history_b = [{"session": i, "status": "absent" if i in [2, 4, 7, 9, 13, 15] else "present"} for i in range(1, 21)]
        history_b += [{"session": 20 + i, "status": "present"} for i in range(1, 11)]

        feat_a = extract_time_series_features(history_a, threshold=75.0, remaining=15)
        feat_b = extract_time_series_features(history_b, threshold=75.0, remaining=15)

        # Confirm exact mathematical equivalence in aggregates
        self.assertEqual(feat_a["overall_attendance_pct"], feat_b["overall_attendance_pct"])
        self.assertEqual(feat_a["attended"], feat_b["attended"])
        self.assertEqual(feat_a["conducted"], feat_b["conducted"])

        # Confirm distinct chronological features
        self.assertEqual(feat_a["trend_direction"], "deteriorating")
        self.assertEqual(feat_b["trend_direction"], "improving")
        self.assertLess(feat_a["recent_vs_overall_delta"], feat_b["recent_vs_overall_delta"])
        self.assertLess(feat_a["expected_final_attendance"], feat_b["expected_final_attendance"])

        # Predict risks
        pred_a = predict_subject(24, 30, 15, 75.0, attendance_history=history_a)
        pred_b = predict_subject(24, 30, 15, 75.0, attendance_history=history_b)

        # Deteriorating student should have equal or higher risk than improving student
        self.assertGreaterEqual(pred_a["probabilities"]["High"], pred_b["probabilities"]["High"])

    def test_8_subjects_with_different_thresholds(self):
        """Scenario 8: Subjects with different attendance thresholds (65%, 75%, 85%)."""
        # 20 attended out of 24 = 83.33%
        history = [{"session": i, "status": "absent" if i in [4, 8, 12, 16] else "present"} for i in range(1, 25)]
        feat_65 = extract_time_series_features(history, threshold=65.0, remaining=10)
        feat_75 = extract_time_series_features(history, threshold=75.0, remaining=10)
        feat_85 = extract_time_series_features(history, threshold=85.0, remaining=10)

        self.assertAlmostEqual(feat_65["margin_to_threshold"], 18.33, places=1)
        self.assertAlmostEqual(feat_75["margin_to_threshold"], 8.33, places=1)
        self.assertAlmostEqual(feat_85["margin_to_threshold"], -1.67, places=1)

        pred_65 = predict_subject(20, 24, 10, 65.0, attendance_history=history)
        pred_75 = predict_subject(20, 24, 10, 75.0, attendance_history=history)
        pred_85 = predict_subject(20, 24, 10, 85.0, attendance_history=history)

        self.assertEqual(pred_65["risk"], "Low")
        self.assertEqual(pred_75["risk"], "Low")
        self.assertEqual(pred_85["risk"], "High")

    def test_9_recoverable_vs_unrecoverable_deficits(self):
        """Scenario 9: Recoverable and unrecoverable attendance deficits."""
        # Unrecoverable: conducted=40, attended=15, remaining=10, threshold=75%
        # Best case: (15 + 10) / 50 = 50.0% < 75%
        self.assertFalse(can_recover(15, 40, 10, 75.0))
        pred_unrec = predict_subject(15, 40, 10, 75.0)
        self.assertEqual(pred_unrec["risk"], "High")
        self.assertFalse(pred_unrec["can_recover"])
        factor_names = [f["factor"] for f in pred_unrec["factors"]]
        self.assertIn("Mathematically Unrecoverable", factor_names)

        # Recoverable: conducted=40, attended=25, remaining=20, threshold=75%
        # Best case: (25 + 20) / 60 = 75.0% == 75%
        self.assertTrue(can_recover(25, 40, 20, 75.0))
        self.assertEqual(min_remaining_to_attend(25, 40, 20, 75.0), 20)

    def test_10_new_attendance_records_changing_analysis(self):
        """Scenario 10: New attendance records dynamically updating the analysis."""
        base_history = [{"session": i, "status": "present"} for i in range(1, 21)]
        feat_initial = extract_time_series_features(base_history, threshold=75.0, remaining=15)
        self.assertEqual(feat_initial["current_consecutive_absences"], 0)
        self.assertEqual(feat_initial["overall_attendance_pct"], 100.0)

        # Append two new absences
        updated_history = base_history + [
            {"session": 21, "status": "absent"},
            {"session": 22, "status": "absent"},
        ]
        feat_updated = extract_time_series_features(updated_history, threshold=75.0, remaining=13)
        self.assertEqual(feat_updated["current_consecutive_absences"], 2)
        self.assertLess(feat_updated["overall_attendance_pct"], 100.0)
        self.assertNotEqual(feat_initial["expected_final_attendance"], feat_updated["expected_final_attendance"])

    def test_11_data_leakage_and_chronological_feature_extraction(self):
        """
        Scenario 11: Data leakage prevention and strictly chronological feature extraction.
        Features extracted at session t=20 must ONLY use sessions 1..20 and must NOT be affected
        by sessions 21..40.
        """
        full_semester = [{"session": i, "status": "present" if i <= 20 else "absent"} for i in range(1, 41)]

        # Cut off history strictly at prediction cutoff session t=20
        observed_history = [r for r in full_semester if r["session"] <= 20]
        self.assertEqual(len(observed_history), 20)

        features_observed = extract_time_series_features(observed_history, threshold=75.0, remaining=20)
        self.assertEqual(features_observed["current_consecutive_absences"], 0)
        self.assertEqual(features_observed["overall_attendance_pct"], 100.0)
        self.assertEqual(features_observed["window_5"]["rate"], 1.0)
        # Ensure future absences did not leak into observed feature set
        self.assertEqual(features_observed["missed"], 0)


if __name__ == "__main__":
    unittest.main()
