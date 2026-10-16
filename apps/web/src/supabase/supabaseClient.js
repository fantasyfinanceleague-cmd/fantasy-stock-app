import { createClient } from '@supabase/supabase-js';
import { createJwtRetryFetch, isLegacyAuthReturn } from './legacyClientGuards';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// Phase 3b: legacy anon key -> new publishable key (anon drop-in replacement).
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// The JWT-expired retry is scoped to THIS client through supabase-js's
// global.fetch option. It used to replace globalThis.fetch, which put this
// client's session on other code's requests too (the onboarding client in
// src/join/* included). The retry needs the client and the client needs the
// fetch, so the ref breaks that cycle.
const clientRef = { current: null };
const jwtRetryFetch = createJwtRetryFetch({
  supabaseUrl,
  refreshSession: () => clientRef.current.auth.refreshSession(),
});

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // Only the old app's own sign-in return (the site root) is read for a
    // session; tokens or errors in any other page's URL are not this
    // client's to take. See legacyClientGuards.js.
    detectSessionInUrl: isLegacyAuthReturn,
    // Storage key for the session - helps avoid conflicts
    storageKey: 'fantasy-finance-auth',
  },
  global: { fetch: jwtRetryFetch },
});
clientRef.current = supabase;

// Helper to ensure session is valid before making requests
export async function ensureValidSession() {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error || !session) {
    // Try to refresh
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData?.session) {
      return null;
    }
    return refreshData.session;
  }

  // Check if token is expiring soon (within 5 minutes)
  const expiresAt = session.expires_at;
  const now = Math.floor(Date.now() / 1000);

  if (expiresAt && expiresAt - now < 300) {
    const { data: refreshData } = await supabase.auth.refreshSession();
    return refreshData?.session ?? session;
  }

  return session;
}
