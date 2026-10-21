/**
 * DEV-ONLY capture knobs for the W4 Onboarding gate (lib/shell/captureKnobs.ts has the pure
 * parser and the list). Same safety model as lib/shell/devFixture.ts: read only under
 * `__DEV__`, so a release bundle never consults the env vars and every knob is dead code there.
 */
import { parseCaptureKnobs } from './captureKnobs';

export const CAPTURE = parseCaptureKnobs(__DEV__, {
  card: process.env.EXPO_PUBLIC_ONBOARDING_CARD,
  create: process.env.EXPO_PUBLIC_CREATE_FIXTURE,
  joinAuto: process.env.EXPO_PUBLIC_JOIN_AUTO,
  signupPaused: process.env.EXPO_PUBLIC_SIGNUP_PAUSED,
  usernamePrefill: process.env.EXPO_PUBLIC_USERNAME_PREFILL,
  pushAsk: process.env.EXPO_PUBLIC_PUSH_ASK,
  confirmed: process.env.EXPO_PUBLIC_CONFIRMED,
  invite: process.env.EXPO_PUBLIC_INVITE_FIXTURE,
});

// Account deletion (W4): the delete screen's state for a capture (lib/account/deleteCapture.ts), and the Sign in
// line raised once (EXPO_PUBLIC_DELETED_NOTICE=1). Dev builds only, like the knobs above.
import { parseDeleteFixture } from '../account/deleteCapture';

export const DELETE_FIXTURE = parseDeleteFixture(__DEV__, process.env.EXPO_PUBLIC_DELETE_FIXTURE);
export const DELETED_NOTICE_FIXTURE = __DEV__ && process.env.EXPO_PUBLIC_DELETED_NOTICE === '1';
