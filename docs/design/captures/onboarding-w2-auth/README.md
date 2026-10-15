# Onboarding W2 (auth): captures

Branch `feat/onboarding-w2-auth`. Plan: [`docs/plans/2026-10-14-onboarding.md`](../../../plans/2026-10-14-onboarding.md).
Capture folder (out of the repo, per the contract): `~/fantasy-stock-design-review/feat-onboarding-w2-auth/`.

## Status: no screenshots were taken in this pass

Neither Sign in with Apple nor Sign in with Google can render in any build that exists today:

- The simulators on this machine have no Stockpile dev client installed, and the dev client that
  other sessions use predates `expo-apple-authentication` and `@react-native-google-signin`. The
  buttons are deliberately hidden when their native module is missing (`lib/auth/socialSignIn.ts`
  requires both lazily), so a capture on that client would show the email form alone and prove
  nothing about this change.
- A true capture needs a fresh dev-client build from this branch
  (`eas build --profile development --platform ios`, or a local `expo run:ios`). That is Giorgio's
  rebuild (see the hand-back), and the Google button also needs `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
  and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` from his Google Cloud step.

What the dev fixture CAN drive once such a build exists (`EXPO_PUBLIC_SHELL_FIXTURE=signed-out`,
no credentials typed): Sign in and Create account with both buttons, the Apple / Google tap
(the fixture answers with the signups-closed refusal, after `FIXTURE_NETWORK_MS`), the paused banner,
and "Check your email" (reached from Create account only with a real server; under the fixture it
refuses as paused, so that frame needs the real-server path or the W1 board's frame 9).

## Frames to capture after the rebuild (both themes, 17e + 17 Pro)

| # | Frame | How |
|---|---|---|
| 1 | Sign in with both buttons | fixture `signed-out`, open Sign in |
| 2 | Create account without a username field, both buttons | Create account |
| 3 | Apple tap -> loading -> signups-closed banner | tap Continue with Apple (fixture) |
| 4 | Google tap -> same banner | tap Continue with Google (fixture) |
| 5 | Large / XL / XXXL text: the stack of two buttons, the 44 pt "Send again" link | Dynamic Type |
| 6 | "Check your email" after a real email sign-up | real server, allow-listed test address |
| 7 | Unconfirmed sign-in: error + "Didn't receive it? Send again" | real server |

## What is verified without screenshots

See the hand-back message and the tests:
- `apps/mobile/tests-deno/pkce-auth-links.test.ts` (the confirmation and recovery links, the code
  exchange with a fake client for every outcome, the PKCE crypto shim against auth-js's own helpers);
- `apps/mobile/tests-deno/recoveryLink.test.ts` (recovery-link parsing and the reset screen's state);
- `apps/mobile/tests-deno/onboarding-w2-auth.test.ts` (Apple/Google, privacy, the approved copy, the
  native config, the create-account wiring);
- `supabase/tests/social_signup.pglite.test.ts` (profile row + signup gate for Apple / Google shapes
  on real Postgres).

Mutations over the auth decisions (link parsing, the exchange handler, the recovery path, the crypto
shim, sign-in privacy, copy, the signup hook) were each killed.

## PKCE (2026-10-14)

The email links now carry a one-time code (`flowType: 'pkce'`), exchanged on the device that holds the
code verifier. Cross-device confirmation falls back to signing in with the password. "Send again" repeats
`signUp()` (supabase's `resend()` sends no code challenge, so its email would be an implicit-flow link).

The ONE stored verifier (shared by sign-up and password reset) is protected: the link handler reads it before
any exchange and refuses a junk or wrong-flow code without spending it, sign-up / reset / exchange all run in
one queue and restore the verifier when they fail, a recovery hold keeps push prompts and deep-link replay off
the reset form, and auth requests (only) time out after 25 s so a hung one cannot hold the queue
(`lib/auth/verifierSlot.ts`, `authLinkHandlers.ts`, `authFetch.ts`).
