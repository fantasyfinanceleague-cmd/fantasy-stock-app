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
});
