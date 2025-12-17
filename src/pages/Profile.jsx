import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import { useAuthUser } from '../auth/useAuthUser';
import '../layout.css';

export default function Profile() {
  const navigate = useNavigate();
  const user = useAuthUser();

  // Username state
  const [username, setUsername] = useState('');
  const [originalUsername, setOriginalUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameSuccess, setUsernameSuccess] = useState('');
  const [updatingUsername, setUpdatingUsername] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // Alpaca credentials state
  const [alpacaKeyId, setAlpacaKeyId] = useState('');
  const [alpacaSecret, setAlpacaSecret] = useState('');
  const [alpacaError, setAlpacaError] = useState('');
  const [alpacaSuccess, setAlpacaSuccess] = useState('');
  const [savingAlpaca, setSavingAlpaca] = useState(false);
  const [hasAlpacaLinked, setHasAlpacaLinked] = useState(false);
  const [loadingAlpaca, setLoadingAlpaca] = useState(true);
  const [showAlpacaForm, setShowAlpacaForm] = useState(false);
  const [showAlpacaHelp, setShowAlpacaHelp] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null); // { ok: bool, message: string }

  // Load existing profile
  useEffect(() => {
    if (!user?.id) {
      setLoadingProfile(false);
      return;
    }

    async function loadProfile() {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('username')
        .eq('id', user.id)
        .single();

      if (!error && data) {
        setUsername(data.username || '');
        setOriginalUsername(data.username || '');
      }
      setLoadingProfile(false);
    }

    loadProfile();
  }, [user?.id]);

  // Check if Alpaca account is linked
  useEffect(() => {
    if (!user?.id) {
      setLoadingAlpaca(false);
      return;
    }

    async function checkAlpacaLink() {
      const { data, error } = await supabase
        .from('broker_credentials')
        .select('key_id')
        .eq('user_id', user.id)
        .eq('broker', 'alpaca')
        .single();

      if (!error && data) {
        setHasAlpacaLinked(true);
      }
      setLoadingAlpaca(false);
    }

    checkAlpacaLink();
  }, [user?.id]);

  async function handleAlpacaSave(e) {
    e.preventDefault();
    setAlpacaError('');
    setAlpacaSuccess('');

    const trimmedKeyId = alpacaKeyId.trim();
    const trimmedSecret = alpacaSecret.trim();

    if (!trimmedKeyId || !trimmedSecret) {
      setAlpacaError('Both API Key ID and Secret Key are required');
      return;
    }

    // Basic validation for Alpaca key format
    if (trimmedKeyId.length < 10) {
      setAlpacaError('API Key ID appears to be invalid');
      return;
    }

    if (trimmedSecret.length < 20) {
      setAlpacaError('Secret Key appears to be invalid');
      return;
    }

    setSavingAlpaca(true);
    setAlpacaSuccess('Verifying credentials with Alpaca...');

    try {
      const { data, error } = await supabase.functions.invoke('save-broker-keys', {
        body: {
          key_id: trimmedKeyId,
          secret: trimmedSecret
        }
      });

      if (error) throw error;

      // Handle validation errors from the server
      if (data?.error === 'invalid_credentials') {
        setAlpacaError(data.message || 'Invalid credentials. Please check your API keys.');
        setAlpacaSuccess('');
        return;
      }

      if (data?.error) {
        throw new Error(data.message || data.error);
      }

      setAlpacaSuccess('Alpaca account linked and verified successfully!');
      setHasAlpacaLinked(true);
      setShowAlpacaForm(false);
      setAlpacaKeyId('');
      setAlpacaSecret('');
    } catch (err) {
      setAlpacaError(err.message || 'Failed to save credentials');
      setAlpacaSuccess('');
    } finally {
      setSavingAlpaca(false);
    }
  }

  async function handleAlpacaUnlink() {
    if (!confirm('Are you sure you want to unlink your Alpaca account? You will need to re-enter your credentials to trade.')) {
      return;
    }

    setSavingAlpaca(true);
    setAlpacaError('');

    try {
      const { error } = await supabase
        .from('broker_credentials')
        .delete()
        .eq('user_id', user.id)
        .eq('broker', 'alpaca');

      if (error) throw error;

      setHasAlpacaLinked(false);
      setAlpacaSuccess('Alpaca account unlinked');
      setConnectionStatus(null);
    } catch (err) {
      setAlpacaError(err.message || 'Failed to unlink account');
    } finally {
      setSavingAlpaca(false);
    }
  }

  async function handleTestConnection() {
    setTestingConnection(true);
    setConnectionStatus(null);
    setAlpacaError('');

    try {
      // Try to fetch a quote - this will test if credentials work
      const { data, error } = await supabase.functions.invoke('quote', {
        body: { symbol: 'AAPL' }
      });

      if (error) throw error;

      if (data?.error === 'credentials_invalid') {
        setConnectionStatus({
          ok: false,
          message: 'Your credentials are invalid or expired. Please update your API keys.'
        });
        return;
      }

      if (data?.error === 'no_credentials') {
        setConnectionStatus({
          ok: false,
          message: 'No credentials found. Please link your Alpaca account.'
        });
        return;
      }

      if (data?.error) {
        setConnectionStatus({
          ok: false,
          message: data.message || 'Connection test failed.'
        });
        return;
      }

      // Success - got a price back
      setConnectionStatus({
        ok: true,
        message: `Connection successful! Paper trading account is active.`
      });
    } catch (err) {
      setConnectionStatus({
        ok: false,
        message: err.message || 'Failed to test connection.'
      });
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleUsernameChange(e) {
    e.preventDefault();
    setUsernameError('');
    setUsernameSuccess('');

    const trimmedUsername = username.trim();

    // Validate username
    if (trimmedUsername && trimmedUsername.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      return;
    }

    if (trimmedUsername && trimmedUsername.length > 20) {
      setUsernameError('Username must be 20 characters or less');
      return;
    }

    if (trimmedUsername && !/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      setUsernameError('Username can only contain letters, numbers, and underscores');
      return;
    }

    setUpdatingUsername(true);

    // Upsert the profile
    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        id: user.id,
        username: trimmedUsername || null
      }, {
        onConflict: 'id'
      });

    setUpdatingUsername(false);

    if (error) {
      if (error.code === '23505') {
        setUsernameError('This username is already taken');
      } else {
        setUsernameError(error.message);
      }
    } else {
      setUsernameSuccess('Username updated successfully');
      setOriginalUsername(trimmedUsername);
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setUpdatingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setUpdatingPassword(false);

    if (error) {
      setPasswordError(error.message);
    } else {
      setPasswordSuccess('Password updated successfully');
      setNewPassword('');
      setConfirmPassword('');
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  if (!user) {
    return (
      <div className="page" style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ textAlign: 'center', padding: 28 }}>
          <p className="muted">Please sign in to view your profile.</p>
          <button className="btn primary" onClick={() => navigate('/login')}>
            Sign In
          </button>
        </div>
      </div>
    );
  }

  const createdAt = user.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown';
  const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'Unknown';

  return (
    <div className="page">
      <h2 style={{ color: '#fff', marginBottom: 20 }}>Profile</h2>

      <div className="dashboard-row-2-equal" style={{ maxWidth: 900 }}>
        {/* Account Info */}
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Account Information</h3>

          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4 }}>Email</label>
              <div style={{
                background: '#0f1319',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #2a3040',
                color: '#e7ecf5'
              }}>
                {user.email}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4 }}>User ID</label>
              <div style={{
                background: '#0f1319',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #2a3040',
                color: '#e7ecf5',
                fontSize: 13,
                fontFamily: 'monospace'
              }}>
                {user.id}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4 }}>Account Created</label>
              <div style={{
                background: '#0f1319',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #2a3040',
                color: '#e7ecf5'
              }}>
                {createdAt}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4 }}>Last Sign In</label>
              <div style={{
                background: '#0f1319',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #2a3040',
                color: '#e7ecf5'
              }}>
                {lastSignIn}
              </div>
            </div>
          </div>
        </div>

        {/* Display Name */}
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Display Name</h3>
          <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 14 }}>
            Set a username that will be displayed on leaderboards and in leagues instead of your user ID.
          </p>

          <form onSubmit={handleUsernameChange} style={{ display: 'grid', gap: 12 }}>
            <div>
              <label htmlFor="username" style={{ display: 'block', marginBottom: 4 }}>Username</label>
              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter a username"
                autoComplete="username"
                disabled={loadingProfile}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                3-20 characters, letters, numbers, and underscores only
              </div>
            </div>

            {usernameError && (
              <div style={{ color: '#ef4444', fontSize: 14 }}>{usernameError}</div>
            )}
            {usernameSuccess && (
              <div style={{ color: '#10b981', fontSize: 14 }}>{usernameSuccess}</div>
            )}

            <button
              type="submit"
              className="btn primary"
              disabled={updatingUsername || loadingProfile || username === originalUsername}
              style={{ marginTop: 8 }}
            >
              {updatingUsername ? 'Saving...' : 'Save Username'}
            </button>
          </form>
        </div>
      </div>

      <div className="dashboard-row-2-equal" style={{ maxWidth: 900, marginTop: 16 }}>
        {/* Change Password */}
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Change Password</h3>

          <form onSubmit={handlePasswordChange} style={{ display: 'grid', gap: 12 }}>
            <div>
              <label htmlFor="new-password" style={{ display: 'block', marginBottom: 4 }}>New Password</label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                autoComplete="new-password"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label htmlFor="confirm-password" style={{ display: 'block', marginBottom: 4 }}>Confirm Password</label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            {passwordError && (
              <div style={{ color: '#ef4444', fontSize: 14 }}>{passwordError}</div>
            )}
            {passwordSuccess && (
              <div style={{ color: '#10b981', fontSize: 14 }}>{passwordSuccess}</div>
            )}

            <button
              type="submit"
              className="btn primary"
              disabled={updatingPassword}
              style={{ marginTop: 8 }}
            >
              {updatingPassword ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>

        {/* Alpaca Account */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Alpaca Trading Account</h3>
            <button
              type="button"
              onClick={() => setShowAlpacaHelp(!showAlpacaHelp)}
              style={{
                background: showAlpacaHelp ? '#3b82f6' : 'transparent',
                border: '1px solid #3b82f6',
                color: showAlpacaHelp ? '#fff' : '#3b82f6',
                borderRadius: '50%',
                width: 24,
                height: 24,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="How to get API keys"
            >
              ?
            </button>
          </div>

          {showAlpacaHelp && (
            <div style={{
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: 8,
              padding: 16,
              marginBottom: 16,
              fontSize: 14
            }}>
              <h4 style={{ margin: '0 0 12px 0', color: '#3b82f6' }}>How to get your Alpaca API Keys</h4>
              <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                <li>
                  Go to{' '}
                  <a
                    href="https://alpaca.markets"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#3b82f6' }}
                  >
                    alpaca.markets
                  </a>{' '}
                  and create a free account (or sign in)
                </li>
                <li>
                  Switch to <strong>Paper Trading</strong> mode (toggle in top-right corner)
                </li>
                <li>
                  Go to the{' '}
                  <a
                    href="https://app.alpaca.markets/paper/dashboard/overview"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#3b82f6' }}
                  >
                    Paper Trading Dashboard
                  </a>
                </li>
                <li>
                  Click on <strong>API Keys</strong> in the left sidebar
                </li>
                <li>
                  Click <strong>Generate New Key</strong> (or use existing keys)
                </li>
                <li>
                  Copy the <strong>API Key ID</strong> (starts with "PK...")
                </li>
                <li>
                  Copy the <strong>Secret Key</strong> (only shown once - save it!)
                </li>
                <li>
                  Paste both keys in the form below
                </li>
              </ol>
              <p className="muted" style={{ margin: '12px 0 0 0', fontSize: 13 }}>
                Note: Paper trading uses fake money - your real funds are never at risk.
              </p>
            </div>
          )}

          <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 14 }}>
            Link your Alpaca paper trading account to execute trades.
          </p>

          {loadingAlpaca ? (
            <div className="muted">Loading...</div>
          ) : hasAlpacaLinked && !showAlpacaForm ? (
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 16px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: 8,
                marginBottom: 12
              }}>
                <span style={{ color: '#10b981', fontSize: 18 }}>&#10003;</span>
                <span style={{ color: '#10b981' }}>Alpaca account linked</span>
              </div>

              {/* Connection status message */}
              {connectionStatus && (
                <div style={{
                  padding: '10px 14px',
                  marginBottom: 12,
                  backgroundColor: connectionStatus.ok ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  border: `1px solid ${connectionStatus.ok ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                  borderRadius: 8,
                  color: connectionStatus.ok ? '#10b981' : '#f87171',
                  fontSize: 14
                }}>
                  {connectionStatus.message}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={handleTestConnection}
                  disabled={testingConnection || savingAlpaca}
                  style={{
                    backgroundColor: '#3b82f6',
                    borderColor: '#3b82f6',
                    color: '#fff'
                  }}
                >
                  {testingConnection ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowAlpacaForm(true)}
                  disabled={savingAlpaca || testingConnection}
                >
                  Update Keys
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleAlpacaUnlink}
                  disabled={savingAlpaca || testingConnection}
                  style={{
                    background: 'transparent',
                    borderColor: '#ef4444',
                    color: '#ef4444'
                  }}
                >
                  {savingAlpaca ? 'Unlinking...' : 'Unlink'}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleAlpacaSave} style={{ display: 'grid', gap: 12 }}>
              <div>
                <label htmlFor="alpaca-key" style={{ display: 'block', marginBottom: 4 }}>API Key ID</label>
                <input
                  id="alpaca-key"
                  name="alpaca-key"
                  type="text"
                  value={alpacaKeyId}
                  onChange={(e) => setAlpacaKeyId(e.target.value)}
                  placeholder="PK..."
                  autoComplete="off"
                  style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }}
                />
              </div>

              <div>
                <label htmlFor="alpaca-secret" style={{ display: 'block', marginBottom: 4 }}>Secret Key</label>
                <input
                  id="alpaca-secret"
                  name="alpaca-secret"
                  type="password"
                  value={alpacaSecret}
                  onChange={(e) => setAlpacaSecret(e.target.value)}
                  placeholder="Your secret key"
                  autoComplete="off"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              {alpacaError && (
                <div style={{ color: '#ef4444', fontSize: 14 }}>{alpacaError}</div>
              )}
              {alpacaSuccess && (
                <div style={{ color: '#10b981', fontSize: 14 }}>{alpacaSuccess}</div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={savingAlpaca}
                >
                  {savingAlpaca ? 'Saving...' : 'Link Account'}
                </button>
                {hasAlpacaLinked && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setShowAlpacaForm(false);
                      setAlpacaKeyId('');
                      setAlpacaSecret('');
                      setAlpacaError('');
                    }}
                    disabled={savingAlpaca}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Sign Out Section */}
      <div className="card" style={{ maxWidth: 900, marginTop: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Session</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Sign out of your account on this device.
        </p>
        <button
          className="btn"
          onClick={handleSignOut}
          style={{
            background: '#b91c1c',
            borderColor: '#b91c1c',
            color: '#fff'
          }}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
