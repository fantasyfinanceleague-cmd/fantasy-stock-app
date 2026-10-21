// Account deletion (W4) — the PENDING TAKEOVER: the one takeover link this device has not finished with.
//
// app/+native-intent.tsx captures /take/<code> here (a link is not a route, and a code must not travel as a router
// param: navigation state is persisted and logged). It survives sign-in, sign-up and the username step, and an app
// kill, exactly as a pending invite does (lib/invite/pendingInvite.ts has the reasoning), but it is much smaller:
// a takeover never joins by itself. The landing (app/takeover.tsx) shows the seat and waits for "Take the team", so
// there is no `triedJoin` and no origin; the capability is the person's tap. The record clears on every definitive
// answer (taken over, taken, dead, already a member) and on "Not now"; a transport failure keeps it, and nothing
// retries on its own. A link older than TAKEOVER_TTL_MS is dropped on load. It belongs to the person who tapped it:
// a different person signing in on the same phone does not inherit it (owner stamp, as for invites).
//
// Dependencies are injected so every branch is testable without React Native.

import { normalizeInviteCode } from './inviteLink';

export const TAKEOVER_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const TAKEOVER_STORAGE_KEY = 'sp.takeover.pending.v1';

export interface TakeoverSnapshot {
  loaded: boolean;
  code: string | null;
  /** The signed-in person it is stamped for (claim()), persisted; null until somebody signs in with it pending. */
  ownerUserId: string | null;
  /** The code the root layout already opened the landing for this launch (never persisted). */
  autoOpenedCode: string | null;
}

export interface TakeoverStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

export interface PendingTakeoverDeps {
  storage: TakeoverStorage;
  now(): number;
}

interface Persisted {
  v: 1;
  code: string;
  capturedAt: number;
  ownerUserId: string | null;
}

const EMPTY: TakeoverSnapshot = { loaded: false, code: null, ownerUserId: null, autoOpenedCode: null };

/** Reads what the store wrote; anything malformed, stale or hostile is null (and removed by the caller). */
export function parsePersistedTakeover(raw: string | null, now: number): Persisted | null {
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
  if (capturedAt === null || now - capturedAt > TAKEOVER_TTL_MS || capturedAt - now > 24 * 60 * 60 * 1000) return null;
  const owner = typeof o.ownerUserId === 'string' && o.ownerUserId.length > 0 && o.ownerUserId.length <= 64 ? o.ownerUserId : null;
  return { v: 1, code, capturedAt, ownerUserId: owner };
}

export function createPendingTakeover(deps: PendingTakeoverDeps) {
  let snap: TakeoverSnapshot = EMPTY;
  let capturedAt = 0;
  let generation = 0; // a capture/clear during load() makes the stale load result harmless
  const listeners = new Set<() => void>();

  const emit = (next: TakeoverSnapshot) => {
    snap = next;
    listeners.forEach((l) => l());
  };
  const persist = async () => {
    if (!snap.code) return;
    const rec: Persisted = { v: 1, code: snap.code, capturedAt, ownerUserId: snap.ownerUserId };
    try {
      await deps.storage.set(JSON.stringify(rec));
    } catch {
      // The in-memory copy still answers this launch; only a relaunch loses it.
    }
  };

  return {
    getSnapshot: () => snap,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    /** Reads the stored link once at startup. */
    async load(): Promise<void> {
      const gen = generation;
      let raw: string | null = null;
      try {
        raw = await deps.storage.get();
      } catch {
        raw = null;
      }
      if (gen !== generation) return; // something was captured or cleared meanwhile: it wins
      const p = parsePersistedTakeover(raw, deps.now());
      if (raw && !p) {
        try {
          await deps.storage.remove();
        } catch {
          // best effort
        }
      }
      capturedAt = p?.capturedAt ?? 0;
      emit({ loaded: true, code: p?.code ?? null, ownerUserId: p?.ownerUserId ?? null, autoOpenedCode: null });
    },
    /** A takeover link arrived. The newest link replaces an older one. Returns false for a code that fails the shape. */
    capture(rawCode: string): boolean {
      const code = normalizeInviteCode(rawCode);
      if (!code) return false;
      generation++;
      capturedAt = deps.now();
      emit({ loaded: true, code, ownerUserId: null, autoOpenedCode: null });
      void persist();
      return true;
    },
    /** Stamp the first person signed in with it pending. */
    claim(userId: string, forCode: string): void {
      if (!snap.code || snap.code !== forCode || snap.ownerUserId) return;
      emit({ ...snap, ownerUserId: userId });
      void persist();
    },
    markAutoOpened(forCode: string): void {
      if (snap.code === forCode) emit({ ...snap, autoOpenedCode: forCode });
    },
    /** Drops the link (a definitive answer, "Not now", or a different person). Only the code the caller saw. */
    async clear(forCode?: string): Promise<void> {
      if (forCode && snap.code !== forCode) return;
      generation++;
      capturedAt = 0;
      emit({ ...EMPTY, loaded: true });
      try {
        await deps.storage.remove();
      } catch {
        // best effort
      }
    },
  };
}

/**
 * Whether the landing opens now: in the full app ('ready': signed in, username done), a link pending, not opened yet
 * this launch, never while a password-recovery form holds the navigator, and it is this person's (the owner stamp
 * is claimed by the person it first meets; a different person on the same phone gets `clear`, not the seat).
 */
export function takeoverOwnerAction(ownerUserId: string | null, userId: string | null): 'claim' | 'clear' | 'none' {
  if (!userId) return 'none';
  if (!ownerUserId) return 'claim';
  return ownerUserId === userId ? 'none' : 'clear';
}

export function shouldOpenTakeover(args: {
  phase: 'unknown' | 'signedOut' | 'gated' | 'ready';
  code: string | null;
  autoOpenedCode: string | null;
  recoveryHold: boolean;
  ownerAction: 'claim' | 'clear' | 'none';
}): boolean {
  return args.phase === 'ready' && !!args.code && args.autoOpenedCode !== args.code && !args.recoveryHold && args.ownerAction === 'none';
}
