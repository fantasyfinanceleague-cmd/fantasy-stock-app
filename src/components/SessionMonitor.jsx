// src/components/SessionMonitor.jsx
import { useEffect, useRef } from 'react';
import { supabase } from '../supabase/supabaseClient';
import { useToast } from './Toast';

export default function SessionMonitor() {
  const toast = useToast();
  const wasLoggedInRef = useRef(false);
  const hasShownExpiryRef = useRef(false);

  useEffect(() => {
    // Check initial auth state
    supabase.auth.getSession().then(({ data: { session } }) => {
      wasLoggedInRef.current = !!session;
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // User was logged in but session is now gone (and we didn't just sign out intentionally)
      if (event === 'SIGNED_OUT' && wasLoggedInRef.current && !hasShownExpiryRef.current) {
        // Check if this was an intentional logout (flag set by logout functions)
        const intentionalLogout = sessionStorage.getItem('logout');
        if (!intentionalLogout) {
          toast.warning('Your session has expired. Please log in again.', 6000);
          hasShownExpiryRef.current = true;
        }
      }

      // Token refresh failed
      if (event === 'TOKEN_REFRESHED' && !session) {
        toast.warning('Session refresh failed. Please log in again.', 6000);
      }

      // Update tracking
      wasLoggedInRef.current = !!session;

      // Reset expiry notification flag on new login
      if (event === 'SIGNED_IN') {
        hasShownExpiryRef.current = false;
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [toast]);

  // This component doesn't render anything
  return null;
}
