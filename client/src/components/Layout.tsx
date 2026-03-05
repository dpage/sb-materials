import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../App';
import { useHelp } from './HelpContext';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { open: openHelp, setTopic } = useHelp();
  const [menuOpen, setMenuOpen] = useState(false);

  // Set help topic based on current route
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith('/reports/')) {
      setTopic('report-edit');
    } else if (path === '/customers') {
      setTopic('customers');
    } else if (path === '/users') {
      setTopic('users');
    } else if (path === '/lookups') {
      setTopic('lookups');
    } else {
      setTopic('reports');
    }
  }, [location.pathname, setTopic]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    textDecoration: 'none',
    color: isActive ? '#fff' : 'rgba(255,255,255,0.8)',
    background: isActive ? 'rgba(255,255,255,0.15)' : 'transparent',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: isActive ? 600 : 400,
  });

  return (
    <div style={{ minHeight: '100vh' }}>
      <header
        style={{
          background: 'linear-gradient(135deg, #1a5276, #2980b9)',
          color: '#fff',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 56,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <NavLink to="/" style={{ color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 18 }}>
            SB Materials
          </NavLink>

          {/* Desktop nav */}
          <nav style={{ display: 'flex', gap: 4 }} className="desktop-nav">
            <NavLink to="/" end style={({ isActive }) => navStyle(isActive)}>
              Reports
            </NavLink>
            <NavLink to="/customers" style={({ isActive }) => navStyle(isActive)}>
              Customers
            </NavLink>
            <NavLink to="/lookups" style={({ isActive }) => navStyle(isActive)}>
              Lookups
            </NavLink>
            {user?.isSuperuser && (
              <NavLink to="/users" style={({ isActive }) => navStyle(isActive)}>
                Users
              </NavLink>
            )}
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, opacity: 0.9 }} className="desktop-nav">
            {user?.displayName}
          </span>
          <button
            onClick={handleLogout}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: '#fff',
              padding: '6px 14px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Logout
          </button>
          <button
            onClick={() => openHelp()}
            title="Help"
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: '#fff',
              width: 32,
              height: 32,
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 15,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ?
          </button>
          {/* Mobile menu toggle */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="mobile-menu-btn"
            style={{
              display: 'none',
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: 24,
              cursor: 'pointer',
            }}
          >
            ☰
          </button>
        </div>
      </header>

      {/* Mobile nav */}
      {menuOpen && (
        <nav
          style={{
            background: '#1a5276',
            padding: '8px 20px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            position: 'fixed',
            top: 56,
            left: 0,
            right: 0,
            zIndex: 99,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
          className="mobile-nav"
        >
          <NavLink to="/" end style={({ isActive }) => navStyle(isActive)} onClick={() => setMenuOpen(false)}>
            Reports
          </NavLink>
          <NavLink to="/customers" style={({ isActive }) => navStyle(isActive)} onClick={() => setMenuOpen(false)}>
            Customers
          </NavLink>
          <NavLink to="/lookups" style={({ isActive }) => navStyle(isActive)} onClick={() => setMenuOpen(false)}>
            Lookups
          </NavLink>
          {user?.isSuperuser && (
            <NavLink to="/users" style={({ isActive }) => navStyle(isActive)} onClick={() => setMenuOpen(false)}>
              Users
            </NavLink>
          )}
        </nav>
      )}

      <style>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: block !important; }
        }
        @media (min-width: 769px) {
          .mobile-nav { display: none !important; }
        }
      `}</style>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '20px' }}>
        <Outlet />
      </main>
    </div>
  );
}
