import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import { useAuthUser } from '../auth/useAuthUser';
import HCaptcha from '@hcaptcha/react-hcaptcha';

const HCAPTCHA_SITE_KEY = import.meta.env.VITE_HCAPTCHA_SITE_KEY;
const IS_LOCALHOST = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export default function Login() {
  const nav = useNavigate();
  const user = useAuthUser();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  const captchaRef = useRef(null);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      nav('/', { replace: true });
    }
  }, [user, nav]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');

    // Validate captcha for sign up (skip on localhost)
    if (isSignUp && !IS_LOCALHOST && !captchaToken) {
      setErr('Please complete the captcha verification');
      return;
    }

    setBusy(true);

    if (isSignUp) {
      const signUpOptions = {
        email,
        password: pw,
      };

      // Only include captcha token if not on localhost and token exists
      if (!IS_LOCALHOST && captchaToken) {
        signUpOptions.options = {
          captchaToken: captchaToken
        };
      }

      const { error } = await supabase.auth.signUp(signUpOptions);
      setBusy(false);

      // Reset captcha after attempt
      if (captchaRef.current) {
        captchaRef.current.resetCaptcha();
        setCaptchaToken(null);
      }

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
            <div style={{ position: 'relative' }}>
              <input
                className="modal-input"
                type={showPassword ? 'text' : 'password'}
                value={pw}
                onChange={e => setPw(e.target.value)}
                placeholder="••••••••"
                required
                style={{ paddingRight: '45px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: '#9ca3af',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.2rem',
                  transition: 'color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#e5e7eb'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#9ca3af'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  // Eye slash icon (hidden)
                  <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  // Eye icon (visible)
                  <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
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

          {/* Show hCaptcha only for sign up and not on localhost */}
          {isSignUp && !IS_LOCALHOST && HCAPTCHA_SITE_KEY && HCAPTCHA_SITE_KEY !== 'YOUR_SITE_KEY_HERE' && (
            <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'center' }}>
              <HCaptcha
                ref={captchaRef}
                sitekey={HCAPTCHA_SITE_KEY}
                onVerify={(token) => setCaptchaToken(token)}
                onExpire={() => setCaptchaToken(null)}
                onError={() => {
                  setErr('Captcha error. Please try again.');
                  setCaptchaToken(null);
                }}
                theme="dark"
              />
            </div>
          )}

          {/* Show dev notice on localhost */}
          {isSignUp && IS_LOCALHOST && (
            <div style={{
              padding: '12px',
              marginBottom: '20px',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '8px',
              color: '#60a5fa',
              fontSize: '0.85rem',
              textAlign: 'center'
            }}>
              ℹ️ Development mode: hCaptcha disabled on localhost
            </div>
          )}

          <button
            type="submit"
            className="modal-button btn-primary"
            disabled={busy || (isSignUp && !IS_LOCALHOST && !captchaToken)}
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
                // Reset captcha when switching modes
                if (captchaRef.current) {
                  captchaRef.current.resetCaptcha();
                  setCaptchaToken(null);
                }
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
