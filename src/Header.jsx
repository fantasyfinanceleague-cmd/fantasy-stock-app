import React from 'react';
import { NavLink } from 'react-router-dom';
import logo from './assets/favicon.ico';
import './layout.css';

const Header = () => {
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
        <button className="logout-button">Log Out</button>
      </nav>
    </header>
  );
};

export default Header;
