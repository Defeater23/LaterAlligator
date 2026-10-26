export default function RiskBadge({ risk, label }) {
  const key = String(risk || '').toLowerCase();
  const text = label || `${risk || 'Unknown'} risk`;
  return <span className={`badge ${key}`}>{text}</span>;
}
