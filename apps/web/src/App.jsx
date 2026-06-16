// src/App.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./Layout";
import Home from "./pages/Home";
import LandingPage from "./pages/LandingPage";
import Dashboard from "./pages/Dashboard";
import DraftPage from "./pages/DraftPage";
import Leagues from './pages/Leagues';
import LeagueDetail from './pages/LeagueDetail';
import { JoinLeague } from './pages/JoinLeague';
import PortfolioPage from './pages/PortfolioPage';
import Leaderboard from './pages/Leaderboard';
import Matchup from './pages/Matchup';
import TradeHistory from './pages/TradeHistory';
import Profile from './pages/Profile';
import Login from './pages/Login';
import Protected from './components/Protected';
import './layout.css'; // custom grid and layout styles
// import './index.css'; // remove this if you're not using Tailwind at all

// ── App pause switch ────────────────────────────────────────────────────────
// While APP_PAUSED is true, the marketing landing page is the ONLY reachable
// page. Every other path — /login, /signup, /dashboard, and all authenticated
// app routes — redirects to the landing page, so nothing in the app can be
// reached by typing a URL directly. The full app (all routes/components below)
// is preserved, just gated behind this flag.
//
// TO UN-PAUSE AND RESTORE THE FULL APP: set APP_PAUSED = false.
// (No other change needed — the complete route table is kept intact below.)
const APP_PAUSED = true;

function App() {
  // Paused: serve only the landing page; send every other path back to it.
  if (APP_PAUSED) {
    return (
      <Routes>
        {/* Render the landing page directly (not via Home, which would
            redirect a logged-in session into the dashboard). */}
        <Route path="/" element={<LandingPage />} />
        {/* Any other URL (/login, /signup, /dashboard, app routes, …) → landing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Login initialSignUp />} />

      {/* Protected routes */}
      <Route path="/dashboard" element={<Layout><Protected><Dashboard /></Protected></Layout>} />
      <Route path="/draft/:leagueId" element={<Layout><Protected><DraftPage /></Protected></Layout>} />
      <Route path="/draft" element={<Layout><Protected><DraftPage /></Protected></Layout>} />
      <Route path="/leagues" element={<Layout><Protected><Leagues /></Protected></Layout>} />
      <Route path="/league/:leagueId" element={<Layout><Protected><LeagueDetail /></Protected></Layout>} />
      <Route path="/join/:code" element={<Layout><Protected><JoinLeague /></Protected></Layout>} />
      <Route path="/portfolio" element={<Layout><Protected><PortfolioPage /></Protected></Layout>} />
      <Route path="/matchup" element={<Layout><Protected><Matchup /></Protected></Layout>} />
      <Route path="/leaderboard" element={<Layout><Protected><Leaderboard /></Protected></Layout>} />
      <Route path="/trade-history" element={<Layout><Protected><TradeHistory /></Protected></Layout>} />
      <Route path="/profile" element={<Layout><Protected><Profile /></Protected></Layout>} />
    </Routes>
  );
}

export default App;
