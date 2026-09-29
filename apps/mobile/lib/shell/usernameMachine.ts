// Phase 3b-1 — the Pick-a-username state machine (spec row 8 + S6).
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically.
// The screen feeds it events and renders `usernameView(state)`; every
// network call's result comes back as an event tagged with the sequence
// number it was issued under, so a slow answer for an OLD input can never
// overwrite the state of the current one.
//
// The server is the truth (set_username / check_usernames, 20261007000000):
// the local checks only avoid asking about input that can't possibly pass.
// "Taken" is case-insensitive on the server; the client never decides it.

import { firstFailingRule, USERNAME_RE, usernameRuleChecks, type UsernameRuleCheck } from './usernameRules';

export const MSG_TAKEN = 'This username is already taken.';
export const MSG_NOT_ALLOWED = 'Username is not allowed';
export const MSG_CHECK_FAILED = "Couldn't check right now";

export type ServerStatus = 'available' | 'taken' | 'invalid';

export type UsernameState =
  | { kind: 'empty'; seq: number }
  /** The format or content check fails locally; nothing is sent. */
  | { kind: 'local-invalid'; seq: number; candidate: string; message: string }
  /** Edit mode: identical to the current username, so there is nothing to save. */
  | { kind: 'unchanged'; seq: number; candidate: string }
  | { kind: 'checking'; seq: number; candidate: string }
  | { kind: 'available'; seq: number; candidate: string }
  | { kind: 'taken'; seq: number; candidate: string; suggestions: string[] }
  | { kind: 'server-invalid'; seq: number; candidate: string; message: string }
  /** The availability check itself failed; Continue stays enabled (server decides on submit). */
  | { kind: 'check-failed'; seq: number; candidate: string }
  | { kind: 'submitting'; seq: number; candidate: string }
  | { kind: 'saved'; seq: number; candidate: string };

export type UsernameEvent =
  /** The field changed. `contentOk` is the client content check (lib/contentModeration). */
  | { type: 'input'; value: string; contentOk: boolean; current: string | null }
  | { type: 'check-result'; seq: number; status: ServerStatus; suggestions?: string[] }
  | { type: 'check-failed'; seq: number }
  | { type: 'submit' }
  | { type: 'submit-result'; seq: number; result: 'ok' | 'taken' | 'invalid'; suggestions?: string[] }
  | { type: 'submit-failed'; seq: number };

export const initialUsernameState: UsernameState = { kind: 'empty', seq: 0 };

/** Continue is enabled when the name could be saved: known available, or unknown because the check failed. */
export function canSubmit(state: UsernameState): boolean {
  return state.kind === 'available' || state.kind === 'check-failed';
}

export function usernameReducer(state: UsernameState, event: UsernameEvent): UsernameState {
  switch (event.type) {
    case 'input': {
      const seq = state.seq + 1;
      const candidate = event.value.trim();
      if (!candidate) return { kind: 'empty', seq };
      const failing = firstFailingRule(candidate);
      if (failing) return { kind: 'local-invalid', seq, candidate, message: failing };
      if (!event.contentOk) return { kind: 'local-invalid', seq, candidate, message: MSG_NOT_ALLOWED };
      // Exactly the current name: nothing to save. A case-only change IS a
      // change (set_username's taken check excludes the caller's own row).
      if (event.current !== null && candidate === event.current) return { kind: 'unchanged', seq, candidate };
      return { kind: 'checking', seq, candidate };
    }

    case 'check-result': {
      if (state.kind !== 'checking' || event.seq !== state.seq) return state; // stale
      const { seq, candidate } = state;
      if (event.status === 'available') return { kind: 'available', seq, candidate };
      if (event.status === 'taken') return { kind: 'taken', seq, candidate, suggestions: (event.suggestions ?? []).slice(0, 3) };
      return { kind: 'server-invalid', seq, candidate, message: firstFailingRule(candidate) ?? MSG_NOT_ALLOWED };
    }

    case 'check-failed':
      if (state.kind !== 'checking' || event.seq !== state.seq) return state;
      return { kind: 'check-failed', seq: state.seq, candidate: state.candidate };

    case 'submit':
      if (!canSubmit(state)) return state;
      return { kind: 'submitting', seq: state.seq, candidate: (state as { candidate: string }).candidate };

    case 'submit-result': {
      if (state.kind !== 'submitting' || event.seq !== state.seq) return state;
      const { seq, candidate } = state;
      if (event.result === 'ok') return { kind: 'saved', seq, candidate };
      if (event.result === 'taken') return { kind: 'taken', seq, candidate, suggestions: (event.suggestions ?? []).slice(0, 3) };
      return { kind: 'server-invalid', seq, candidate, message: firstFailingRule(candidate) ?? MSG_NOT_ALLOWED };
    }

    case 'submit-failed':
      if (state.kind !== 'submitting' || event.seq !== state.seq) return state;
      return { kind: 'check-failed', seq: state.seq, candidate: state.candidate };
  }
}

export type TrailingIcon = 'none' | 'checking' | 'available' | 'taken';

export interface UsernameView {
  /** Shown under the field; errors in `danger`, instantly (§4). */
  error: string | null;
  /** Non-error status line (the check failure is advisory, not an error). */
  note: string | null;
  trailing: TrailingIcon;
  rules: UsernameRuleCheck[];
  suggestions: string[];
  canContinue: boolean;
  busy: boolean;
}

export function usernameView(state: UsernameState): UsernameView {
  const candidate = state.kind === 'empty' ? '' : state.candidate;
  const base: UsernameView = {
    error: null,
    note: null,
    trailing: 'none',
    rules: usernameRuleChecks(candidate),
    suggestions: [],
    canContinue: canSubmit(state),
    busy: state.kind === 'submitting',
  };
  switch (state.kind) {
    case 'local-invalid':
    case 'server-invalid':
      return { ...base, error: state.message, trailing: 'taken' };
    case 'checking':
      return { ...base, trailing: 'checking' };
    case 'available':
    case 'saved':
      return { ...base, trailing: 'available' };
    case 'taken':
      return { ...base, error: MSG_TAKEN, trailing: 'taken', suggestions: state.suggestions };
    case 'check-failed':
      return { ...base, note: MSG_CHECK_FAILED };
    case 'submitting':
      return { ...base, trailing: 'available' };
    default:
      return base;
  }
}

// ── Suggestions ──────────────────────────────────────────────────────────

const MAX_LEN = 20;

/** Reduce any text to the username alphabet: spaces/dots/dashes → "_", everything else dropped. */
export function sanitizeUsernameBase(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s.\-]+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function fit(base: string, suffix: string): string {
  return base.slice(0, MAX_LEN - suffix.length) + suffix;
}

/**
 * Up to 9 distinct, format-valid candidates for check_usernames (its cap is
 * 10), derived from what the user typed and, when available, their email's
 * local part. Deterministic for a given `seed` (e.g. the two-digit year), so
 * the same input always offers the same names. The taken name itself is
 * never offered back, in any case.
 */
export function usernameSuggestions(typed: string, emailLocal: string | null, seed: number): string[] {
  const base = sanitizeUsernameBase(typed) || sanitizeUsernameBase(emailLocal ?? '') || 'player';
  const alt = sanitizeUsernameBase(emailLocal ?? '');
  const yy = String(Math.abs(seed) % 100).padStart(2, '0');
  const raw = [
    fit(base, `_${yy}`),
    fit(base, yy),
    alt && alt.toLowerCase() !== base.toLowerCase() ? fit(alt, '') : '',
    fit(base, '_1'),
    alt ? fit(alt, `_${yy}`) : '',
    fit(base, `_${(Math.abs(seed) % 9) + 2}`),
    fit(base, '_fs'),
    fit(base, `${yy}_`),
    fit(base, '_x'),
    fit(base, '_hq'),
  ];
  const taken = typed.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of raw) {
    const key = c.toLowerCase();
    if (!c || key === taken || seen.has(key) || !USERNAME_RE.test(c)) continue;
    seen.add(key);
    out.push(c);
    if (out.length === 9) break;
  }
  return out;
}

/** The first `n` candidates the server reported available, in the order they were offered. */
export function pickAvailable(candidates: string[], rows: { username: string; status: string }[], n = 3): string[] {
  const available = new Set(rows.filter((r) => r.status === 'available').map((r) => r.username));
  return candidates.filter((c) => available.has(c)).slice(0, n);
}
