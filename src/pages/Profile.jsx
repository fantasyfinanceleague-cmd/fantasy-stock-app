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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 900 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 900, marginTop: 16 }}>
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
