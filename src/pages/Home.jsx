// src/pages/Home.jsx
import { useAuthUser } from '../auth/useAuthUser';
import { Navigate } from 'react-router-dom';
import LandingPage from './LandingPage';

export default function Home() {
  const user = useAuthUser();

  // Still loading auth state
  if (user === null) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0b1120',
      }}>
        <div style={{ color: '#6b7280' }}>Loading...</div>
      </div>
    );
  }

  // User is logged in - redirect to dashboard
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  // User is not logged in - show landing page
  return <LandingPage />;
}
