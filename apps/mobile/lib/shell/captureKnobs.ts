/**
 * captureKnobs: the PURE half of W4 Onboarding's capture knobs (same split as
 * lib/join/joinFixtureGate.ts vs lib/join/devFixture.ts: this file never mentions `__DEV__`,
 * so Deno can import and test it; ./captureDev.ts is the one file that reads `__DEV__` and the
 * env vars). Captures only: each knob opens ONE state of a first-run / create / join screen on a
 * cold launch, so the gate's stills are reproducible without a tap. A release bundle compiles
 * `__DEV__` to false and never consults any of them; unset, every screen starts as it always did.
 *
 *   EXPO_PUBLIC_ONBOARDING_CARD=1|2|3      the onboarding card to open on
 *   EXPO_PUBLIC_CREATE_FIXTURE=<state>     Create league's step (or its done screen)
 *   EXPO_PUBLIC_JOIN_AUTO=find|join        Join presses Find league (and then Join) by itself
 *   EXPO_PUBLIC_SIGNUP_PAUSED=1            Create account opens on the signups-paused refusal
 *   EXPO_PUBLIC_USERNAME_PREFILL=<name>    the username picker starts with this typed in
 */
import type { CreateStep } from '../game/createLeagueSteps';

export type CreateFixture = CreateStep | 'tiers' | 'done' | 'done_no_date';
const CREATE_FIXTURES: readonly CreateFixture[] = ['league', 'season', 'draft', 'stakes', 'tiers', 'done', 'done_no_date'];

export interface CaptureKnobs {
  /** 0-based card index. */
  onboardingCard: number | null;
  create: CreateFixture | null;
  joinAuto: 'find' | 'join' | null;
  signupPaused: boolean;
  usernamePrefill: string | null;
}

export const NO_KNOBS: CaptureKnobs = { onboardingCard: null, create: null, joinAuto: null, signupPaused: false, usernamePrefill: null };

export interface CaptureEnv {
  card?: string;
  create?: string;
  joinAuto?: string;
  signupPaused?: string;
  usernamePrefill?: string;
}

/** Only a development build reads anything; an unrecognised value is ignored, never guessed. */
export function parseCaptureKnobs(isDev: boolean, env: CaptureEnv): CaptureKnobs {
  if (!isDev) return NO_KNOBS;
  const card = Number(env.card);
  const create = (CREATE_FIXTURES as readonly string[]).includes(env.create ?? '') ? (env.create as CreateFixture) : null;
  const joinAuto = env.joinAuto === 'find' || env.joinAuto === 'join' ? env.joinAuto : null;
  const prefill = env.usernamePrefill?.trim() || null;
  return {
    onboardingCard: Number.isInteger(card) && card >= 1 && card <= 3 ? card - 1 : null,
    create,
    joinAuto,
    signupPaused: env.signupPaused === '1',
    usernamePrefill: prefill,
  };
}

/** Create league's opening step for a fixture ('tiers' is the Stakes step with price tiers chosen). */
export function createFixtureStep(f: CreateFixture | null): CreateStep {
  if (f === null || f === 'done' || f === 'done_no_date') return 'league';
  return f === 'tiers' ? 'stakes' : f;
}
