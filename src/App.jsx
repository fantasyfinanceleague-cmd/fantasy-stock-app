// src/App.jsx
import { Routes, Route } from "react-router-dom";
import Layout from "./Layout";
import Dashboard from "./pages/Dashboard";
import DraftPage from "./pages/DraftPage";
import Leagues from './pages/Leagues';
import LeagueDetail from './pages/LeagueDetail';
import { JoinLeague } from './pages/JoinLeague';
import PortfolioPage from './pages/PortfolioPage';
import Leaderboard from './pages/Leaderboard';
import Login from './pages/Login';
import Protected from './components/Protected';
import './layout.css'; // custom grid and layout styles
// import './index.css'; // remove this if you're not using Tailwind at all

function App() {
  return (
    <Routes>
      {/* Public route */}
      <Route path="/login" element={<Login />} />

      {/* Protected routes */}
      <Route path="/" element={<Layout><Protected><Dashboard /></Protected></Layout>} />
      <Route path="/dashboard" element={<Layout><Protected><Dashboard /></Protected></Layout>} />
      <Route path="/draft/:leagueId" element={<Layout><Protected><DraftPage /></Protected></Layout>} />
      <Route path="/draft" element={<Layout><Protected><DraftPage /></Protected></Layout>} />
      <Route path="/leagues" element={<Layout><Protected><Leagues /></Protected></Layout>} />
      <Route path="/league/:leagueId" element={<Layout><Protected><LeagueDetail /></Protected></Layout>} />
      <Route path="/join/:code" element={<Layout><Protected><JoinLeague /></Protected></Layout>} />
      <Route path="/portfolio" element={<Layout><Protected><PortfolioPage /></Protected></Layout>} />
      <Route path="/leaderboard" element={<Layout><Protected><Leaderboard /></Protected></Layout>} />
    </Routes>
  );
}

export default App;
