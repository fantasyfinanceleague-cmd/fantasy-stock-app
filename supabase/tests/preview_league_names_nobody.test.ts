/**
 * AMENDED 2026-10-14 (Onboarding W3, decision 7): the preview now names the INVITER (the commissioner's
 * username) for a code that resolved to a league, and nobody else. The handler (index.ts) STILL looks no one
 * up itself: the single profile read lives in ./inviter.ts, whose reader is pinned below to one column of one
 * row. Everything the 2026-10-11 ruling forbade stays forbidden: other members, emails, ids.
 *
 * Giorgio, 2026-10-11 (board #call-join-commissioner A): the Join preview names
 * nobody before you join, not even the commissioner. Ruling A (2026-10-08): "we
 * cannot allow a user to see any information outside of the name/avatar of
 * another member in their league (email, etc) or any info about users not in
 * their league." A preview caller is, by definition, not in the league yet.
 *
 * preview-league's shape tests pin previewLeagueBody's keys; this pins the
 * handler around it (supabase-reviewer 2026-10-11): it must not look anyone up,
 * and its one success response must be exactly previewLeagueBody(...), so a
 * name can't be attached outside the shaped body.
 * Run: deno test --allow-read --allow-env supabase/tests/
 */
import { assertEquals } from 'jsr:@std/assert';

const src = Deno.readTextFileSync('supabase/functions/preview-league/index.ts');
// (a "//" inside "https://..." is not a comment: strip only a // that is not preceded by ':')
const code = src.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

Deno.test('preview-league reads no profile: no user_profiles, no display-name helper', () => {
  assertEquals(/user_profiles|display_name|participant_display_name|get_visible_profiles|username/.test(code), false);
});

Deno.test("preview-league's success response is exactly previewLeagueBody(...)", () => {
  // One response per line in this handler: capture everything between `json(` and the final `, 200)`.
  const found = [...code.matchAll(/return json\((.*),\s*200\s*\);?\s*$/gm)].map((m) => m[1].trim());
  // The two 200s: the not-found body, and the shaped preview.
  assertEquals(found.filter((f) => f.startsWith('previewLeagueBody(')).length, 1, JSON.stringify(found));
  assertEquals(found.filter((f) => !f.startsWith('previewLeagueBody(') && !/^\{\s*found:\s*false/.test(f)), [], JSON.stringify(found));
});

const inviter = Deno.readTextFileSync('supabase/functions/preview-league/inviter.ts').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

Deno.test('W3: the only profile read in preview-league is inviter.ts: one column (username), one row (by id)', () => {
  assertEquals((inviter.match(/\.from\(/g) ?? []).length, 1);
  assertEquals(/\.from\('user_profiles'\)\.select\('username'\)\.eq\('id', id\)\.maybeSingle\(\)/.test(inviter), true);
  // never a wildcard, an email, an avatar, or a member list
  assertEquals(/select\('\*'\)|email|avatar|league_members|get_visible_profiles|get_league_display_names/.test(inviter), false);
});

Deno.test('W3: the handler reaches inviter.ts only for a resolved code, and never for an expired invite', () => {
  assertEquals(/isInviteExpired\(invite \? \{ status: invite\.status, expiresAt: invite\.expires_at \} : null, new Date\(\)\)\s*\?\s*null/.test(code), true);
  assertEquals(/reason === 'invite_expired'\s*\?\s*null/.test(code), false, 'tested on the invite itself, not on the reason order');
  assertEquals(/lookupInviter\(league\.commissioner_id, inviterReader\(admin\)\)/.test(code), true);
  // not-found returns before any lookup
  assertEquals(code.indexOf("found: false") < code.indexOf('lookupInviter('), true);
});
