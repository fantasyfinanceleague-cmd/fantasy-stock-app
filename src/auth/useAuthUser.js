import { useEffect, useState } from 'react';
import { supabase } from '../supabase/supabaseClient';

export function useAuthUser() {
  const [user, setUser] = useState(null);     // null = unknown yet, object = signed in, falsey = signed out
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data?.user ?? false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? false);
    });
    return () => sub?.subscription?.unsubscribe();
  }, []);
  return user; // null while loading, false when signed out, user object when signed in
}
