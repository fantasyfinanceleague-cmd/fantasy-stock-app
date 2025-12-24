import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Track if we're currently refreshing to avoid infinite loops
let isRefreshing = false;
let refreshPromise = null;

// Create the client first
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Storage key for the session - helps avoid conflicts
    storageKey: 'fantasy-finance-auth',
  },
});

// Wrap the original fetch to handle JWT expiry
const originalFetch = globalThis.fetch;
const supabaseFetch = async (url, options) => {
  let response = await originalFetch(url, options);

  // Only handle JWT errors for Supabase requests
  if (response.status === 401 && typeof url === 'string' && url.includes(supabaseUrl)) {
    try {
      const body = await response.clone().text();
      if (body.includes('JWT expired') || body.includes('jwt expired')) {

        // Avoid multiple concurrent refresh attempts
        if (!isRefreshing) {
          isRefreshing = true;
          refreshPromise = supabase.auth.refreshSession();
        }

        const { data: refreshData, error: refreshError } = await refreshPromise;
        isRefreshing = false;
        refreshPromise = null;

        if (!refreshError && refreshData?.session) {
          // Retry the original request with the new token
          const newOptions = { ...options };
          if (newOptions.headers) {
            const headers = new Headers(newOptions.headers);
            headers.set('Authorization', `Bearer ${refreshData.session.access_token}`);
            newOptions.headers = headers;
          }
          response = await originalFetch(url, newOptions);
        }
      }
    } catch {
      // If we can't parse the body, just return the original response
    }
  }

  return response;
};

// Apply the wrapped fetch globally for Supabase
globalThis.fetch = supabaseFetch;

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
