// src/pages/Home.jsx
import { useEffect, useState } from 'react';
import { useAuthUser } from '../auth/useAuthUser';
import { Navigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import LandingPage from './LandingPage';

export default function Home() {
  const user = useAuthUser();
  const [loggingOut, setLoggingOut] = useState(false);

  // Handle logout flag from sessionStorage
  useEffect(() => {
    const shouldLogout = sessionStorage.getItem('logout');
    if (shouldLogout) {
      sessionStorage.removeItem('logout');
      setLoggingOut(true);
      supabase.auth.signOut().finally(() => {
        setLoggingOut(false);
      });
    }
  }, []);

  // Show loading while logging out or checking auth
  if (loggingOut || user === null) {
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

  // User is logged in (and not logging out) - redirect to dashboard
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  // User is not logged in - show landing page
  return <LandingPage />;
}
