// The web app's origin: the ONE place the edge functions learn it (Onboarding W3, plan open question 1).
//
// The product name is deferred, so this is the current Vercel production domain. The same value is the app's
// WEB_DOMAIN (apps/mobile/lib/links/webDomain.ts), the iOS associated domain (apps/mobile/app.json) and the
// host in the confirmation Redirect URL; apps/mobile/tests-deno/onboarding-w3-invite-links.test.ts pins them
// equal, so a rename cannot update three of the four.
export const WEB_ORIGIN = 'https://fantasy-stock-app.vercel.app';
