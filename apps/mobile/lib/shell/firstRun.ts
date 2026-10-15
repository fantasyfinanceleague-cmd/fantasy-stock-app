// Phase 3b-1 — "onboarding is shown once" (spec row 6), per device.
//
// A tiny external store so the root layout can read it synchronously once
// loaded (and hold the splash until it is). Stored in AsyncStorage; a read
// failure counts as "seen" — never trap someone in onboarding because
// storage is unavailable.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { SHELL_FIXTURE } from './devFixture';

const KEY = 'sp.onboarding.seen.v1';

let seen: boolean | null = null; // null = not read yet
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load() {
  // DEV fixture "onboarding": always show it, so it can be captured repeatedly.
  if (SHELL_FIXTURE === 'onboarding') {
    seen = false;
    return;
  }
  AsyncStorage.getItem(KEY)
    .then((v) => {
      seen = v === '1';
    })
    .catch(() => {
      seen = true;
    })
    .finally(emit);
}
load();

// Get started follows the cards on the cold path. Skipping (or finishing) the cards marks them seen
// at once (Skip is remembered forever; plan 2026-10-14), which would drop `get-started` from the
// navigator with them: this in-memory flag keeps it reachable until the person leaves it.
let getStartedOpen = false;

/** Raised BEFORE router.replace('/get-started'); cleared by leaveGetStarted(). Not persisted. */
export function openGetStarted(): void {
  if (getStartedOpen) return;
  getStartedOpen = true;
  emit();
}

export function leaveGetStarted(): void {
  if (!getStartedOpen) return;
  getStartedOpen = false;
  emit();
}

export function useGetStartedOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getStartedOpen
  );
}

export function markOnboardingSeen(): void {
  seen = true;
  emit();
  if (SHELL_FIXTURE === 'onboarding') return;
  AsyncStorage.setItem(KEY, '1').catch(() => {});
}

/** null until the stored flag has been read. */
export function useOnboardingSeen(): boolean | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => seen
  );
}
