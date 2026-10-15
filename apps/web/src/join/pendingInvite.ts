/**
 * The invite this browser is joining, kept in localStorage so it survives the
 * email round trip (the confirmation link usually opens a NEW tab, and
 * sessionStorage is per tab) and an OAuth redirect. It is the league's invite
 * code: a capability, so it is written only when a person STARTS a sign-in on
 * /join/<code>, read back only through normalizeInviteCode, and cleared at
 * every terminal screen and on sign-out. Every access is guarded: storage can
 * be absent or throw (private windows, blocked site data), and the flow must
 * still work without it (the redirect URL carries the invite too).
 */
import { normalizeInviteCode } from './inviteCode';

export const PENDING_INVITE_KEY = 'stockpile-onboarding-invite';

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function setPendingInvite(code: string, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(PENDING_INVITE_KEY, code);
  } catch {
    /* storage unavailable: the redirect URL still carries the invite */
  }
}

export function getPendingInvite(storage: Pick<Storage, 'getItem'> | null = safeStorage()): string | null {
  try {
    return normalizeInviteCode(storage?.getItem(PENDING_INVITE_KEY));
  } catch {
    return null;
  }
}

export function clearPendingInvite(storage: Pick<Storage, 'removeItem'> | null = safeStorage()): void {
  try {
    storage?.removeItem(PENDING_INVITE_KEY);
  } catch {
    /* nothing to clear */
  }
}
