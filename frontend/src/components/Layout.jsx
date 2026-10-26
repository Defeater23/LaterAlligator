import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import { useApp } from '../context/AppContext';

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { loading, error, data } = useApp();

  return (
    <div className="app-shell">
      {open && <div className="backdrop" onClick={() => setOpen(false)} />}
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <main className="main">
        <button
          type="button"
          className="mobile-nav-toggle"
          onClick={() => setOpen(true)}
        >
          <Menu size={18} /> Menu
        </button>
        {error && <div className="card">Error: {error}</div>}
        {loading && !data && !error && (
          <div className="card">Loading attendance dashboard…</div>
        )}
        {data && !error && <Outlet />}
      </main>
    </div>
  );
}
