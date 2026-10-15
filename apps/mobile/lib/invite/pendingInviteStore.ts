import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { fetchInvitePreview } from './invitePreviewApi';
import { createPendingInvite, INVITE_STORAGE_KEY, type InviteSnapshot } from './pendingInvite';

// The app-wide pending invite (lib/invite/pendingInvite.ts has the reasoning), bound to AsyncStorage and the
// real preview call. app/+native-intent.tsx captures into it; app/_layout.tsx opens the join; app/join-league.tsx
// finishes it; the signed-out arrival and "Check your email" screens read it through usePendingInvite().

export const pendingInvite = createPendingInvite({
  storage: {
    get: () => AsyncStorage.getItem(INVITE_STORAGE_KEY),
    set: (v) => AsyncStorage.setItem(INVITE_STORAGE_KEY, v),
    remove: () => AsyncStorage.removeItem(INVITE_STORAGE_KEY),
  },
  fetchPreview: fetchInvitePreview,
  now: () => Date.now(),
  warn: (m) => console.warn(m),
});

// Read the stored invite as soon as the module loads (first import is from +native-intent or the root layout).
void pendingInvite.load();

/**
 * The store's whole state, live (loaded, code, autoOpenedCode ...): for the root layout. Screens use
 * usePendingInvite() (lib/invite/usePendingInvite.ts), which is null when there is no invite.
 */
export function useInviteSnapshot(): InviteSnapshot {
  return useSyncExternalStore(pendingInvite.subscribe, pendingInvite.getSnapshot);
}
