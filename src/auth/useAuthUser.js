import { useEffect, useState } from 'react';
import { supabase } from '../supabase/supabaseClient';

export function useAuthUser() {
  const [user, setUser] = useState(null);     // null = unknown yet, object = signed in, false = signed out
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let retryCount = 0;
    const maxRetries = 2;

    // Check current session on mount and refresh if needed
    async function initSession() {
      try {
        // First, try to refresh the session proactively
        // This handles the case where the JWT is expired on page load
        const { data: { session }, error } = await supabase.auth.getSession();

        if (!mounted) return;

        if (error) {
          // Check if it's a JWT expired error
          const isJwtExpired = error.message?.toLowerCase().includes('jwt expired') ||
                               error.message?.toLowerCase().includes('token');

          if (isJwtExpired && retryCount < maxRetries) {
            retryCount++;

            // Force a session refresh
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

            if (!mounted) return;

            if (refreshError || !refreshData.session) {
              console.error('Token refresh failed:', refreshError);
              setUser(false);
              setIsLoading(false);
              return;
            }

            setUser(refreshData.session.user);
            setIsLoading(false);
            return;
          }

          console.error('Session error:', error);
          setUser(false);
          setIsLoading(false);
          return;
        }

        if (session) {
          // Check if token is close to expiring (within 5 minutes) or expired
          const expiresAt = session.expires_at;
          const now = Math.floor(Date.now() / 1000);

          if (expiresAt && expiresAt - now < 300) {
            // Token expired or expiring soon (within 5 min), force refresh
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            if (!mounted) return;

            if (refreshError || !refreshData.session) {
              console.error('Token refresh failed:', refreshError);
              // Still set the current user if we have one - the token might still work
              setUser(session.user);
              setIsLoading(false);
              return;
            }
            setUser(refreshData.session.user);
            setIsLoading(false);
            return;
          }

          setUser(session.user);
        } else {
          setUser(false);
        }
        setIsLoading(false);
      } catch (err) {
        console.error('Auth check failed:', err);

        // If it's a network error or JWT issue, try one more refresh
        if (retryCount < maxRetries) {
          retryCount++;

          // Wait a moment then retry
          await new Promise(resolve => setTimeout(resolve, 500));
          if (mounted) {
            const { data: refreshData } = await supabase.auth.refreshSession();
            if (mounted) {
              setUser(refreshData?.session?.user ?? false);
              setIsLoading(false);
            }
          }
          return;
        }

        if (mounted) {
          setUser(false);
          setIsLoading(false);
        }
      }
    }

    initSession();

    // Listen for auth state changes
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      // Handle token refresh events
      if (event === 'TOKEN_REFRESHED') {
        setUser(session?.user ?? false);
        setIsLoading(false);
      } else if (event === 'SIGNED_OUT') {
        setUser(false);
        setIsLoading(false);
      } else {
        setUser(session?.user ?? false);
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  // Return user with loading state attached
  // null while loading, false when signed out, user object when signed in
  const result = user;
  if (result && typeof result === 'object') {
    result._authLoading = isLoading;
  }
  return result;
}

// Hook that also returns loading state explicitly
export function useAuthState() {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function initSession() {
      try {
        // Proactively refresh to avoid JWT expired errors
        const { data: { session }, error } = await supabase.auth.getSession();

        if (!mounted) return;

        if (error || (session?.expires_at && session.expires_at - Math.floor(Date.now() / 1000) < 300)) {
          // Error or token expiring soon - try refresh
          const { data: refreshData } = await supabase.auth.refreshSession();
          if (mounted) {
            setUser(refreshData?.session?.user ?? null);
            setIsLoading(false);
          }
          return;
        }

        setUser(session?.user ?? null);
        setIsLoading(false);
      } catch (err) {
        console.error('Auth init error:', err);
        // Try one refresh on error
        try {
          const { data: refreshData } = await supabase.auth.refreshSession();
          if (mounted) {
            setUser(refreshData?.session?.user ?? null);
          }
        } catch {
          if (mounted) setUser(null);
        }
        if (mounted) setIsLoading(false);
      }
    }

    initSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  return { user, isLoading };
}
