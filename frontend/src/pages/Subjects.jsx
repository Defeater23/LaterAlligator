import { useApp } from '../context/AppContext';
import RiskBadge from '../components/RiskBadge';
import { ScenarioCompareBars } from '../components/Charts';
import { formatPct } from '../utils/attendance';

export default function Subjects() {
  const { data, selectedSubjectId, setSelectedSubjectId, selectedSubject, threshold } =
    useApp();

  if (!selectedSubject) return null;
  const pred = selectedSubject.prediction;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Subjects</h1>
          <p>
            Detailed attendance, future projections, and recovery requirements for each course.
          </p>
        </div>
        <RiskBadge risk={pred.risk} />
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <label htmlFor="subject-select" style={{ fontWeight: 600, color: 'var(--navy)' }}>
          Select subject
        </label>
        <select
          id="subject-select"
          value={selectedSubjectId}
          onChange={(e) => setSelectedSubjectId(e.target.value)}
          style={{
            marginTop: '0.5rem',
            width: '100%',
            maxWidth: 420,
            padding: '0.55rem 0.7rem',
            borderRadius: 10,
            border: '1px solid var(--border)',
          }}
        >
          {data.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code}: {s.name}{' '}
              {s.conducted > 0
                ? `(${s.displayed_attendance || Math.round(s.prediction.current_attendance) + '%'}) — ${s.prediction.risk}`
                : '— No attendance recorded'}
            </option>
          ))}
        </select>
      </div>

      {!pred.has_records && selectedSubject.conducted === 0 ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', marginBottom: '1rem' }}>
          <h2 style={{ color: 'var(--navy-deep)', marginBottom: '0.5rem' }}>No attendance recorded for this subject</h2>
          <p className="muted" style={{ maxWidth: '60ch', margin: '0 auto 1rem' }}>
            {selectedSubject.code}: {selectedSubject.name} has no recorded classes yet. Attendance tracking and early warning risk predictions will activate once classroom sessions commence.
          </p>
          <div className="meta-row" style={{ maxWidth: 300, margin: '0 auto', justifyContent: 'center', gap: '1.5rem' }}>
            <span><strong>0</strong> attended</span>
            <span><strong>0</strong> conducted</span>
            <span><strong>{selectedSubject.remaining}</strong> remaining</span>
          </div>
        </div>
      ) : (
        <>

      <div className="grid grid-4" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <div className="stat-label">Current attendance</div>
          <div className="stat-value">{formatPct(pred.current_attendance)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Attended / Conducted</div>
          <div className="stat-value" style={{ fontSize: '1.35rem' }}>
            {selectedSubject.attended} / {selectedSubject.conducted}
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Remaining classes</div>
          <div className="stat-value">{selectedSubject.remaining}</div>
        </div>
        <div className="card">
          <div className="stat-label">
            {pred.current_attendance >= threshold ? 'Max safe absences' : `Min. to attend for ${threshold}%`}
          </div>
          <div className="stat-value">
            {pred.current_attendance >= threshold
              ? (pred.max_missable ?? 0)
              : (pred.min_classes_to_threshold == null ? '—' : pred.min_classes_to_threshold)}
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <h2>Future attendance scenarios</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Projected %</th>
                <th>vs {threshold}%</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Attend all remaining', pred.scenarios.attend_all],
                ['Miss the next class', pred.scenarios.miss_next],
                ['Miss two upcoming', pred.scenarios.miss_two],
                ['Miss three upcoming', pred.scenarios.miss_three],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{formatPct(value)}</td>
                  <td>
                    {value >= threshold ? (
                      <span className="badge low">Above</span>
                    ) : (
                      <span className="badge high">Below</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="disclaimer">
            Formula: (attended / conducted) × 100. Attending adds 1 to both counts; missing
            adds 1 only to conducted.
          </p>
        </div>
        <div className="card">
          <h2>Projected comparison</h2>
          <ScenarioCompareBars
            current={pred.current_attendance}
            scenarios={pred.scenarios}
            threshold={threshold}
          />
        </div>
      </div>

        <div className="card">
          <h2>Recommendation</h2>
          <div className="rec-box">{pred.recommendation}</div>
          <div className="disclaimer">{pred.disclaimer}</div>
        </div>
      </>
      )}
    </div>
  );
}
