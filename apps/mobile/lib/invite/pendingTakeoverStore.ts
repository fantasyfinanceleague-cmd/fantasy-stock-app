import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { createPendingTakeover, TAKEOVER_STORAGE_KEY, type TakeoverSnapshot } from './pendingTakeover';

// The app-wide pending takeover (lib/invite/pendingTakeover.ts has the reasoning), bound to AsyncStorage.
// app/+native-intent.tsx captures into it; app/_layout.tsx opens the landing; app/takeover.tsx finishes it.

export const pendingTakeover = createPendingTakeover({
  storage: {
    get: () => AsyncStorage.getItem(TAKEOVER_STORAGE_KEY),
    set: (v) => AsyncStorage.setItem(TAKEOVER_STORAGE_KEY, v),
    remove: () => AsyncStorage.removeItem(TAKEOVER_STORAGE_KEY),
  },
  now: () => Date.now(),
});

void pendingTakeover.load();

/** The store's whole state, live. */
export function useTakeoverSnapshot(): TakeoverSnapshot {
  return useSyncExternalStore(pendingTakeover.subscribe, pendingTakeover.getSnapshot);
}
