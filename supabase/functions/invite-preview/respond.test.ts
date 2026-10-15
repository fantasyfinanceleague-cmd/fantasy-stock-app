// Hermetic tests for invite-preview's pure half (see ./respond.ts). No DB, no secrets; one source scan reads index.ts.
//   deno test --allow-read supabase/functions/invite-preview/respond.test.ts
//
// What they pin: the disclosure surface (EXACTLY {found,name,inviter,reason}); the one generic refusal shape;
// the reason ladder (the T-1h rule via preview-league's own function); the client-IP choice; the CORS origin.

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { ROOM_OPEN_LEAD_SECONDS } from '../_shared/draft-start-policy.ts';
import { WEB_ORIGIN } from '../_shared/web-origin.ts';
import { clientIp, corsHeaders, INVITER_MAX, LIMIT_KEYS, normalizeCode, normalizeIp, RESPONSE_FLOOR_MS, toResponse } from './respond.ts';

const NOW = new Date('2026-10-20T12:00:00Z');

function found(over: Record<string, unknown> = {}) {
  return {
    status: 'found',
    name: 'Stock Scudetto',
    inviter: 'Roberto',
    season_status: 'active',
    draft_status: 'not_started',
    draft_date: null,
    current_members: 3,
    num_participants: 8,
    ...over,
  };
}

Deno.test('a joinable league: exactly {found, name, inviter, reason: null}', () => {
  const r = toResponse(found(), NOW);
  assertEquals(r, { status: 200, body: { found: true, name: 'Stock Scudetto', inviter: 'Roberto', reason: null } });
  assertEquals(Object.keys(r.body).sort(), ['found', 'inviter', 'name', 'reason']);
});

Deno.test('NOTHING else from the lookup reaches the response: counts, dates, ids, stakes, codes', () => {
  const leaky = found({
    id: 'a1', league_id: 'a1', commissioner_id: 'u1', invite_code: 'K7Q2XRM3PA', stake_mode: 'cash',
    members: ['x', 'y'], draft_date: '2026-10-25T18:00:00Z', email: 'r@example.com',
  });
  const text = JSON.stringify(toResponse(leaky, NOW).body);
  for (const forbidden of ['a1', 'u1', 'K7Q2XRM3PA', 'cash', 'r@example.com', '2026-10-25', '"current_members"', '"num_participants"', 'draft_date']) {
    assertFalse(text.includes(forbidden), `${forbidden} leaked: ${text}`);
  }
});

Deno.test('not_found is ONE byte-identical shape, whatever the SQL said about why', () => {
  const a = JSON.stringify(toResponse({ status: 'not_found' }, NOW));
  const b = JSON.stringify(toResponse({ status: 'not_found', why: 'expired', league: 'x' }, NOW));
  assertEquals(a, '{"status":200,"body":{"found":false}}');
  assertEquals(b, a);
});

Deno.test('rate_limited is a 429 with no detail; the limit key is for the LOG only and never reaches the body', () => {
  assertEquals(toResponse({ status: 'rate_limited', hits: 31 }, NOW), { status: 429, body: { error: 'rate_limited' }, limit: undefined });
  const bodies = new Set<string>();
  for (const limit of LIMIT_KEYS) {
    const r = toResponse({ status: 'rate_limited', limit }, NOW);
    assertEquals(r.status, 429);
    assertEquals(r.limit, limit);
    bodies.add(JSON.stringify(r.body));
  }
  assertEquals([...bodies], ['{"error":"rate_limited"}'], 'every cause answers with the same bytes');
  // an unknown / hostile key is dropped (the log line only ever carries a fixed value)
  for (const bad of ['x', '<script>', 7, null, {}, 'ip\nFORGED LOG LINE']) assertEquals(toResponse({ status: 'rate_limited', limit: bad }, NOW).limit, undefined);
});

Deno.test('inviter is capped: a username is 3-20 characters, so anything over 40 reads as no name', () => {
  assertEquals(INVITER_MAX, 40);
  assertEquals(toResponse(found({ inviter: 'x'.repeat(40) }), NOW).body.inviter, 'x'.repeat(40));
  assertEquals(toResponse(found({ inviter: 'x'.repeat(41) }), NOW).body.inviter, null);
  assertEquals(toResponse(found({ inviter: ` ${'x'.repeat(40)} ` }), NOW).body.inviter, 'x'.repeat(40), 'measured after trimming');
  assertEquals(toResponse(found({ inviter: 'y'.repeat(5000) }), NOW).body.inviter, null);
});

Deno.test('anything unexpected is a 500, never a half-built 200', () => {
  for (const bad of [null, undefined, 'found', 7, [], {}, { status: 'weird' }, { status: 'found' }, found({ name: '' }), found({ name: 5 }),
    found({ season_status: null }), found({ current_members: 'many' })]) {
    assertEquals(toResponse(bad, NOW), { status: 500, body: { error: 'unavailable' } }, JSON.stringify(bad));
  }
});

Deno.test('inviter: a username, or null when blank or absent', () => {
  assertEquals(toResponse(found({ inviter: null }), NOW).body.inviter, null);
  assertEquals(toResponse(found({ inviter: '   ' }), NOW).body.inviter, null);
  assertEquals(toResponse(found({ inviter: 7 }), NOW).body.inviter, null);
  assertEquals(toResponse(found({ inviter: ' Roberto ' }), NOW).body.inviter, 'Roberto');
});

Deno.test('reasons: full, started, over (and the precedence), computed by preview-league\'s own function', () => {
  assertEquals(toResponse(found({ current_members: 8 }), NOW).body.reason, 'league_full');
  assertEquals(toResponse(found({ draft_status: 'in_progress' }), NOW).body.reason, 'draft_started');
  assertEquals(toResponse(found({ draft_status: 'completed' }), NOW).body.reason, 'draft_started');
  assertEquals(toResponse(found({ season_status: 'completed', draft_status: 'completed' }), NOW).body.reason, 'season_completed');
  // started beats full
  assertEquals(toResponse(found({ draft_status: 'in_progress', current_members: 8 }), NOW).body.reason, 'draft_started');
});

Deno.test('T-1h: an open draft room refuses (Giorgio 2026-10-14), a room an instant from opening does not', () => {
  const at = (secondsAhead: number) => new Date(NOW.getTime() + secondsAhead * 1000).toISOString();
  assertEquals(toResponse(found({ draft_date: at(ROOM_OPEN_LEAD_SECONDS - 1) }), NOW).body.reason, 'draft_started');
  assertEquals(toResponse(found({ draft_date: at(ROOM_OPEN_LEAD_SECONDS + 60) }), NOW).body.reason, null);
  assertEquals(toResponse(found({ draft_date: null }), NOW).body.reason, null); // postponed: joinable again
});

Deno.test('normalizeCode: the shape, and nothing odd survives', () => {
  assertEquals(normalizeCode(' k7q2xrm3pa '), 'K7Q2XRM3PA');
  assertEquals(normalizeCode('ABCD'), 'ABCD');
  assertEquals(normalizeCode('A1B2C3'), 'A1B2C3'); // a legacy 6-character code
  for (const bad of ['ııııı', 'ßßßß', 'ſſſſſ', 'ab\u0131cd']) assertEquals(normalizeCode(bad), null, bad); // fold onto ASCII when upper-cased
  for (const bad of ['', 'ABC', 'A'.repeat(13), 'AB-CD', 'AB CD', "AB'CD", 'AB%20CD', 'ÅBCDE', '../../x', 'ABCD\nEF', 7, null, undefined, {}, ['ABCD']]) {
    assertEquals(normalizeCode(bad as unknown), null, String(bad));
  }
});

Deno.test('clientIp: cf-connecting-ip, else the RIGHT-most forwarded hop, else \'\'', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assertEquals(clientIp(h({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4' })), '203.0.113.9');
  // a client-prepended hop is the LEFT one; the proxy-appended is the right-most
  assertEquals(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' })), '198.51.100.7');
  assertEquals(clientIp(h({})), '');
  assertEquals(clientIp(h({ 'x-forwarded-for': 'not an ip!' })), '');
  assertEquals(clientIp(h({ 'x-forwarded-for': '2001:db8::1' })), '2001:db8:0:0::/64');
  assertEquals(clientIp(h({ 'cf-connecting-ip': '<script>' })), '');
});

Deno.test('CORS: the web origin and localhost; no other origin is echoed (not even another *.vercel.app)', () => {
  assertEquals(corsHeaders(WEB_ORIGIN)['Access-Control-Allow-Origin'], WEB_ORIGIN);
  assertEquals(corsHeaders('http://localhost:5173')['Access-Control-Allow-Origin'], 'http://localhost:5173');
  for (const o of ['https://evil.vercel.app', 'https://fantasy-stock-app.vercel.app.evil.com', 'http://localhost.evil.com', 'http://localhost', 'null', '']) {
    assertEquals(corsHeaders(o)['Access-Control-Allow-Origin'], WEB_ORIGIN, o);
  }
});

Deno.test('every response is held to a fixed floor', () => {
  assert(RESPONSE_FLOOR_MS >= 300);
  const src = Deno.readTextFileSync(new URL('./index.ts', import.meta.url)).replace(/\/\/.*$/gm, '');
  // every return path goes through finish(), which pads; the only exception is the CORS preflight
  const returns = [...src.matchAll(/return\s+(?!new Response\('ok')([^;]+);/g)].map((m) => m[1].trim());
  assert(returns.length > 0);
  for (const r of returns) assert(r.startsWith('finish(') || r.startsWith('new Response(JSON.stringify'), r);
  // ...and finish() really waits out the rest of the floor before it answers (found, refused and limited alike)
  const fin = src.slice(src.indexOf('async function finish'), src.indexOf('if (req.method === \'OPTIONS\')'));
  assert(fin.includes('RESPONSE_FLOOR_MS - (Date.now() - started)'), 'the floor is measured from the request start');
  assert(fin.includes('if (wait > 0) await sleep(wait);'), 'and slept');
  assert(fin.indexOf('await sleep(wait)') < fin.indexOf('return new Response('), 'before the response is built');
});

Deno.test('the lookup + the limiter are ONE database call (a hit and a miss cost the same round trip), and the RPC gets the normalised code', () => {
  const src = Deno.readTextFileSync(new URL('./index.ts', import.meta.url)).replace(/\/\/.*$/gm, '');
  assertEquals((src.match(/\.rpc\(/g) ?? []).length, 1);
  assert(src.includes("admin.rpc('invite_preview_lookup', { p_code: code, p_ip: clientIp(req.headers) })"));
  assert(src.includes("normalizeCode((body as { code?: unknown } | null)?.code) ?? ''"));
  assertEquals((src.match(/\.from\(/g) ?? []).length, 0, 'no table read outside the RPC');
  assertEquals(/getUser|Authorization|auth\./.test(src), false, 'no session is read at all');
});

Deno.test('normalizeIp: IPv4 as is, a port stripped, junk and look-alikes refused', () => {
  assertEquals(normalizeIp('203.0.113.9'), '203.0.113.9');
  assertEquals(normalizeIp(' 203.0.113.9 '), '203.0.113.9');
  assertEquals(normalizeIp('203.0.113.9:51234'), '203.0.113.9');
  for (const bad of ['', 'x', '999.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.04', '1.2.3.4:', '1.2.3.4:abc', '1.2.3.4/24', 'localhost', '<script>', '1.2.3.4 5.6.7.8', "1.2.3.4'; drop", '::::', '1:2:3', '12345::1', 'g::1']) {
    assertEquals(normalizeIp(bad), '', bad);
  }
});

Deno.test('normalizeIp: an IPv6 client is bucketed by its /64, so a whole prefix cannot mint fresh buckets', () => {
  const a = normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
  assertEquals(a, '2001:db8:1:2::/64');
  assertEquals(normalizeIp('2001:db8:1:2::1'), a);
  assertEquals(normalizeIp('2001:DB8:1:2:ffff:ffff:ffff:ffff'), a);
  assertEquals(normalizeIp('2001:0db8:0001:0002:0000:0000:0000:0001'), a);
  assertEquals(normalizeIp('[2001:db8:1:2::1]:443'), a);
  assertEquals(normalizeIp('[2001:db8:1:2::1]'), a);
  assertEquals(normalizeIp('2001:db8:1:2::1%eth0'), a);
  assert(normalizeIp('2001:db8:1:3::1') !== a, 'a different /64 is a different bucket');
  assertEquals(normalizeIp('::1'), '0:0:0:0::/64');
  assertEquals(normalizeIp('2001:db8::'), '2001:db8:0:0::/64');
  assertEquals(normalizeIp('2001:db8:1:2:3:4:5:6:7'), '', 'nine groups');
  assertEquals(normalizeIp('2001:db8::1::2'), '', 'two ::');
  assertEquals(normalizeIp('1:2:3:4:5:6:7::'), '1:2:3:4::/64', 'a :: standing for one group');
});

Deno.test('normalizeIp: IPv4-mapped IPv6 is the IPv4 address (one client, one bucket)', () => {
  assertEquals(normalizeIp('::ffff:203.0.113.9'), '203.0.113.9');
  assertEquals(normalizeIp('::ffff:cb00:7109'), '203.0.113.9');
  assertEquals(normalizeIp('0:0:0:0:0:ffff:203.0.113.9'), '203.0.113.9');
  assertEquals(normalizeIp('::ffff:999.0.113.9'), '');
});

Deno.test('clientIp: normalised, so a port or an IPv6 address cannot dodge the per-address limits', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assertEquals(clientIp(h({ 'cf-connecting-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' })), '2001:db8:1:2::/64');
  assertEquals(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7:4711' })), '198.51.100.7');
  assertEquals(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 2001:db8:1:2::9' })), '2001:db8:1:2::/64');
  // an unparseable cf header falls through to the forwarded hop; a garbage hop is ''
  assertEquals(clientIp(h({ 'cf-connecting-ip': 'junk', 'x-forwarded-for': '198.51.100.7' })), '198.51.100.7');
  assertEquals(clientIp(h({ 'x-forwarded-for': '198.51.100.7, junk' })), '');
});

Deno.test('a failing lookup is VISIBLE in the function logs (the client degrades quietly by design): the error code only', () => {
  const src = Deno.readTextFileSync(new URL('./index.ts', import.meta.url)).replace(/\/\/.*$/gm, '');
  assert(src.includes("console.error('invite-preview: lookup rpc failed', outcome.code);"));
  assert(src.includes("console.error('invite-preview: unexpected lookup result');"));
  assert(src.includes("console.error('invite-preview: unhandled', e instanceof Error ? e.name : typeof e);"));
  // never the invite code, the address, the error message text, or the headers
  for (const m of src.matchAll(/console\.error\(([^;]*)\);/g)) {
    assertEquals(/\bcode\b|\.message|clientIp|headers|body|data\b/.test(m[1].replace('outcome.code', '')), false, m[1]);
  }
});

Deno.test('a tripped limit is VISIBLE in the logs with its key, and the key never goes to the client', () => {
  const src = Deno.readTextFileSync(new URL('./index.ts', import.meta.url)).replace(/\/\/.*$/gm, '');
  assert(src.includes("if (shaped.status === 429) console.warn('invite-preview: limited', shaped.limit ?? 'unknown');"));
  // finish() sends shaped.body only (the limit lives on Shaped, outside the body)
  assert(src.includes('JSON.stringify(shaped.body)'));
  assertEquals(/JSON\.stringify\(shaped\)|\.\.\.shaped/.test(src), false);
});
