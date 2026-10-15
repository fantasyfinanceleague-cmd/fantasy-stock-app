// The web side of the invite link, read from the ONE config file
// (apps/web/universal-links.config.json; see vite-plugins/universalLinks.ts).
import config from '../../universal-links.config.json';

/** Where "Get the app" goes. A placeholder until Giorgio relays it; the build refuses to ship one. */
export const APP_STORE_URL: string = config.appStoreUrl;

/**
 * The no-session league preview (onboarding W3's `invite-preview` edge
 * function). Plain fetch with the PUBLISHABLE key, never the supabase client:
 * the onboarding pages create no client until a person signs in, and a failed
 * or absent function must degrade to "You're invited to a league", never an
 * error page. Both env values already exist for the app.
 */
export const SUPABASE_URL: string | null = import.meta.env.VITE_SUPABASE_URL
  ? String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '')
  : null;
export const INVITE_PREVIEW_URL: string | null = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/invite-preview` : null;
export const PUBLISHABLE_KEY: string | null = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? null;

/**
 * Where an email link sent by THIS page, or an OAuth return, lands (the
 * Supabase dashboard's Redirect URLs must list `<origin>/auth/web-callback**`).
 * It is NOT /auth/confirm: that path belongs to the app's own emails (the
 * universal link, which never exchanges). This path's PKCE verifier is in THIS
 * browser, so this one DOES exchange. `via` only picks which failure line shows.
 */
export function webCallbackUrl(origin: string, invite: string, via: 'email' | 'oauth'): string {
  return `${origin}/auth/web-callback?invite=${encodeURIComponent(invite)}&via=${via}`;
}

/**
 * "Open the app" on /auth/confirm for a phone where the universal link did not
 * fire after GoTrue's redirect. The code is single-use and PKCE-bound: useless
 * without the verifier inside the app, which is the only place it is exchanged.
 */
export function openConfirmInAppUrl(code: string): string {
  return `${config.appScheme}://auth/confirm?code=${encodeURIComponent(code)}`;
}
