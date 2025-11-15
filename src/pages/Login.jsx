import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import { useAuthUser } from '../auth/useAuthUser';

export default function Login() {
  const nav = useNavigate();
  const user = useAuthUser();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      nav('/', { replace: true });
    }
  }, [user, nav]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password: pw });
      setBusy(false);
      if (error) {
        setErr(error.message);
      } else {
        setErr('');
        alert('Account created! Please check your email to verify your account.');
        setIsSignUp(false);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      setBusy(false);
      if (error) {
        setErr(error.message);
      } else {
        nav('/', { replace: true });
      }
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: '20px'
    }}>
      <div className="card" style={{
        maxWidth: 450,
        width: '100%',
        padding: '40px',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h1 style={{
            fontSize: '2rem',
            fontWeight: 800,
            color: '#fff',
            marginBottom: '8px'
          }}>
            Fantasy Finance
          </h1>
          <p style={{ color: '#9ca3af', fontSize: '0.95rem' }}>
            {isSignUp ? 'Create your account to get started' : 'Sign in to manage your portfolio'}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              color: '#e5e7eb',
              fontSize: '0.9rem',
              fontWeight: 500
            }}>
              Email
            </label>
            <input
              className="modal-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              color: '#e5e7eb',
              fontSize: '0.9rem',
              fontWeight: 500
            }}>
              Password
            </label>
            <input
              className="modal-input"
              type="password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {err && (
            <div style={{
              padding: '12px',
              marginBottom: '20px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#f87171',
              fontSize: '0.9rem'
            }}>
              {err}
            </div>
          )}

          <button
            type="submit"
            className="modal-button btn-primary"
            disabled={busy}
            style={{
              width: '100%',
              padding: '14px',
              fontSize: '1rem',
              fontWeight: 600,
              marginBottom: '16px'
            }}
          >
            {busy ? 'Please wait...' : (isSignUp ? 'Create Account' : 'Sign In')}
          </button>

          <div style={{ textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setErr('');
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#60a5fa',
                cursor: 'pointer',
                fontSize: '0.9rem',
                textDecoration: 'underline'
              }}
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
