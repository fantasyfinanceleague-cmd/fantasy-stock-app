import React, { useState, useEffect, useRef } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabase/supabaseClient';
import { useAuthUser } from './auth/useAuthUser';
import { useHelp } from './context/HelpContext';
import logo from '/bear_bull.jpg';
import './layout.css';

// Navigation icons as SVG components
const NavIcons = {
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  leagues: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  ),
  draft: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" />
    </svg>
  ),
  portfolio: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" />
    </svg>
  ),
  leaderboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" /><rect width="4" height="12" x="8" y="8" /><rect width="4" height="8" x="14" y="12" /><rect width="4" height="16" x="2" y="4" /><path d="M22 20H2" />
    </svg>
  ),
  plus: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" /><path d="M5 12h14" />
    </svg>
  ),
};

const Header = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthUser();
  const { openWalkthrough } = useHelp();
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const quickActionsRef = useRef(null);

  // Close mobile menu and quick actions on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    setQuickActionsOpen(false);
  }, [location.pathname]);

  // Close mobile menu on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Close quick actions dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (quickActionsRef.current && !quickActionsRef.current.contains(e.target)) {
        setQuickActionsOpen(false);
      }
    };
    if (quickActionsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [quickActionsOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    await supabase.auth.signOut();
    setLoggingOut(false);
    setMobileMenuOpen(false);
    navigate('/login', { replace: true });
  }

  return (
    <header className="header">
      <div className="header-left">
        <Link to="/" className="header-logo-link">
          <img src={logo} alt="Stockpile Logo" className="header-logo-img" />
        </Link>
        <nav className="header-nav desktop-nav">
          <NavLink to="/" className={({ isActive }) => `nav-link-icon ${isActive ? 'active' : ''}`} end>
            {NavIcons.dashboard}
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/leagues" className={({ isActive }) => `nav-link-icon ${isActive ? 'active' : ''}`}>
            {NavIcons.leagues}
            <span>Leagues</span>
          </NavLink>
          <NavLink to="/draft" className={({ isActive }) => `nav-link-icon ${isActive ? 'active' : ''}`}>
            {NavIcons.draft}
            <span>Draft</span>
          </NavLink>
          <NavLink to="/portfolio" className={({ isActive }) => `nav-link-icon ${isActive ? 'active' : ''}`}>
            {NavIcons.portfolio}
            <span>Portfolio</span>
          </NavLink>
          <NavLink to="/leaderboard" className={({ isActive }) => `nav-link-icon ${isActive ? 'active' : ''}`}>
            {NavIcons.leaderboard}
            <span>Leaderboard</span>
          </NavLink>
        </nav>
      </div>

      {/* Desktop user section */}
      {user && (
        <div className="header-user desktop-nav">
          {/* Quick Actions dropdown */}
          <div ref={quickActionsRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setQuickActionsOpen(!quickActionsOpen)}
              className="quick-actions-btn"
              title="Quick Actions"
              style={{
                background: quickActionsOpen ? 'rgba(34, 197, 94, 0.25)' : 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: '50%',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#22c55e',
                transition: 'all 0.2s',
              }}
            >
              {NavIcons.plus}
            </button>
            {quickActionsOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  background: '#1a1f2e',
                  border: '1px solid #2a3040',
                  borderRadius: 10,
                  padding: 8,
                  minWidth: 180,
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                  zIndex: 100,
                }}
              >
                <button
                  onClick={() => { navigate('/portfolio'); setQuickActionsOpen(false); }}
                  className="quick-action-item"
                >
                  📈 New Trade
                </button>
                <button
                  onClick={() => { navigate('/leagues'); setQuickActionsOpen(false); }}
                  className="quick-action-item"
                >
                  🏆 Create League
                </button>
                <button
                  onClick={() => { navigate('/leagues'); setQuickActionsOpen(false); }}
                  className="quick-action-item"
                >
                  ✉️ Invite Friend
                </button>
              </div>
            )}
          </div>

          {/* Help button */}
          <button
            onClick={openWalkthrough}
            className="help-button"
            title="Help & Guide"
            style={{
              background: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '50%',
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#60a5fa',
              fontSize: 16,
              fontWeight: 700,
              transition: 'all 0.2s',
            }}
          >
            ?
          </button>
          <Link to="/profile" className="user-badge">
            <span className="user-icon">👤</span>
            <span className="user-email">{user.email}</span>
          </Link>
          <button
            className="logout-button"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? 'Logging out...' : 'Log Out'}
          </button>
        </div>
      )}

      {/* Mobile hamburger button */}
      <button
        className="mobile-menu-btn"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label="Toggle menu"
      >
        {mobileMenuOpen ? (
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMobileMenuOpen(false)}>
          <nav className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <NavLink to="/" className={({ isActive }) => `mobile-nav-link-icon ${isActive ? 'active' : ''}`} end>
              {NavIcons.dashboard}
              <span>Dashboard</span>
            </NavLink>
            <NavLink to="/leagues" className={({ isActive }) => `mobile-nav-link-icon ${isActive ? 'active' : ''}`}>
              {NavIcons.leagues}
              <span>Leagues</span>
            </NavLink>
            <NavLink to="/draft" className={({ isActive }) => `mobile-nav-link-icon ${isActive ? 'active' : ''}`}>
              {NavIcons.draft}
              <span>Draft</span>
            </NavLink>
            <NavLink to="/portfolio" className={({ isActive }) => `mobile-nav-link-icon ${isActive ? 'active' : ''}`}>
              {NavIcons.portfolio}
              <span>Portfolio</span>
            </NavLink>
            <NavLink to="/leaderboard" className={({ isActive }) => `mobile-nav-link-icon ${isActive ? 'active' : ''}`}>
              {NavIcons.leaderboard}
              <span>Leaderboard</span>
            </NavLink>

            {user && (
              <>
                <div className="mobile-menu-divider" />
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openWalkthrough();
                  }}
                  className="mobile-nav-link-icon"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 18 }}>❓</span>
                  <span>Help & Guide</span>
                </button>
                <Link to="/profile" className="mobile-nav-link-icon">
                  <span style={{ fontSize: 18 }}>👤</span>
                  <span>Profile</span>
                </Link>
                <button
                  className="mobile-logout-btn"
                  onClick={handleLogout}
                  disabled={loggingOut}
                >
                  {loggingOut ? 'Logging out...' : 'Log Out'}
                </button>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
