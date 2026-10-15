// The web side of the invite link, read from the ONE config file
// (apps/web/universal-links.config.json; see vite-plugins/universalLinks.ts).
import config from '../../universal-links.config.json';

/** Where "Get the app" goes. A placeholder until Giorgio relays it; the build refuses to ship one. */
export const APP_STORE_URL: string = config.appStoreUrl;

/**
 * "Open in the app": the custom scheme, not the https link. Safari does not
 * hand a link to the app when the tap stays on the same domain, so an https
 * /join/<code> link on this page would just reload it. The app maps
 * <scheme>://join/<code> to the pending invite (onboarding W3).
 */
export function openInAppUrl(code: string): string {
  return `${config.appScheme}://join/${encodeURIComponent(code)}`;
}

/**
 * The no-session league preview (onboarding W3's `invite-preview` edge
 * function). Plain fetch with the PUBLISHABLE key, never the supabase client:
 * the onboarding pages create no client until a person signs in, and a failed
 * or absent function must degrade to "You're invited to a league", never an
 * error page. Both env values already exist for the app.
 */
export const INVITE_PREVIEW_URL: string | null = import.meta.env.VITE_SUPABASE_URL
  ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '')}/functions/v1/invite-preview`
  : null;
export const PUBLISHABLE_KEY: string | null = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? null;

/**
 * "Open the app" on /auth/confirm for a phone where the universal link did not
 * fire after GoTrue's redirect. The code is single-use and PKCE-bound: useless
 * without the verifier inside the app, which is the only place it is exchanged.
 */
export function openConfirmInAppUrl(code: string): string {
  return `${config.appScheme}://auth/confirm?code=${encodeURIComponent(code)}`;
}
