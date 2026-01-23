import { useEffect, useState, useRef } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { setupPushNotifications, removePushToken } from './notifications';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const notificationsSetup = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Register for push notifications on initial load if logged in
      if (session?.user && !notificationsSetup.current) {
        notificationsSetup.current = true;
        setupPushNotifications(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        // Register for push notifications on sign in
        if (event === 'SIGNED_IN' && session?.user && !notificationsSetup.current) {
          notificationsSetup.current = true;
          setupPushNotifications(session.user.id);
        }

        // Reset flag on sign out
        if (event === 'SIGNED_OUT') {
          notificationsSetup.current = false;
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    // Remove push token before signing out
    if (user?.id) {
      await removePushToken(user.id);
    }
    await supabase.auth.signOut();
  };

  return { session, user, loading, signOut };
}
