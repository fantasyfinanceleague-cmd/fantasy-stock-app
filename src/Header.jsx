import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { supabase } from './supabase/supabaseClient';
import { useAuthUser } from './auth/useAuthUser';
import logo from './assets/favicon.ico';
import './layout.css';

const Header = () => {
  const navigate = useNavigate();
  const user = useAuthUser();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await supabase.auth.signOut();
    setLoggingOut(false);
    navigate('/login', { replace: true });
  }

  return (
    <header className="header">
      <div className="header-left">
        <img src={logo} alt="Logo" className="logo" />
        <span className="app-title">Fantasy Finance</span>
      </div>
      <nav className="header-right">
        <NavLink to="/" className="nav-link">Dashboard</NavLink>
        <NavLink to="/leagues" className="nav-link">Leagues</NavLink>
        <NavLink to="/draft" className="nav-link">Draft</NavLink>
        <NavLink to="/portfolio" className="nav-link">Portfolio</NavLink>
        <NavLink to="/leaderboard" className="nav-link">Leaderboard</NavLink>
        {user && (
          <button
            className="logout-button"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? 'Logging out...' : 'Log Out'}
          </button>
        )}
        {user && (
          <div className="user-badge">
            <span className="user-icon">👤</span>
            <span className="user-email">{user.email}</span>
          </div>
        )}
      </nav>
    </header>
  );
};

export default Header;
