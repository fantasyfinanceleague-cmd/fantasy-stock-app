import React from 'react';
import { useParams, Link } from 'react-router-dom';

export default function LeagueDetail() {
  const { leagueId } = useParams();
  return (
    <div className="page">
      <h1 className="page-title">League Overview</h1>
      <p className="muted">League ID: {leagueId}</p>
      <div className="actions" style={{ marginTop: 12 }}>
        <Link className="btn" to="/leagues">← Back to Leagues</Link>
      </div>
    </div>
  );
}
