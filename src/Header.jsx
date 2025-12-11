import React, { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { supabase } from './supabase/supabaseClient';
import { useAuthUser } from './auth/useAuthUser';
import logo from '/bear_bull.jpg';
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
        <img src={logo} alt="Stockpile Logo" style={{ height: 70, width: 'auto', borderRadius: 8, objectFit: 'contain' }} />
        <nav className="header-nav">
          <NavLink to="/" className="nav-link">Dashboard</NavLink>
          <NavLink to="/leagues" className="nav-link">Leagues</NavLink>
          <NavLink to="/draft" className="nav-link">Draft</NavLink>
          <NavLink to="/portfolio" className="nav-link">Portfolio</NavLink>
          <NavLink to="/leaderboard" className="nav-link">Leaderboard</NavLink>
        </nav>
      </div>
      {user && (
        <div className="header-user">
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
    </header>
  );
};

export default Header;
