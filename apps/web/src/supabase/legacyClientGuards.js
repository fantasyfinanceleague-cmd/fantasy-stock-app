// Guards for the old web app's Supabase client (supabaseClient.js).
//
// Kept free of any supabase-js import so the tests can drive them directly.
// Both exist because this client is loaded on EVERY page, the paused landing
// included (main.jsx mounts SessionMonitor and UserProfilesProvider), and the
// onboarding pages (src/join/*) run their own separate PKCE client next to it.

// Where the old app's URL-carried sign-ins return. It passes no redirectTo
// anywhere (the sign-up confirm email, the GitHub button), so GoTrue sends
// them to the project's Site URL, the site root.
export const LEGACY_AUTH_RETURN_PATH = '/';

// detectSessionInUrl for the old client. In auth-js this replaces the
// implicit-grant test only: a URL counts as this client's sign-in return when
// it is on the return path AND carries the default test's params. Anywhere
// else (/join/*, /auth/confirm, /auth/web-callback, ...) the URL is left alone
// for whoever owns it. The PKCE branch needs a code verifier under this
// client's storage key, which this implicit-flow client never writes.
export function isLegacyAuthReturn(url, params) {
  if (url.pathname !== LEGACY_AUTH_RETURN_PATH) return false;
  return Boolean(params.access_token || params.error || params.error_description || params.error_code);
}

function requestHref(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input?.url ?? '';
}

// A fetch for the client's global.fetch option (never window.fetch): on a 401
// "JWT expired" from this project's data APIs it refreshes the session once
// (shared by concurrent callers) and retries the request with the new token.
// Auth requests are passed through untouched: the refresh itself goes through
// this fetch, and retrying it would wait on its own refresh.
export function createJwtRetryFetch({
  supabaseUrl,
  refreshSession,
  baseFetch = (input, init) => globalThis.fetch(input, init),
}) {
  const base = String(supabaseUrl ?? '').replace(/\/+$/, '');
  let refreshing = null;

  const isRetryable = (href) =>
    base !== '' && href.startsWith(`${base}/`) && !href.startsWith(`${base}/auth/`);

  return async function jwtRetryFetch(input, init) {
    const response = await baseFetch(input, init);
    if (response.status !== 401 || !isRetryable(requestHref(input))) return response;

    try {
      const body = await response.clone().text();
      if (!/jwt expired/i.test(body)) return response;

      refreshing ??= Promise.resolve()
        .then(refreshSession)
        .finally(() => {
          refreshing = null;
        });
      const { data, error } = (await refreshing) ?? {};
      const token = data?.session?.access_token;
      if (error || !token) return response;

      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return await baseFetch(input, { ...init, headers });
    } catch {
      // Unreadable body or a failed refresh: hand back the original 401.
      return response;
    }
  };
}
