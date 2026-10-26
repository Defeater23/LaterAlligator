import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';

const COLORS = {
  Low: '#1a7f4b',
  Moderate: '#b86e00',
  High: '#c62828',
  bar: '#3d5a80',
  line: '#1e3a5f',
  threshold: '#c62828',
};

export function SubjectBarChart({ subjects, threshold }) {
  const data = subjects.map((s) => ({
    name: s.name.replace('Artificial Intelligence', 'AI').replace('Software Engineering', 'SE').replace('Computer Networks', 'Networks').replace('Operating Systems', 'OS').replace('Data Structures', 'DS'),
    fullName: s.name,
    attendance: s.prediction.current_attendance,
    risk: s.prediction.risk,
  }));

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(v, _n, props) => [`${v}%`, props.payload.fullName]}
          />
          <ReferenceLine
            y={threshold}
            stroke={COLORS.threshold}
            strokeDasharray="4 4"
            label={{ value: `${threshold}% min`, fill: COLORS.threshold, fontSize: 11 }}
          />
          <Bar dataKey="attendance" radius={[6, 6, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.fullName} fill={COLORS[entry.risk] || COLORS.bar} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RiskPieChart({ riskCounts }) {
  const data = [
    { name: 'Low', value: riskCounts.Low || 0 },
    { name: 'Moderate', value: riskCounts.Moderate || 0 },
    { name: 'High', value: riskCounts.High || 0 },
  ].filter((d) => d.value > 0);

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={55}
            outerRadius={90}
            paddingAngle={3}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={COLORS[entry.name]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendChart({ subject }) {
  if (!subject) return <p className="empty-note">Select a subject to view trend.</p>;
  const data = (subject.weekly_trend || []).map((pct, i) => ({
    week: `W${i + 1}`,
    attendance: pct,
  }));

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="week" tick={{ fontSize: 12 }} />
          <YAxis domain={['dataMin - 3', 'dataMax + 3']} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v) => [`${v}%`, 'Attendance']} />
          <Line
            type="monotone"
            dataKey="attendance"
            stroke={COLORS.line}
            strokeWidth={2.5}
            dot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScenarioLineChart({ chart, threshold, highlight }) {
  if (!chart?.length) return null;
  return (
    <div className="chart-wrap tall">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="missed"
            tick={{ fontSize: 12 }}
            label={{ value: 'Classes missed (of remaining)', position: 'insideBottom', offset: -2, fontSize: 11 }}
          />
          <YAxis domain={[50, 100]} tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(v, _n, props) => [
              `${v}%`,
              `Attend ${props.payload.attended}, miss ${props.payload.missed}`,
            ]}
          />
          <ReferenceLine
            y={threshold}
            stroke={COLORS.threshold}
            strokeDasharray="4 4"
            label={{ value: 'Threshold', fill: COLORS.threshold, fontSize: 11 }}
          />
          {highlight != null && (
            <ReferenceLine
              x={highlight}
              stroke={COLORS.bar}
              strokeDasharray="3 3"
            />
          )}
          <Line
            type="monotone"
            dataKey="percentage"
            stroke={COLORS.bar}
            strokeWidth={2.5}
            dot={{ r: 3 }}
            name="Projected %"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScenarioCompareBars({ current, scenarios, threshold }) {
  const data = [
    { name: 'Current', value: current },
    { name: 'Attend all', value: scenarios.attend_all },
    { name: 'Miss next', value: scenarios.miss_next },
    { name: 'Miss 2', value: scenarios.miss_two },
    { name: 'Miss 3', value: scenarios.miss_three },
  ];

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis domain={[50, 100]} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v) => [`${v}%`, 'Attendance']} />
          <ReferenceLine y={threshold} stroke={COLORS.threshold} strokeDasharray="4 4" />
          <Bar dataKey="value" fill={COLORS.bar} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
