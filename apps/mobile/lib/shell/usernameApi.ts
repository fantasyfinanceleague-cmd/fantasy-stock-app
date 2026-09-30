// Phase 3b-1 — the two username RPCs (20261007000000), wrapped.
//
// supabase-js resolves a Postgres error as { data, error } instead of
// throwing (CLAUDE.md, success-signal #5), so every call destructures and
// checks `error`; a transport failure is caught separately. Either way the
// caller gets `null` for "couldn't find out" — never a guessed status.
//
// In the DEV fixture (lib/shell/devFixture.ts) the same semantics run
// locally: case-insensitive taken, the caller's own name available, format
// per the server's regex. Nothing is sent.

import { supabase } from '../supabase';
import { SHELL_FIXTURE, FIXTURE_NETWORK_MS, fixtureCheckUsernames, fixtureSetUsername } from './devFixture';
import type { ServerStatus } from './usernameMachine';

export interface CheckRow {
  username: string;
  status: ServerStatus;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** check_usernames (max 10). null when the check itself failed. */
export async function checkUsernames(candidates: string[]): Promise<CheckRow[] | null> {
  if (SHELL_FIXTURE) {
    await wait(FIXTURE_NETWORK_MS / 2);
    return fixtureCheckUsernames(candidates);
  }
  try {
    const { data, error } = await supabase.rpc('check_usernames', { p_candidates: candidates.slice(0, 10) });
    if (error) {
      console.warn('[username] check_usernames failed', error.message);
      return null;
    }
    return (data ?? []) as CheckRow[];
  } catch (e) {
    console.warn('[username] check_usernames transport error', e);
    return null;
  }
}

/** set_username for the caller. null when the call failed (the outcome is unknown). */
export async function setUsername(name: string): Promise<'ok' | 'taken' | 'invalid' | null> {
  if (SHELL_FIXTURE) {
    await wait(FIXTURE_NETWORK_MS);
    return fixtureSetUsername(name);
  }
  try {
    const { data, error } = await supabase.rpc('set_username', { p_username: name });
    if (error) {
      console.warn('[username] set_username failed', error.message);
      return null;
    }
    return data === 'ok' || data === 'taken' || data === 'invalid' ? data : null;
  } catch (e) {
    console.warn('[username] set_username transport error', e);
    return null;
  }
}
