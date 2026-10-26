# LaterAlligator — AI-Based Academic Attendance Risk Prediction and Early Warning System

AISC academic prototype that turns attendance tracking into a **predictive early-warning dashboard** for college students and mentors.

## What it does

- Shows overall and subject-wise attendance for a demo student (**Aarav Mehta**)
- Classifies each subject as **Low / Moderate / High** attendance risk
- Explains *why* the prediction was made (explainable AI section)
- Projects final attendance under attend/miss scenarios
- Interactive **What-If Simulator** with live charts and recommendations
- Generates data-driven early-warning alerts
- Documents the full AI methodology for evaluators

## Demo scenario (preloaded)

| Subject | Attendance | Intended risk |
|---------|------------|---------------|
| Data Structures | 72.0% (36/50) | **High** |
| Artificial Intelligence | 77.8% (42/54) | **Moderate** |
| Computer Networks | 87.0% (47/54) | Low |
| Operating Systems | 84.6% (44/52) | Low |
| Software Engineering | 90.7% (49/54) | Low |

Minimum required attendance defaults to **75%** (adjustable on the dashboard).

Suggested walkthrough:

1. Open **Dashboard** — review overall stats and alerts  
2. Select **Data Structures** (high risk)  
3. Open **Risk Analysis** — read factors and recommendation  
4. Open **What-If Simulator** — change attend/miss sliders  
5. Watch projected % and recommendation update immediately  
6. Open **About Project** — explain the AI pipeline to an evaluator  

## Architecture

```
frontend/   React + Vite + Recharts + React Router
backend/    FastAPI + Scikit-learn Random Forest
```

- **Actual ML predictions** come from a Random Forest trained on **synthetic** labelled attendance records.
- If the API is offline, the UI falls back to a **transparent rule-based simulation** and clearly labels it as such.
- What-if projections use the deterministic formula:  
  `Attendance % = (attended / conducted) × 100`  
  Attend → +1 attended and +1 conducted; Miss → +1 conducted only.

## How to run

### 1. Backend (Python 3.12+)

```bash
cd backend
py -3.12 -m pip install -r requirements.txt
py -3.12 train_model.py
py -3.12 -m uvicorn main:app --reload --port 8000
```

API docs: http://127.0.0.1:8000/docs

### 2. Frontend (Node 18+)

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:5173

The Vite dev server proxies `/api` to the FastAPI backend.

## AI methodology (summary)

1. **Data collection** — attendance counts, recent absence patterns, remaining classes  
2. **Feature engineering** — attendance %, margin to threshold, recent absence rate, projections, recovery ratio  
3. **Model training** — Random Forest on synthetic Low/Moderate/High labels  
4. **Risk prediction** — per-subject classification + probabilities  
5. **Explainability** — feature importance + human-readable factor cards  
6. **Early intervention** — alerts and “classes you must attend” guidance  
7. **Evaluation** — precision, recall, F1, confusion matrix on a held-out synthetic test set  

**Important:** Synthetic results are **illustrative** for the academic demo. They are **not** evidence of real-world predictive accuracy on institutional data.

## Assumptions & limitations

- Remaining classes for the semester are known and fixed in the demo  
- No authentication, cloud deployment, or production database  
- Medical leave / special cases are not modelled  
- What-if charts are mathematical projections, not behavioural ML forecasts  

## Project structure

```
backend/
  main.py              FastAPI routes
  train_model.py       Synthetic data + Random Forest training
  data/sample_student.json
  model/               Saved model + metrics
frontend/
  src/pages/           Dashboard, Subjects, Risk, Simulator, Mentor, About
  src/utils/           Attendance math + rule-based fallback
  src/api/client.js    API client with offline fallback
```
