// Onboarding W3 — the ONE web-domain value the invite link, the universal-link entitlement and the
// email-confirmation redirect are built from (plan 2026-10-14, open question 1).
//
// The product name is deferred, so this is the current Vercel production domain
// (docs/migrations/MIGRATION_PHASE_3B_SPEC.md, docs/design/NAMING.md). A rename changes THIS value and
// four mirrors, every one pinned equal by tests-deno/onboarding-w3-invite-links.test.ts:
//   - app.json  ios.associatedDomains  (the app's side of universal links; needs a new native build)
//   - the apple-app-site-association file served by the web app (W5; the domain is what Apple fetches it FROM)
//   - supabase/functions/_shared/web-origin.ts  (invite-preview's CORS origin)
//   - the Supabase dashboard's Redirect URL for the confirmation link
//
// Pure (no React Native imports) so tests-deno can load it.

export const WEB_DOMAIN = 'fantasy-stock-app.vercel.app';

/**
 * Apple Developer Team ID: a PUBLIC identifier (it is in every signed build's entitlements and in the AASA file
 * itself), supplied by Giorgio 2026-10-14. The AASA appID is `${APPLE_TEAM_ID}.${ios.bundleIdentifier}`
 * (app.json); docs/security/universal-links.md shows the file and a test pins it to this value.
 */
export const APPLE_TEAM_ID = '688SPM7BS6';

/** No trailing slash. */
export const WEB_ORIGIN = `https://${WEB_DOMAIN}`;

/** With the trailing slash: the prefix every https link this app accepts must start with. */
export const WEB_BASE = `${WEB_ORIGIN}/`;

/**
 * The paths Apple should open in the app (the AASA `components`), as the web app serves them. Each one is
 * handled by app/+native-intent.tsx; a test walks this list through that handler so the file and the app
 * cannot drift apart.
 */
export const UNIVERSAL_LINK_PATHS: readonly string[] = ['/join/*', '/auth/confirm'];
