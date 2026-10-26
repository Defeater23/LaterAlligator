import { useApp } from '../context/AppContext';
import RiskBadge from '../components/RiskBadge';
import SubjectCard from '../components/SubjectCard';
import {
  RiskPieChart,
  SubjectBarChart,
  TrendChart,
} from '../components/Charts';
import { formatPct } from '../utils/attendance';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

function AlertIcon({ severity }) {
  if (severity === 'critical') return <AlertTriangle size={18} color="#c62828" />;
  if (severity === 'warning' || severity === 'action')
    return <AlertTriangle size={18} color="#b86e00" />;
  return <Info size={18} color="#2f5d9f" />;
}

export default function Dashboard() {
  const {
    data,
    threshold,
    updateThreshold,
    selectedSubjectId,
    setSelectedSubjectId,
    selectedSubject,
  } = useApp();

  const { student, summary, subjects, alerts, prediction_type, apiOnline } = data;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Attendance Dashboard</h1>
          <p>
            {student.name} · {student.program} · Year {student.year}, Semester{' '}
            {student.semester}
          </p>
        </div>
        <div className="badge-row">
          <RiskBadge risk={summary.overall_risk} label={`Overall: ${summary.overall_risk}`} />
          <span className={`badge ${apiOnline ? 'info' : 'muted'}`}>
            {prediction_type === 'trained_model'
              ? 'Trained Random Forest'
              : 'Rule-based simulation'}
          </span>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <div className="stat-label">Overall attendance</div>
          <div className="stat-value">{formatPct(summary.overall_attendance)}</div>
          <div className="stat-sub">Across all enrolled subjects</div>
        </div>
        <div className="card">
          <div className="stat-label">Classes attended</div>
          <div className="stat-value">{summary.total_attended}</div>
          <div className="stat-sub">of {summary.total_conducted} conducted</div>
        </div>
        <div className="card">
          <div className="stat-label">Classes missed</div>
          <div className="stat-value">{summary.total_missed}</div>
          <div className="stat-sub">{summary.total_remaining} still remaining</div>
        </div>
        <div className="card">
          <div className="stat-label">Minimum required</div>
          <div className="stat-value">{threshold}%</div>
          <div className="control" style={{ marginTop: '0.5rem' }}>
            <input
              type="range"
              min={60}
              max={85}
              step={1}
              value={threshold}
              onChange={(e) => updateThreshold(e.target.value)}
              aria-label="Required attendance threshold"
            />
            <div className="control-value">Drag to adjust college threshold</div>
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <h2>Early warning alerts</h2>
          <div className="alert-list">
            {alerts.length === 0 && (
              <div className="alert-item info">
                <CheckCircle2 size={18} color="#1a7f4b" />
                <div>No urgent alerts — keep maintaining consistent attendance.</div>
              </div>
            )}
            {alerts.slice(0, 5).map((alert, idx) => (
              <div key={`${alert.subject}-${idx}`} className={`alert-item ${alert.severity}`}>
                <AlertIcon severity={alert.severity} />
                <div>{alert.message}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2>Subject-wise attendance</h2>
          <SubjectBarChart subjects={subjects} threshold={threshold} />
        </div>
      </div>

      <h2 style={{ color: 'var(--navy)', fontSize: '1.05rem', margin: '0.4rem 0 0.8rem' }}>
        Subjects — select one to inspect risk
      </h2>
      <div className="grid grid-3" style={{ marginBottom: '1rem' }}>
        {subjects.map((s) => (
          <SubjectCard
            key={s.id}
            subject={s}
            selected={s.id === selectedSubjectId}
            onSelect={setSelectedSubjectId}
          />
        ))}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Risk distribution (your subjects)</h2>
          <RiskPieChart riskCounts={summary.risk_counts} />
        </div>
        <div className="card">
          <h2>
            Attendance trend — {selectedSubject?.name || 'Subject'}
          </h2>
          <TrendChart subject={selectedSubject} />
        </div>
      </div>

      <p className="disclaimer">
        Predictions use {prediction_type === 'trained_model'
          ? 'a Random Forest classifier trained on synthetic attendance records'
          : 'transparent rule-based heuristics (API offline)'}.
        Results are illustrative for this AISC academic prototype and are not evidence of
        real-world predictive accuracy.
      </p>
    </div>
  );
}
