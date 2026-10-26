import RiskBadge from './RiskBadge';
import { formatPct } from '../utils/attendance';

export default function SubjectCard({ subject, selected, onSelect }) {
  const hasRecords = subject.has_records !== false && subject.conducted > 0;
  const pct = subject.prediction?.current_attendance;
  const risk = subject.prediction?.risk ?? 'Low';
  const missed = subject.conducted - subject.attended;
  const displayedPct = hasRecords
    ? subject.displayed_attendance || (pct != null ? `${Math.round(pct)}%` : formatPct(pct))
    : 'No attendance recorded';

  return (
    <div
      className={`card subject-card ${selected ? 'selected' : ''}`}
      onClick={() => onSelect?.(subject.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect?.(subject.id);
      }}
    >
      <div className="subject-card-top">
        <div>
          <div className="subject-name">{subject.name}</div>
          <div className="subject-code">{subject.code}</div>
        </div>
        {hasRecords ? (
          <RiskBadge risk={risk} />
        ) : (
          <span className="badge muted">No Records</span>
        )}
      </div>

      <div
        className="stat-value"
        style={{
          fontSize: hasRecords ? '1.45rem' : '1.05rem',
          color: hasRecords ? 'var(--navy-deep)' : 'var(--text-muted)',
          fontWeight: hasRecords ? 700 : 500,
        }}
      >
        {displayedPct}
        {hasRecords && pct != null && (
          <span style={{ fontSize: '0.8rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
            ({pct.toFixed(1)}%)
          </span>
        )}
      </div>

      <div className={`meter ${hasRecords ? risk.toLowerCase() : 'muted'}`}>
        <span
          style={{
            width: hasRecords && pct != null ? `${Math.min(pct, 100)}%` : '0%',
            background: !hasRecords ? 'transparent' : undefined,
          }}
        />
      </div>

      <div className="meta-row">
        <span>
          {subject.attended}/{subject.conducted} attended
        </span>
        <span>{hasRecords ? `${missed} missed` : 'No sessions held'}</span>
      </div>
      <div className="meta-row" style={{ marginTop: '0.35rem' }}>
        <span>{subject.remaining} remaining</span>
        <span>
          {hasRecords
            ? pct >= (subject.prediction?.threshold ?? 75)
              ? `Can miss up to ${subject.prediction?.max_missable ?? 0}`
              : `Need ${subject.prediction?.min_classes_to_threshold ?? 'N/A'} to recover`
            : 'Pending schedule'}
        </span>
      </div>
    </div>
  );
}
