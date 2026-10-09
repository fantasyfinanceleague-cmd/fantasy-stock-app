// src/context/UserProfilesContext.jsx
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '../supabase/supabaseClient';

const UserProfilesContext = createContext(null);

export function UserProfilesProvider({ children }) {
  // profiles: { [userId]: { username: string | null, avatar: string | null } }
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(false);

  // Fetch profiles for a list of user IDs
  const fetchProfiles = useCallback(async (userIds) => {
    if (!userIds || userIds.length === 0) return;

    // Filter to only real user IDs (not bots) and ones we don't have yet
    const toFetch = [...new Set(userIds)]
      .filter(id => id && !id.startsWith('bot-') && !profiles[id]);

    if (toFetch.length === 0) return;

    setLoading(true);

    // Other players' profiles come ONLY through get_visible_profiles (audit #8,
    // 20261118000000): id, username and avatar of leaguemates (leavers
    // included), nothing else; ids outside the caller's leagues are absent and
    // fall through to the null-username default below. user_profiles itself
    // becomes self-only.
    const { data, error } = await supabase
      .rpc('get_visible_profiles', { p_user_ids: toFetch });

    if (!error && data) {
      const newProfiles = {};
      data.forEach(profile => {
        newProfiles[profile.id] = {
          username: profile.username,
          avatar: profile.avatar || '📊'
        };
      });

      // Also mark fetched IDs with no profile as having null username
      toFetch.forEach(id => {
        if (!newProfiles[id]) {
          newProfiles[id] = { username: null, avatar: '📊' };
        }
      });

      setProfiles(prev => ({ ...prev, ...newProfiles }));
    }

    setLoading(false);
  }, [profiles]);

  // Get display name for a user ID
  const getDisplayName = useCallback((userId, currentUserId = null) => {
    if (!userId) return 'Unknown';

    // Format bot names nicely
    if (userId.startsWith('bot-')) {
      const num = userId.replace('bot-', '');
      return `Bot ${num}`;
    }

    // Check if we have a profile with a username
    const profile = profiles[userId];
    const username = profile?.username;

    // Show "Username (You)" for current user
    if (currentUserId && userId === currentUserId) {
      return username ? `${username} (You)` : 'You';
    }

    if (username) {
      return username;
    }

    // Fallback to truncated user ID
    if (userId.length > 12) {
      return userId.substring(0, 8) + '...';
    }

    return userId;
  }, [profiles]);

  // Get avatar for a user ID
  const getAvatar = useCallback((userId) => {
    if (!userId) return '📊';

    // Bot avatars
    if (userId.startsWith('bot-')) {
      return '🤖';
    }

    // Check if we have a profile with an avatar
    const profile = profiles[userId];
    return profile?.avatar || '📊';
  }, [profiles]);

  // Realtime: the signed-in user's OWN row only (audit #8). This used to
  // subscribe to every profile change unfiltered; with user_profiles
  // self-only, Realtime would deliver only the caller's row anyway, so the
  // filter states that intent and keeps other players' changes off the wire
  // even before the policy flips. Re-subscribes when the signed-in user changes.
  const [selfId, setSelfId] = useState(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSelfId(data?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSelfId(session?.user?.id ?? null);
    });
    return () => sub?.subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    if (!selfId) return undefined;
    const channel = supabase
      .channel(`user_profiles_self_${selfId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_profiles', filter: `id=eq.${selfId}` },
        (payload) => {
          if (payload.new) {
            setProfiles(prev => ({
              ...prev,
              [payload.new.id]: {
                username: payload.new.username,
                avatar: payload.new.avatar || '📊'
              }
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selfId]);

  const value = {
    profiles,
    loading,
    fetchProfiles,
    getDisplayName,
    getAvatar,
  };

  return (
    <UserProfilesContext.Provider value={value}>
      {children}
    </UserProfilesContext.Provider>
  );
}

export function useUserProfiles() {
  const context = useContext(UserProfilesContext);
  if (!context) {
    throw new Error('useUserProfiles must be used within a UserProfilesProvider');
  }
  return context;
}
