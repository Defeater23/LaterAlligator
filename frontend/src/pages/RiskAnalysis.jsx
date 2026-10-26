import { useApp } from '../context/AppContext';
import RiskBadge from '../components/RiskBadge';
import { formatPct } from '../utils/attendance';

export default function RiskAnalysis() {
  const { data, selectedSubjectId, setSelectedSubjectId, selectedSubject, threshold } =
    useApp();

  if (!selectedSubject) return null;
  const pred = selectedSubject.prediction;
  const probs = pred.probabilities;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Risk Analysis</h1>
          <p>
            AI risk classification with plain-English explanations of the factors behind each
            prediction.
          </p>
        </div>
        <div className="badge-row">
          <RiskBadge risk={pred.risk} />
          <span className="badge muted">
            {pred.prediction_type === 'trained_model'
              ? 'Actual trained model'
              : 'Simulated (rule-based)'}
          </span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="controls">
          <div className="control">
            <label htmlFor="risk-subject">Subject under analysis</label>
            <select
              id="risk-subject"
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
            >
              {data.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.prediction.risk} ({formatPct(s.prediction.current_attendance)})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <div className="stat-label">Predicted risk</div>
          <div className="stat-value" style={{ fontSize: '1.4rem' }}>
            {pred.risk}
          </div>
          <div className="stat-sub">{pred.model}</div>
        </div>
        <div className="card">
          <div className="stat-label">Current attendance</div>
          <div className="stat-value">{formatPct(pred.current_attendance)}</div>
          <div className="stat-sub">Threshold {threshold}%</div>
        </div>
        <div className="card">
          <div className="stat-label">Margin to threshold</div>
          <div className="stat-value">
            {(pred.features.margin_to_threshold >= 0 ? '+' : '') +
              Number(pred.features.margin_to_threshold).toFixed(1)}
          </div>
          <div className="stat-sub">percentage points</div>
        </div>
      </div>

      {probs && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2>Model class probabilities</h2>
          <div className="grid grid-3">
            {['Low', 'Moderate', 'High'].map((label) => (
              <div key={label} className="compare-box">
                <div className="stat-label">{label}</div>
                <div className="stat-value" style={{ fontSize: '1.3rem' }}>
                  {probs[label] != null ? `${(probs[label] * 100).toFixed(1)}%` : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-2" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <h2>Why did the AI make this prediction?</h2>
          <div className="factor-list">
            {pred.factors.map((f) => (
              <div key={f.factor} className={`factor-item ${f.impact}`}>
                <div className="factor-title">{f.factor}</div>
                <div className="factor-detail">{f.detail}</div>
              </div>
            ))}
          </div>
          <p className="disclaimer">{pred.disclaimer}</p>
        </div>
        <div className="card">
          <h2>Key engineered features</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Attendance %</td>
                <td>{Number(pred.features.attendance_pct).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Margin to threshold</td>
                <td>{Number(pred.features.margin_to_threshold).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Recent absence rate</td>
                <td>{(Number(pred.features.recent_absence_rate) * 100).toFixed(0)}%</td>
              </tr>
              <tr>
                <td>Remaining classes</td>
                <td>{pred.features.remaining_classes}</td>
              </tr>
              <tr>
                <td>Projected if attend all</td>
                <td>{Number(pred.features.projected_if_attend_all).toFixed(2)}%</td>
              </tr>
              <tr>
                <td>Projected if miss next</td>
                <td>{Number(pred.features.projected_if_miss_next).toFixed(2)}%</td>
              </tr>
              <tr>
                <td>Recovery ratio</td>
                <td>{Number(pred.features.recovery_ratio).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          <div className="rec-box" style={{ marginTop: '0.9rem' }}>
            {pred.recommendation}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>All subjects at a glance</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Attendance</th>
              <th>Risk</th>
              <th>Must attend</th>
            </tr>
          </thead>
          <tbody>
            {data.subjects.map((s) => (
              <tr
                key={s.id}
                style={{
                  cursor: 'pointer',
                  background: s.id === selectedSubjectId ? 'var(--bg-soft)' : undefined,
                }}
                onClick={() => setSelectedSubjectId(s.id)}
              >
                <td>{s.name}</td>
                <td>{formatPct(s.prediction.current_attendance)}</td>
                <td>
                  <RiskBadge risk={s.prediction.risk} />
                </td>
                <td>
                  {s.prediction.min_classes_to_threshold == null
                    ? 'Cannot recover with remaining'
                    : `${s.prediction.min_classes_to_threshold} of ${s.remaining}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
