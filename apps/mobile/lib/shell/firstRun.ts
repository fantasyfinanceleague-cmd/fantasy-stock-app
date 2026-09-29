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
