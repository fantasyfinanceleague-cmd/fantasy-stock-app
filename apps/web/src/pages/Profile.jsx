import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import { useAuthUser } from '../auth/useAuthUser';
import { validateUsername } from '../utils/contentModeration';
import '../layout.css';

// Available avatar options
const AVATAR_OPTIONS = [
  '📊', '📈', '📉', '💹', '💰', '💵', '💎', '🏆',
  '🚀', '🌟', '⭐', '🔥', '💪', '🎯', '🎲', '🃏',
  '🦁', '🐂', '🐻', '🦅', '🐺', '🦊', '🐲', '🦈',
  '👤', '👨‍💼', '👩‍💼', '🧑‍💻', '👨‍🚀', '🥷', '🧙', '👑',
];

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

  // Avatar state
  const [avatar, setAvatar] = useState('📊');
  const [originalAvatar, setOriginalAvatar] = useState('📊');
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

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
        .select('username, avatar')
        .eq('id', user.id)
        .single();

      if (!error && data) {
        setUsername(data.username || '');
        setOriginalUsername(data.username || '');
        setAvatar(data.avatar || '📊');
        setOriginalAvatar(data.avatar || '📊');
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

    // Check for inappropriate content
    const contentCheck = validateUsername(trimmedUsername);
    if (!contentCheck.isValid) {
      setUsernameError(contentCheck.reason || 'Username is not allowed');
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

  async function handleAvatarSave(newAvatar) {
    if (newAvatar === originalAvatar) {
      setShowAvatarPicker(false);
      return;
    }

    setSavingAvatar(true);
    setAvatar(newAvatar);

    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        id: user.id,
        avatar: newAvatar
      }, {
        onConflict: 'id'
      });

    setSavingAvatar(false);
    setShowAvatarPicker(false);

    if (!error) {
      setOriginalAvatar(newAvatar);
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

  function handleSignOut() {
    // Navigate FIRST to prevent Protected from redirecting to /login
    // The signOut will complete on the landing page
    sessionStorage.setItem('logout', 'true');
    window.location.href = '/';
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
      <div className="dashboard-row-2-equal">
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

        {/* Display Name & Avatar */}
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Display Name</h3>

          {/* Avatar + Username in a row */}
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            {/* Avatar */}
            <div style={{ textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => setShowAvatarPicker(true)}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 16,
                  backgroundColor: '#1e293b',
                  border: '2px solid #374151',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 40,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s ease',
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = '#374151'}
                title="Change avatar"
              >
                {avatar}
              </button>
              <button
                type="button"
                onClick={() => setShowAvatarPicker(true)}
                className="muted"
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 12,
                  marginTop: 6,
                  cursor: 'pointer',
                  color: '#60a5fa',
                }}
              >
                Change
              </button>
            </div>

            {/* Username Form */}
            <div style={{ flex: 1 }}>
              <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 14 }}>
                Set a username that will be displayed on leaderboards and in leagues.
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
                >
                  {updatingUsername ? 'Saving...' : 'Save Username'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-row-2-equal" style={{ marginTop: 16 }}>
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
      <div className="card" style={{ marginTop: 16 }}>
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

      {/* Avatar Picker Modal */}
      {showAvatarPicker && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowAvatarPicker(false)}
        >
          <div
            style={{
              backgroundColor: '#1a1f2e',
              borderRadius: 16,
              padding: 24,
              maxWidth: 400,
              width: '90%',
              border: '1px solid #374151',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, color: '#fff' }}>Choose Avatar</h3>
              <button
                type="button"
                onClick={() => setShowAvatarPicker(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9ca3af',
                  fontSize: 24,
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gap: 8,
            }}>
              {AVATAR_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleAvatarSave(opt)}
                  disabled={savingAvatar}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    fontSize: 22,
                    border: avatar === opt ? '2px solid #3b82f6' : '1px solid #374151',
                    borderRadius: 8,
                    backgroundColor: avatar === opt ? 'rgba(59, 130, 246, 0.2)' : '#0f1319',
                    cursor: savingAvatar ? 'wait' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
