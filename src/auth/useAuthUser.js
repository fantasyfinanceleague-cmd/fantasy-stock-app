import { useEffect, useState } from 'react';
import { supabase } from '../supabase/supabaseClient';

export function useAuthUser() {
  const [user, setUser] = useState(null);     // null = unknown yet, object = signed in, false = signed out

  useEffect(() => {
    let mounted = true;

    // Check current session on mount and refresh if needed
    async function initSession() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (!mounted) return;

        if (error) {
          console.error('Session error:', error);
          // Try to refresh the session if there's an error
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError || !refreshData.session) {
            setUser(false);
            return;
          }
          setUser(refreshData.session.user);
          return;
        }

        if (session) {
          // Check if token is close to expiring (within 60 seconds) or expired
          const expiresAt = session.expires_at;
          const now = Math.floor(Date.now() / 1000);

          if (expiresAt && expiresAt - now < 60) {
            // Token expired or expiring soon, force refresh
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            if (!mounted) return;

            if (refreshError || !refreshData.session) {
              console.error('Token refresh failed:', refreshError);
              setUser(false);
              return;
            }
            setUser(refreshData.session.user);
            return;
          }

          setUser(session.user);
        } else {
          setUser(false);
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        if (mounted) setUser(false);
      }
    }

    initSession();

    // Listen for auth state changes
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      // Handle token refresh events
      if (event === 'TOKEN_REFRESHED') {
        setUser(session?.user ?? false);
      } else if (event === 'SIGNED_OUT') {
        setUser(false);
      } else {
        setUser(session?.user ?? false);
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  return user; // null while loading, false when signed out, user object when signed in
}
