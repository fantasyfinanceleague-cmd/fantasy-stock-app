// src/context/UserProfilesContext.jsx
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '../supabase/supabaseClient';

const UserProfilesContext = createContext(null);

export function UserProfilesProvider({ children }) {
  // profiles: { [userId]: { username: string | null } }
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

    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, username')
      .in('id', toFetch);

    if (!error && data) {
      const newProfiles = {};
      data.forEach(profile => {
        newProfiles[profile.id] = { username: profile.username };
      });

      // Also mark fetched IDs with no profile as having null username
      toFetch.forEach(id => {
        if (!newProfiles[id]) {
          newProfiles[id] = { username: null };
        }
      });

      setProfiles(prev => ({ ...prev, ...newProfiles }));
    }

    setLoading(false);
  }, [profiles]);

  // Get display name for a user ID
  const getDisplayName = useCallback((userId, currentUserId = null) => {
    if (!userId) return 'Unknown';

    // Show "You" for current user
    if (currentUserId && userId === currentUserId) {
      return 'You';
    }

    // Format bot names nicely
    if (userId.startsWith('bot-')) {
      const num = userId.replace('bot-', '');
      return `Bot ${num}`;
    }

    // Check if we have a profile with a username
    const profile = profiles[userId];
    if (profile?.username) {
      return profile.username;
    }

    // Fallback to truncated user ID
    if (userId.length > 12) {
      return userId.substring(0, 8) + '...';
    }

    return userId;
  }, [profiles]);

  // Subscribe to realtime updates for profiles
  useEffect(() => {
    const channel = supabase
      .channel('user_profiles_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_profiles' },
        (payload) => {
          if (payload.new) {
            setProfiles(prev => ({
              ...prev,
              [payload.new.id]: { username: payload.new.username }
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const value = {
    profiles,
    loading,
    fetchProfiles,
    getDisplayName,
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
