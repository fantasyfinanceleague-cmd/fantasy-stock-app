/**
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
const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

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
