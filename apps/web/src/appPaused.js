// ── App pause switch (landing-page UX ONLY — NOT the security boundary) ───────
// While APP_PAUSED is true, the marketing landing page is the ONLY reachable
// page: /login, /signup, /dashboard and all app routes redirect to it. The full
// app (AppShell.jsx and every route/component it imports) is preserved, just
// hidden behind this flag.
//
// THIS FLAG IS UX ONLY. The real signup gate is server-side: the Before User
// Created auth hook (public.restrict_new_signups reading app_config.signups_paused,
// see supabase/migrations/20260815000000_signup_gate.sql) makes GoTrue itself
// refuse new account creation — so editing this bundle cannot create an account.
// Sign-in is unaffected by that hook, so existing users keep full access.
//
// APP_PAUSED (UI) and signups_paused (server) are INDEPENDENT: APP_PAUSED=false
// with signups_paused=true opens the app to existing users while still refusing
// new signups. Opening signups is a separate DB flip, not a code change.
//
// Lives in its own module (not App.jsx) because three places read it: App.jsx
// (which tree to render), main.jsx (hydrate the prerendered landing or not),
// and scripts/prerender-landing.mjs (prerender `/` into dist/index.html ONLY
// while paused — unpaused, index.html stays the empty SPA shell).
//
// TO UN-PAUSE THE UI: set APP_PAUSED = false.
export const APP_PAUSED = true;
