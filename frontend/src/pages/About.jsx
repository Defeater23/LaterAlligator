import { useEffect, useState } from 'react';
import { loadMetrics, loadMethodology } from '../api/client';
import { useApp } from '../context/AppContext';

const FALLBACK_PIPELINE = [
  {
    step: 1,
    name: 'Data collection',
    detail:
      'Collect historical attendance records and class statistics (conducted, attended, remaining).',
  },
  {
    step: 2,
    name: 'Feature engineering',
    detail:
      'Calculate attendance %, absence frequency, recent trend, margin to threshold, and recovery ratio.',
  },
  {
    step: 3,
    name: 'Model training',
    detail:
      'Train a Random Forest classifier on labelled synthetic examples (Low / Moderate / High).',
  },
  {
    step: 4,
    name: 'Risk prediction',
    detail: 'Predict attendance risk for each subject from engineered features.',
  },
  {
    step: 5,
    name: 'Explainability',
    detail: 'Surface feature importance and human-readable factors behind each prediction.',
  },
  {
    step: 6,
    name: 'Early intervention',
    detail: 'Generate personalized alerts and recommendations for students and mentors.',
  },
  {
    step: 7,
    name: 'Evaluation',
    detail:
      'Use precision, recall, F1-score, and a confusion matrix on a held-out test set.',
  },
];

export default function About() {
  const { data } = useApp();
  const [metrics, setMetrics] = useState(null);
  const [methodology, setMethodology] = useState(null);

  useEffect(() => {
    loadMetrics().then(setMetrics);
    loadMethodology().then(setMethodology);
  }, []);

  const pipeline = methodology?.pipeline || FALLBACK_PIPELINE;
  const assumptions =
    methodology?.assumptions || [
      'Attending increases attended and conducted by 1; missing increases only conducted by 1.',
      'Remaining classes are known for the semester scenario.',
      'Default minimum attendance threshold is 75%.',
      'Training data is synthetic — not from a live college database.',
    ];
  const limitations =
    methodology?.limitations || [
      'Synthetic data cannot capture medical leave or policy exceptions.',
      'The model is not validated on real institutional records.',
      'What-if projections are deterministic math, not behavioural forecasts.',
    ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>About Project</h1>
          <p>
            LaterAlligator — AI-Based Academic Attendance Risk Prediction and Early Warning System
            (AISC academic prototype).
          </p>
        </div>
        <span className={`badge ${data.apiOnline ? 'info' : 'muted'}`}>
          {data.apiOnline ? 'ML API connected' : 'Frontend simulation mode'}
        </span>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2>Problem & solution</h2>
        <p className="muted" style={{ lineHeight: 1.55, marginTop: 0 }}>
          Students often discover falling attendance too late to recover. LaterAlligator turns
          passive attendance tracking into a predictive early-warning system: it estimates Low / Moderate /
          High risk, explains the drivers, and lets students simulate recovery plans before the
          semester ends.
        </p>
      </div>

      <div className="grid grid-2" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <h2>AI methodology pipeline</h2>
          <div className="pipeline">
            {pipeline.map((step) => (
              <div key={step.step} className="pipeline-step">
                <div className="step-num">{step.step}</div>
                <div>
                  <strong>{step.name}</strong>
                  <div className="muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                    {step.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Architecture</h2>
          <ul className="muted" style={{ lineHeight: 1.6, paddingLeft: '1.1rem' }}>
            <li>
              <strong>Frontend:</strong> React + Vite, Recharts, React Router
            </li>
            <li>
              <strong>Backend:</strong> FastAPI (Python)
            </li>
            <li>
              <strong>AI:</strong> Scikit-learn Random Forest classifier
            </li>
            <li>
              <strong>Data:</strong> Synthetic student/subject attendance records
            </li>
            <li>
              <strong>Fallback:</strong> Transparent rule-based engine if API is offline
            </li>
          </ul>

          <h3 style={{ marginTop: '1.2rem' }}>Assumptions</h3>
          <ul className="muted" style={{ lineHeight: 1.55, paddingLeft: '1.1rem' }}>
            {assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>

          <h3 style={{ marginTop: '1.2rem' }}>Limitations</h3>
          <ul className="muted" style={{ lineHeight: 1.55, paddingLeft: '1.1rem' }}>
            {limitations.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2>Model evaluation (synthetic hold-out set)</h2>
        {metrics ? (
          <>
            <div className="grid grid-4" style={{ marginBottom: '0.8rem' }}>
              <div className="compare-box">
                <div className="stat-label">Accuracy</div>
                <div className="stat-value" style={{ fontSize: '1.3rem' }}>
                  {(metrics.accuracy * 100).toFixed(1)}%
                </div>
              </div>
              <div className="compare-box">
                <div className="stat-label">Precision</div>
                <div className="stat-value" style={{ fontSize: '1.3rem' }}>
                  {(metrics.precision_weighted * 100).toFixed(1)}%
                </div>
              </div>
              <div className="compare-box">
                <div className="stat-label">Recall</div>
                <div className="stat-value" style={{ fontSize: '1.3rem' }}>
                  {(metrics.recall_weighted * 100).toFixed(1)}%
                </div>
              </div>
              <div className="compare-box">
                <div className="stat-label">F1-score</div>
                <div className="stat-value" style={{ fontSize: '1.3rem' }}>
                  {(metrics.f1_weighted * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            <p className="muted" style={{ fontSize: '0.88rem' }}>
              Algorithm: {metrics.algorithm} · Samples: {metrics.n_samples} (train{' '}
              {metrics.train_size} / test {metrics.test_size})
            </p>
            <h3>Feature importance</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Importance</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics.feature_importance || {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, imp]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{(imp * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <h3 style={{ marginTop: '1rem' }}>Confusion matrix</h3>
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>Pred Low</th>
                  <th>Pred Moderate</th>
                  <th>Pred High</th>
                </tr>
              </thead>
              <tbody>
                {['Actual Low', 'Actual Moderate', 'Actual High'].map((label, i) => (
                  <tr key={label}>
                    <td>{label}</td>
                    {(metrics.confusion_matrix?.[i] || []).map((v, j) => (
                      <td key={j}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="disclaimer">{metrics.notes}</p>
          </>
        ) : (
          <p className="empty-note">
            Start the FastAPI backend to load live training metrics. Evaluation concepts still
            apply: precision/recall/F1 and a confusion matrix quantify how well risk classes are
            separated on labelled examples.
          </p>
        )}
      </div>

      <div className="card">
        <h2>How to run</h2>
        <ol className="muted" style={{ lineHeight: 1.7 }}>
          <li>
            Backend: <code>cd backend</code> then{' '}
            <code>py -3.12 -m uvicorn main:app --reload --port 8000</code>
          </li>
          <li>
            Frontend: <code>cd frontend</code> then <code>npm run dev</code>
          </li>
          <li>Open the Vite URL (usually http://localhost:5173) — the dashboard loads first.</li>
        </ol>
        <p className="disclaimer">
          Demo tip: open Dashboard → select Data Structures (high risk) → Risk Analysis → What-If
          Simulator → adjust sliders → About Project for the AI pipeline.
        </p>
      </div>
    </div>
  );
}
