import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  BookOpen,
  ShieldAlert,
  SlidersHorizontal,
  Info,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/subjects', label: 'Subjects', icon: BookOpen },
  { to: '/risk', label: 'Risk Analysis', icon: ShieldAlert },
  { to: '/simulator', label: 'What-If Simulator', icon: SlidersHorizontal },
  { to: '/about', label: 'About Project', icon: Info },
];

export default function Sidebar({ open, onClose }) {
  const { data } = useApp();
  const studentName = data?.student?.name ?? 'Krrish Gupta';

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand">
        <div className="brand-mark">AISC Prototype</div>
        <div className="brand-title">LaterAlligator</div>
      </div>
      <nav className="nav-list">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={onClose}
          >
            <Icon size={18} strokeWidth={2} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-foot">
        LaterAlligator · Attendance Risk Early Warning
        <br />
        Student: {studentName}
      </div>
    </aside>
  );
}
