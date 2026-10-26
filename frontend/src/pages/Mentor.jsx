import { useApp } from '../context/AppContext';
import RiskBadge from '../components/RiskBadge';
import { RiskPieChart } from '../components/Charts';
import { formatPct } from '../utils/attendance';

export default function Mentor() {
  const { data, setSelectedSubjectId } = useApp();
  const { student, subjects, summary, cohort_summary, alerts } = data;

  const atRisk = subjects.filter((s) => s.prediction.risk !== 'Low');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Mentor View</h1>
          <p>
            Optional early-intervention view for {student.mentor}. Focus on subjects that need
            attention for {student.name}.
          </p>
        </div>
        <RiskBadge risk={summary.overall_risk} label={`Student: ${summary.overall_risk}`} />
      </div>

      <div className="grid grid-3" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <div className="stat-label">Student</div>
          <div className="stat-value" style={{ fontSize: '1.25rem' }}>
            {student.name}
          </div>
          <div className="stat-sub">{student.id}</div>
        </div>
        <div className="card">
          <div className="stat-label">Overall attendance</div>
          <div className="stat-value">{formatPct(summary.overall_attendance)}</div>
          <div className="stat-sub">Threshold {summary.threshold}%</div>
        </div>
        <div className="card">
          <div className="stat-label">Subjects needing attention</div>
          <div className="stat-value">{atRisk.length}</div>
          <div className="stat-sub">
            {summary.risk_counts.High} high · {summary.risk_counts.Moderate} moderate
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <h2>Priority intervention list</h2>
          {atRisk.length === 0 ? (
            <p className="empty-note">No moderate/high risk subjects right now.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>%</th>
                  <th>Risk</th>
                  <th>Suggested action</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map((s) => (
                  <tr
                    key={s.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedSubjectId(s.id)}
                  >
                    <td>{s.name}</td>
                    <td>{formatPct(s.prediction.current_attendance)}</td>
                    <td>
                      <RiskBadge risk={s.prediction.risk} />
                    </td>
                    <td style={{ maxWidth: 280, fontSize: '0.82rem' }}>
                      {s.prediction.recommendation}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Cohort risk snapshot (illustrative)</h2>
          {cohort_summary ? (
            <>
              <RiskPieChart
                riskCounts={{
                  Low: cohort_summary.low_risk,
                  Moderate: cohort_summary.moderate_risk,
                  High: cohort_summary.high_risk,
                }}
              />
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Sample mentor cohort of {cohort_summary.total_students} students — synthetic
                distribution for demonstration.
              </p>
            </>
          ) : (
            <p className="empty-note">No cohort data.</p>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Active early warnings</h2>
        <div className="alert-list">
          {alerts.map((a, i) => (
            <div key={i} className={`alert-item ${a.severity}`}>
              <div>
                <strong>{a.subject}</strong>
                <div style={{ marginTop: 4 }}>{a.message}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
