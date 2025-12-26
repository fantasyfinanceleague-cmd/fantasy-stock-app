import React, { useState, useEffect } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabase/supabaseClient';
import { useAuthUser } from './auth/useAuthUser';
import { useHelp } from './context/HelpContext';
import logo from '/bear_bull.jpg';
import './layout.css';

const Header = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthUser();
  const { openWalkthrough } = useHelp();
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
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
          <NavLink to="/" className="nav-link">Dashboard</NavLink>
          <NavLink to="/leagues" className="nav-link">Leagues</NavLink>
          <NavLink to="/draft" className="nav-link">Draft</NavLink>
          <NavLink to="/portfolio" className="nav-link">Portfolio</NavLink>
          <NavLink to="/leaderboard" className="nav-link">Leaderboard</NavLink>
        </nav>
      </div>

      {/* Desktop user section */}
      {user && (
        <div className="header-user desktop-nav">
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
            onMouseEnter={(e) => {
              e.target.style.background = 'rgba(59, 130, 246, 0.25)';
              e.target.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'rgba(59, 130, 246, 0.15)';
              e.target.style.transform = 'scale(1)';
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
            <NavLink to="/" className="mobile-nav-link">Dashboard</NavLink>
            <NavLink to="/leagues" className="mobile-nav-link">Leagues</NavLink>
            <NavLink to="/draft" className="mobile-nav-link">Draft</NavLink>
            <NavLink to="/portfolio" className="mobile-nav-link">Portfolio</NavLink>
            <NavLink to="/leaderboard" className="mobile-nav-link">Leaderboard</NavLink>

            {user && (
              <>
                <div className="mobile-menu-divider" />
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openWalkthrough();
                  }}
                  className="mobile-nav-link"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  ❓ Help & Guide
                </button>
                <Link to="/profile" className="mobile-nav-link">
                  👤 Profile ({user.email})
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
