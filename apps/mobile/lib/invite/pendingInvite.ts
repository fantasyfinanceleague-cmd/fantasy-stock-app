// Onboarding W3 — the PENDING INVITE: the one invite link this device has not finished with.
//
// app/+native-intent.tsx captures /join/<code> here (a link is not a route, and a code must not travel as a
// router param: navigation state is persisted and logged). The invite then survives everything between the tap
// and the league: sign-in, the username step, an app kill while the person is in Mail confirming their
// address. It is persisted for that reason; the in-memory copy answers synchronously.
//
// WHY IT IS A STORE WITH A `triedJoin` FLAG, not a string. This is the partial-state flaw CLAUDE.md warns
// about, and the three states it must tell apart are:
//   - never tried          -> join it (or, if they're already a member, simply open the league);
//   - tried, answer lost   -> the join may have LANDED. The retry answers `already_member`, which on a first
//                             try means "you were already in" but after `triedJoin` means "your join worked":
//                             the person is shown "You're in {league}", not a silent open;
//   - refused              -> a definitive server answer (full, started, expired, not found): the invite is
//                             CLEARED, with the reason shown on screen (lib/invite/autoJoin.ts decides), so
//                             it is never retried forever and never dropped without a word.
// A transport failure keeps the invite and waits for the person's tap: there is NO automatic retry loop.
// An invite older than INVITE_TTL_MS is dropped on load, so a link tapped once and forgotten cannot join a
// league months later on a stray sign-in.
//
// Dependencies are injected (storage, the preview fetch, the clock) so every branch is testable without
// React Native or a Supabase project; lib/invite/pendingInviteStore.ts binds the real ones.

import { normalizeInviteCode, type InviteOrigin } from './inviteLink';
import { cleanName, type InvitePreview } from './invitePreview';

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const INVITE_STORAGE_KEY = 'sp.invite.pending.v1';

export type PreviewState = InvitePreview | { kind: 'idle' } | { kind: 'loading' };

export interface InviteSnapshot {
  /** The stored invite has been read (or there was nothing to read). Until then `code` may be null for a stored invite. */
  loaded: boolean;
  code: string | null;
  /** The league's name, once the preview (or a persisted earlier one) supplied it. */
  leagueName: string | null;
  /** A join was attempted for this code (persisted BEFORE the call), so an `already_member` answer reads as "your join landed". */
  triedJoin: boolean;
  /** The signed-in person this invite was stamped for (claim()), persisted; null until somebody signs in with it pending. */
  ownerUserId: string | null;
  /** Which kind of link brought it, decided ONCE at parse time in +native-intent (decision 18): the shared https link, or the scheme. */
  origin: InviteOrigin;
  /** Whether the person had a session when the link ARRIVED; null until known (a cold start settles it at the first resolved auth phase). */
  signedInAtArrival: boolean | null;
  preview: PreviewState;
  /** The code the root layout already opened the join screen for this launch (never persisted). */
  autoOpenedCode: string | null;
}

export interface InviteStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

export interface PendingInviteDeps {
  storage: InviteStorage;
  fetchPreview(code: string): Promise<InvitePreview>;
  now(): number;
  warn(message: string): void;
}

/** What a SCREEN sees while an invite is pending: 'idle' (nothing asked yet) reads as 'loading', never as an answer. */
export function screenPreview(p: PreviewState): Exclude<PreviewState, { kind: 'idle' }> {
  return p.kind === 'idle' ? { kind: 'loading' } : p;
}

const EMPTY: InviteSnapshot = {
  loaded: false,
  code: null,
  leagueName: null,
  triedJoin: false,
  ownerUserId: null,
  origin: 'scheme',
  signedInAtArrival: null,
  preview: { kind: 'idle' },
  autoOpenedCode: null,
};

interface Persisted {
  v: 1;
  code: string;
  capturedAt: number;
  leagueName: string | null;
  triedJoin: boolean;
  ownerUserId: string | null;
  origin: InviteOrigin;
  signedInAtArrival: boolean | null;
}

/** Reads what the store wrote; anything malformed, stale or hostile is null (and gets removed by the caller). */
export function parsePersisted(raw: string | null, now: number): Persisted | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const code = normalizeInviteCode(o.code);
  if (o.v !== 1 || !code) return null;
  const capturedAt = typeof o.capturedAt === 'number' && Number.isFinite(o.capturedAt) ? o.capturedAt : null;
  if (capturedAt === null || now - capturedAt > INVITE_TTL_MS || capturedAt - now > 24 * 60 * 60 * 1000) return null;
  return {
    v: 1,
    code,
    capturedAt,
    leagueName: cleanName(o.leagueName, 80),
    triedJoin: o.triedJoin === true,
    ownerUserId: typeof o.ownerUserId === 'string' && o.ownerUserId.length > 0 && o.ownerUserId.length <= 64 ? o.ownerUserId : null,
    // Anything but an explicit 'https' is the weaker, tap-requiring origin: a stored record can never upgrade itself.
    origin: o.origin === 'https' ? 'https' : 'scheme',
    signedInAtArrival: typeof o.signedInAtArrival === 'boolean' ? o.signedInAtArrival : null,
  };
}

/**
 * Whether a pending invite is owned by somebody other than the person whose tap this is. Known facts only: a definite
 * signed-out arrival, or a signed-in arrival of a DIFFERENT user, against a stored owner. An unowned invite, a matching
 * owner, or an arrival whose state is not known yet (a cold start) is not "other": the double delivery of one link must
 * stay idempotent, and must not reset `triedJoin` for the person it belongs to.
 */
export function inviteOwnedByOther(
  ownerUserId: string | null,
  arrival: { signedInAtArrival: boolean | null; userIdAtArrival?: string | null } | undefined
): boolean {
  if (ownerUserId === null || !arrival) return false;
  if (arrival.signedInAtArrival === false) return true;
  return arrival.signedInAtArrival === true && !!arrival.userIdAtArrival && arrival.userIdAtArrival !== ownerUserId;
}

export interface PendingInviteStore {
  getSnapshot(): InviteSnapshot;
  subscribe(listener: () => void): () => void;
  /** Read the stored invite once. An invite captured BEFORE this resolves wins over the stored one. */
  load(): Promise<void>;
  /**
   * Stamp the invite with the signed-in person it is for, once (a no-op when it already has an owner or no invite is pending).
   * See inviteOwnerAction (lib/invite/autoJoin.ts): a different person later signing in with it pending clears it.
   * With `forCode`, a no-op unless that code is STILL the pending invite (a link captured since belongs to its own tap).
   */
  claim(userId: string, forCode?: string): void;
  /**
   * Record a link's code with how it ARRIVED (origin: parse time; signedInAtArrival: the auth phase at that moment,
   * null when still unknown). False when the code fails the shape check. The same code again changes nothing, origin
   * included (the first arrival wins; there is no upgrade), EXCEPT when the pending invite is owned by somebody else
   * than the person tapping now (a definite signed-out, or a different signed-in user): that is a fresh invite for a
   * different person and REPLACES it (see inviteOwnedByOther). Without `arrival` the invite is the cautious kind:
   * scheme, arrival unknown.
   */
  capture(raw: unknown, arrival?: { origin: InviteOrigin; signedInAtArrival: boolean | null; userIdAtArrival?: string | null }): boolean;
  /** Settle a null `signedInAtArrival` (a cold-start link) once the auth phase is known. A no-op once it is known. */
  settleArrival(signedIn: boolean): void;
  /**
   * Persist `triedJoin` BEFORE the join call. Resolves once written (or the write failed: the warning is logged).
   * With `forCode`, a no-op unless that code is STILL the pending invite (a run for an older link must not mark a newer one).
   * Resolves false when the write FAILED (the in-memory flag is set regardless): the caller still joins, and the fallback
   * after a relaunch is the silent open, not "You're in".
   */
  markTried(forCode?: string): Promise<boolean>;
  /**
   * Done with it (joined, refused with an explanation, dismissed, signed out). With `forCode`, a no-op unless that
   * code is STILL the pending invite: an older run's late answer must not wipe a newer link without a word.
   */
  clear(forCode?: string): Promise<void>;
  /** Fetch the preview again (after 'unavailable'; the person tapped). No loop: one call per request. */
  retryPreview(): void;
  /** The root layout opened the join screen for this code; it will not do so again this launch. */
  markAutoOpened(code: string): void;
}

export function createPendingInvite(deps: PendingInviteDeps): PendingInviteStore {
  let snap: InviteSnapshot = EMPTY;
  const listeners = new Set<() => void>();
  let fetchToken = 0;
  let writes: Promise<unknown> = Promise.resolve();
  let loading: Promise<void> | null = null;
  /** When the current invite was first captured (the TTL clock); persisted, survives a relaunch. */
  let capturedAt: number | null = null;

  function set(next: Partial<InviteSnapshot>): void {
    snap = { ...snap, ...next };
    listeners.forEach((l) => l());
  }

  /** Resolves true when the write landed, false when it failed (warned, never thrown). */
  function persist(): Promise<boolean> {
    const s = snap;
    const job = writes.then(async (): Promise<boolean> => {
      try {
        if (!s.code) {
          await deps.storage.remove();
        } else {
          const body: Persisted = { v: 1, code: s.code, capturedAt: capturedAt ?? deps.now(), leagueName: s.leagueName, triedJoin: s.triedJoin, ownerUserId: s.ownerUserId, origin: s.origin, signedInAtArrival: s.signedInAtArrival };
          await deps.storage.set(JSON.stringify(body));
        }
        return true;
      } catch {
        deps.warn('[invite] could not write the pending invite');
        return false;
      }
    });
    writes = job;
    return job;
  }

  function startPreview(code: string): void {
    const mine = ++fetchToken;
    set({ preview: { kind: 'loading' } });
    deps
      .fetchPreview(code)
      .catch((): InvitePreview => ({ kind: 'unavailable' }))
      .then((result) => {
        if (mine !== fetchToken || snap.code !== code) return; // the invite changed or was cleared meanwhile
        if (result.kind === 'found') {
          const changed = snap.leagueName !== result.name;
          set({ preview: result, leagueName: result.name });
          if (changed) void persist();
        } else {
          set({ preview: result });
        }
      });
  }

  return {
    getSnapshot: () => snap,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    load() {
      if (loading) return loading;
      loading = (async () => {
        let raw: string | null = null;
        try {
          raw = await deps.storage.get();
        } catch {
          deps.warn('[invite] could not read the pending invite');
        }
        if (snap.code) {
          // A link was captured while the read was in flight: it is newer than anything stored.
          set({ loaded: true });
          return;
        }
        const stored = parsePersisted(raw, deps.now());
        if (!stored) {
          set({ loaded: true });
          if (raw) void persist(); // junk or expired: remove it (snap.code is null, so persist() removes)
          return;
        }
        capturedAt = stored.capturedAt;
        set({ loaded: true, code: stored.code, leagueName: stored.leagueName, triedJoin: stored.triedJoin, ownerUserId: stored.ownerUserId, origin: stored.origin, signedInAtArrival: stored.signedInAtArrival });
        // Always ask again: the persisted copy has the league's name but not the inviter's, and the answer
        // (full, started) may have changed since the link was tapped.
        startPreview(stored.code);
      })();
      return loading;
    },
    capture(raw, arrival) {
      const code = normalizeInviteCode(raw);
      if (!code) return false;
      // The cold-start link arrives twice; nothing changes. Unless the pending one belongs to somebody else.
      if (snap.code === code && !inviteOwnedByOther(snap.ownerUserId, arrival)) return true;
      fetchToken += 1;
      capturedAt = deps.now();
      set({ code, leagueName: null, triedJoin: false, ownerUserId: null, origin: arrival?.origin ?? 'scheme', signedInAtArrival: arrival ? arrival.signedInAtArrival : null, preview: { kind: 'idle' }, autoOpenedCode: null });
      void persist();
      startPreview(code);
      return true;
    },
    markTried(forCode) {
      if (!snap.code || snap.triedJoin || (forCode !== undefined && snap.code !== forCode)) return writes.then(() => true);
      set({ triedJoin: true });
      return persist();
    },
    clear(forCode) {
      if (forCode !== undefined && snap.code !== forCode) return writes.then(() => undefined);
      fetchToken += 1;
      capturedAt = null;
      set({ code: null, leagueName: null, triedJoin: false, ownerUserId: null, origin: 'scheme', signedInAtArrival: null, preview: { kind: 'idle' }, autoOpenedCode: null });
      return persist().then(() => undefined);
    },
    retryPreview() {
      if (snap.code) startPreview(snap.code);
    },
    settleArrival(signedIn) {
      if (!snap.code || snap.signedInAtArrival !== null) return;
      set({ signedInAtArrival: signedIn });
      void persist();
    },
    claim(userId, forCode) {
      if (!snap.code || snap.ownerUserId !== null || !userId || (forCode !== undefined && snap.code !== forCode)) return;
      set({ ownerUserId: userId });
      void persist();
    },
    markAutoOpened(code) {
      if (snap.code === code && snap.autoOpenedCode !== code) set({ autoOpenedCode: code });
    },
  };
}
