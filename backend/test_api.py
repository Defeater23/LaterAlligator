"""
Integration test for FastAPI backend routes.
Validates all endpoints, responses, data structures, and edge cases.
"""

import unittest
from fastapi.testclient import TestClient
from main import app


class TestBackendAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health(self):
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "ok")
        self.assertTrue(res.json()["model_loaded"])

    def test_student_dashboard(self):
        res = self.client.get("/api/student")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("student", data)
        self.assertIn("subjects", data)
        self.assertIn("summary", data)
        self.assertIn("alerts", data)

        # Verify Krrish Gupta preloaded subjects
        self.assertEqual(data["student"]["name"], "Krrish Gupta")
        self.assertEqual(len(data["subjects"]), 9)
        subjects = {s["id"]: s for s in data["subjects"]}
        self.assertIn("cse3101", subjects)
        self.assertIn("cse3102", subjects)
        self.assertIn("cse3121", subjects)
        self.assertIn("cse3131", subjects)
        self.assertIn("cse3132", subjects)
        self.assertIn("cse3142", subjects)
        self.assertIn("cse3147", subjects)
        self.assertIn("cse3170", subjects)
        self.assertIn("fad0051", subjects)

        # Android App Development verification
        android = subjects["cse3142"]
        self.assertEqual(android["attended"], 18)
        self.assertEqual(android["conducted"], 26)
        self.assertEqual(android["absent"], 8)
        self.assertAlmostEqual(android["prediction"]["current_attendance"], 69.23, places=1)

        # Zero-class subject verification
        pbl = subjects["cse3170"]
        self.assertFalse(pbl.get("has_records", True))
        self.assertIsNone(pbl["prediction"]["current_attendance"])
        self.assertEqual(pbl["prediction"]["displayed_attendance"], "No attendance recorded")

        # Summary checks
        summary = data["summary"]
        self.assertEqual(summary["total_attended"], 152)
        self.assertEqual(summary["total_conducted"], 193)
        self.assertEqual(summary["total_missed"], 41)
        self.assertAlmostEqual(summary["overall_attendance"], 78.76, places=1)
        self.assertEqual(summary["compliance_status"], "Compliant")  # 78.76% >= 75%

    def test_predict_endpoint(self):
        # High risk subject below threshold
        req_body = {
            "attended": 36,
            "conducted": 50,
            "remaining": 14,
            "threshold": 75.0,
            "recent_pattern": ["A", "M", "M", "A", "M"],
            "weekly_trend": [78, 76, 74, 73, 72, 72],
        }
        res = self.client.post("/api/predict", json=req_body)
        self.assertEqual(res.status_code, 200)
        pred = res.json()
        self.assertEqual(pred["risk"], "High")
        self.assertEqual(pred["current_attendance"], 72.0)
        self.assertEqual(pred["compliance_status"], "Non-Compliant")
        self.assertTrue(pred["can_recover"])
        self.assertEqual(pred["min_classes_to_threshold"], 6)
        self.assertEqual(pred["min_remaining_to_attend"], 12)
        self.assertEqual(pred["max_missable"], 2)
        self.assertIn("Low", pred["probabilities"])
        self.assertIn("Moderate", pred["probabilities"])
        self.assertIn("High", pred["probabilities"])

    def test_simulate_endpoint(self):
        # Simulate Aarav Data Structures with attend=12, miss=2
        req_body = {
            "attended": 36,
            "conducted": 50,
            "remaining": 14,
            "threshold": 75.0,
            "attend": 12,
            "miss": 2,
        }
        res = self.client.post("/api/simulate", json=req_body)
        self.assertEqual(res.status_code, 200)
        sim = res.json()
        self.assertEqual(sim["projected_attendance"], 75.0)
        self.assertTrue(sim["above_threshold"])
        self.assertEqual(sim["unused_remaining"], 0)
        self.assertEqual(len(sim["scenario_chart"]), 15)

    def test_metrics_endpoint(self):
        res = self.client.get("/api/metrics")
        self.assertEqual(res.status_code, 200)
        metrics = res.json()
        self.assertIn("accuracy", metrics)
        self.assertIn("f1_weighted", metrics)
        self.assertIn("confusion_matrix", metrics)
        self.assertIn("feature_importance", metrics)

    def test_methodology_endpoint(self):
        res = self.client.get("/api/methodology")
        self.assertEqual(res.status_code, 200)
        meth = res.json()
        self.assertIn("pipeline", meth)
        self.assertIn("assumptions", meth)
        self.assertIn("limitations", meth)


if __name__ == "__main__":
    unittest.main()
