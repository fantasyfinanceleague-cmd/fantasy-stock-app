// src/App.jsx
import { Routes, Route } from "react-router-dom";
import Layout from "./Layout";
import Dashboard from "./pages/Dashboard";
import DraftPage from "./pages/DraftPage";
import Leagues from './pages/Leagues';
import LeagueDetail from './pages/LeagueDetail';
import { JoinLeague } from './pages/JoinLeague';
import './layout.css'; // custom grid and layout styles
// import './index.css'; // remove this if you're not using Tailwind at all

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/draft" element={<DraftPage />} />
        <Route path="/leagues" element={<Leagues />} />
        <Route path="/league/:leagueId" element={<LeagueDetail />} />
        <Route path="/join/:code" element={<JoinLeague />} />
      </Routes>
    </Layout>
  );
}

export default App;
