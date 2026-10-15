# Universal links: the invite link and the email-confirmation return (Onboarding W3)

Plan: [`../plans/2026-10-14-onboarding.md`](../plans/2026-10-14-onboarding.md). The domain is ONE value
(`apps/mobile/lib/links/webDomain.ts`, currently `fantasy-stock-app.vercel.app`); a rename touches the four mirrors
listed in that file's header, each pinned equal by `apps/mobile/tests-deno/onboarding-w3-invite-links.test.ts`.

## 1. The apple-app-site-association file (the web app serves it; W5)

Served at `https://<domain>/.well-known/apple-app-site-association`: **no file extension, `Content-Type:
application/json`, HTTPS, no redirect** (it must win over `apps/web/vercel.json`'s catch-all rewrite). `688SPM7BS6` is
Apple's Team ID (a public identifier, supplied by Giorgio 2026-10-14; `APPLE_TEAM_ID` in `webDomain.ts`), and
`com.stockpile.fantasystock` is the bundle id in `apps/mobile/app.json`; a test pins both.

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["688SPM7BS6.com.stockpile.fantasystock"],
        "components": [
          { "/": "/join/*", "comment": "invite links; the app validates the code" },
          { "/": "/auth/confirm", "comment": "email-confirmation return (PKCE code in the query)" }
        ]
      }
    ]
  }
}
```

`/reset-password` is deliberately NOT listed: the password-reset email keeps the `fantasystockapp://` scheme.

## 2. Supabase dashboard (Giorgio), BEFORE the 1.3 build ships

Authentication → URL Configuration → Redirect URLs → add the EXACT URL (no `*`, no query):

```
https://fantasy-stock-app.vercel.app/auth/confirm
```

**No invite code rides on the confirmation email** (Planner decision 17: a mistyped address would hand a stranger a join
capability), so the redirect the app sends is exactly that URL and the allow-list entry is exactly that URL. GoTrue
validates the `redirect_to` it was given and only then appends `?code=<one-time code>`, so the exact entry should match.
**Check it with a real email** (sign up with a test address on the 1.3 build; the link must land on
`/auth/confirm?code=...`, not on the Site URL). If, and only if, that falls back to the Site URL, use
`https://fantasy-stock-app.vercel.app/auth/confirm?*` INSTEAD, and never `**`. Without any matching entry GoTrue silently
falls back to the Site URL. Keep the existing `fantasystockapp://reset-password?**` entry and `fantasystockapp://auth/confirm**`
(the web page's "Open the app" button hands the same one-time code to the app on that scheme).

## 3. What ships where

- `associatedDomains` is a NATIVE change: it needs the 1.3 EAS build; an OTA update cannot add it. The https
  confirmation redirect must ship in that same build (an older build's `emailRedirectTo` stays on the scheme).
- **Order matters: the web must be LIVE before the 1.3 build ships.** The build's confirmation email points at
  `https://<domain>/auth/confirm` and its invite links at `https://<domain>/join/<CODE>`, so BEFORE any tester gets
  1.3: W5's web app is deployed with the AASA file (`/.well-known/apple-app-site-association`, section 1) and the
  `/auth/confirm` + `/join/*` pages, and the dashboard Redirect URL (section 2) is in. Otherwise a confirmation email
  opens a dead page and a shared link goes nowhere.
- Android gets the scheme fallback only.
- After GoTrue's redirect from `supabase.co`, iOS does not always open the app (a redirect, not a tap). The web page
  `/auth/confirm` therefore offers "Open the app" → `fantasystockapp://auth/confirm?code=<same code>`. That is safe
  under PKCE (the code is useless without the app's stored verifier), and the page must never exchange the code
  itself (`detectSessionInUrl` off on that route).

## 4. Deploy order for the no-session preview (Giorgio; nothing here is run by a worker)

0. **Read-only check, first**: every existing invite code must fit the shape the link accepts (4-12 letters and digits).
   In the SQL editor:
   `select count(*) filter (where invite_code !~ '^[A-Z0-9]{4,12}$') as odd, count(*) as total from public.leagues;`
   Expect `odd = 0`. A league with an odd code still works by typing the code, but its Share sends the sentence without
   a link, and the invite page would reject it.
1. `supabase db push` from the deploy checkout (CLAUDE.md): applies `20261124000000_invite_preview.sql` (dry-run first;
   it must list exactly that one file).
2. **Create the Vault salt, once** (you generate the value; it is never in a file or a chat):
   `select vault.create_secret('<output of: openssl rand -hex 32>', 'invite_preview_ip_salt', 'salt for hashing client IPs in the invite-preview limiter');`
   - **Do not leave that snippet in the SQL editor's saved history / snippets**: delete the saved query after running it
     (the value is in it). Type it fresh; do not paste it into a chat or a file.
   - Until the secret exists the lookup FAILS CLOSED (every call answers `rate_limited`, logged as `limited salt`), so
     the web and the apps show the generic "You're invited to a league". That is the safe state, not a bug.
   - **Rotating the salt resets every limiter key** (the stored subjects are hashes of the old salt), which also
     resets everyone's miss budget for up to an hour. Rotate only on purpose.
   - Optional, read-only: what PostgREST applies to the roles that call these functions (the lookup deliberately sets no
     statement_timeout of its own, see the migration comment): `select rolname, rolconfig from pg_roles where rolname in
     ('authenticator','anon','authenticated','service_role');`  Do NOT add an `ALTER ROLE service_role SET statement_timeout`
     to bound this one function: it would hit every cron and batch path. The lookup's call bound is the edge function's own
     2-second abort (client-side).
3. Run **PART 1** then **PART 2** of `docs/security/invite-preview-effect-test.sql` (every `ok` true; every line PASS).
4. `supabase functions deploy invite-preview --project-ref haiaaifjcclsvmkfqgmd`, then `supabase functions deploy
   preview-league` (it gains `league.inviter`); verify both (the "Uploading asset" list; a scratch download diffed
   against the commit). Then **PART 3** (3a no-credential POST reaches OUR code; 3b the forged-header procedure;
   3c a second network; 3f the REST rpc is refused).
5. Re-capture `docs/architecture/db-snapshot.json` (`docs/architecture/db-snapshot.sql`) and re-run
   `node scripts/gen-architecture.mjs`: the "high" drift rows ("invite_preview_* ABSENT from prod snapshot") exist only
   until then.
6. In the function logs a tripped limit shows as `invite-preview: limited <key>` (`ip`, `miss-ip`, `miss-all`,
   `req-all`, `contention`, `salt`); the 429 body the client sees is the same for all of them. A steady stream of
   `miss-all` or `req-all` is an enumeration attempt or a flood; `salt` means the Vault secret is missing.

The contract the clients rely on: **a 429, a 5xx, a network error, an unparseable body and an undeployed function all
mean "preview unknown"**, and the web and the apps then say "You're invited to a league". A shared network (campus,
office NAT) can reach the per-IP miss limit after a few typos, so a 429 is never an error page. Names from the preview
(`name`, `inviter`) are TEXT ONLY: render them escaped, never as markup (`inviter` is at most 40 characters).
