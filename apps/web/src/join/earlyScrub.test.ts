// The pre-module script in index.html, run for real (extracted from the file,
// executed in jsdom): the confirm link's code and errors leave the URL before
// any bundle code runs, the outcome is "confirmed" only for a code with no
// error, and /join + /auth/confirm get no-referrer.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readConfirmOutcome } from './confirmOutcome';

// vitest runs from apps/web (jsdom's import.meta.url is not a file URL).
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

function run(url: string, priorState: unknown = null) {
  delete (window as unknown as Record<string, unknown>).__stockpileAuthConfirm;
  delete (window as unknown as Record<string, unknown>).__stockpileWebCallback;
  window.history.replaceState(priorState, '', url);
  document.head.querySelectorAll('meta[name="referrer"]').forEach((m) => m.remove());
  new Function(scripts[0])();
  return {
    path: window.location.pathname + window.location.search + window.location.hash,
    outcome: readConfirmOutcome(window.history.state),
    referrer: document.head.querySelector('meta[name="referrer"]')?.getAttribute('content') ?? null,
    held: (window as unknown as { __stockpileAuthConfirm?: { code: string | null; invite: string | null } }).__stockpileAuthConfirm ?? null,
  };
}

const strip = ({ path, outcome, referrer }: ReturnType<typeof run>) => ({ path, outcome, referrer });
const CODE = '9f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

describe('index.html carries exactly one inline script, before the module bundle', () => {
  it('is in <head>, ahead of the module script', () => {
    expect(scripts).toHaveLength(1);
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('type="module"'));
  });
});

describe('/auth/confirm', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('a code and no error: confirmed, and the code is gone from the URL', () => {
    const r = run(`/auth/confirm?code=${CODE}`);
    expect({ path: r.path, outcome: r.outcome, referrer: r.referrer }).toEqual({ path: '/auth/confirm', outcome: 'confirmed', referrer: 'no-referrer' });
    expect(window.location.href).not.toContain(CODE);
    expect(JSON.stringify(window.history.state)).not.toContain(CODE);
    expect(document.documentElement.outerHTML).not.toContain(CODE);
  });

  it.each([
    ['query error (expired link)', '/auth/confirm?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'],
    ['hash error', '/auth/confirm#error=access_denied&error_code=otp_expired&error_description=x'],
    ['error_description only', '/auth/confirm#error_description=x'],
    ['error_code only', '/auth/confirm?error_code=otp_expired'],
    ['a code AND an error (never a false success)', `/auth/confirm?code=${CODE}#error=server_error`],
  ])('%s: error, never confirmed, URL cleaned', (_label, url) => {
    expect(strip(run(url))).toEqual({ path: '/auth/confirm', outcome: 'error', referrer: 'no-referrer' });
  });

  it.each([
    ['no params (typed URL)', '/auth/confirm'],
    ['an empty code', '/auth/confirm?code='],
    ['tokens instead of a code (not our PKCE flow)', '/auth/confirm#access_token=abc&refresh_token=def'],
  ])('%s: none, URL cleaned', (_label, url) => {
    expect(strip(run(url))).toEqual({ path: '/auth/confirm', outcome: 'none', referrer: 'no-referrer' });
  });

  it.each([
    ['too short', 'abc'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['spaces', 'not a real code at all'],
    ['too long', 'a'.repeat(201)],
    ['a path', '../../etc/passwd'],
  ])('a code that is not token-shaped (%s) is no code: nothing confirmed, nothing held', (_label, junk) => {
    const r = run(`/auth/confirm?code=${encodeURIComponent(junk)}`);
    expect(r.outcome).toBe('none');
    expect(r.held).toEqual({ code: null, invite: null });
    expect(r.path).toBe('/auth/confirm');
  });

  it('the shapes real codes take are accepted (a UUID, and a longer opaque token)', () => {
    expect(run('/auth/confirm?code=9f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b').outcome).toBe('confirmed');
    expect(run('/auth/confirm?code=' + 'Ab1._~-'.repeat(20)).outcome).toBe('confirmed');
  });

  it('drops every other param too (e.g. an invite code)', () => {
    expect(run(`/auth/confirm?invite=ABCDE23456&code=${CODE}`).path).toBe('/auth/confirm');
  });

  it('keeps the code and the invite IN MEMORY only, off the URL, state, storage and DOM', () => {
    const r = run(`/auth/confirm?invite=ABCDE23456&code=${CODE}`);
    expect(r.held).toEqual({ code: CODE, invite: 'ABCDE23456' });
    expect(Object.keys(window)).not.toContain('__stockpileAuthConfirm'); // not enumerable
    expect(Object.isFrozen(r.held)).toBe(true);
    expect(window.location.href).not.toContain(CODE);
    expect(JSON.stringify(window.history.state)).not.toContain(CODE);
    expect(JSON.stringify(window.history.state)).not.toContain('ABCDE23456');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(CODE);
    expect(document.documentElement.outerHTML).not.toContain(CODE);
  });

  it('holds nothing for an error link, a no-code visit or a reload', () => {
    expect(run('/auth/confirm?error=access_denied&invite=ABCDE23456').held).toEqual({ code: null, invite: null });
    expect(run('/auth/confirm?invite=ABCDE23456').held).toEqual({ code: null, invite: null });
    expect(run('/auth/confirm', { authConfirm: 'confirmed' }).held).toEqual({ code: null, invite: null });
  });

  it.each(['/Auth/Confirm', '/AUTH/CONFIRM/', '/auth/%63onfirm', '/auth/Con%46irm'])('%s is the same page as /auth/confirm (the router matches it)', (path) => {
    const r = run(`${path}?code=${CODE}`);
    expect(strip(r)).toEqual({ path: '/auth/confirm', outcome: 'confirmed', referrer: 'no-referrer' });
    expect(r.held?.code).toBe(CODE);
  });

  it('a path that is not /auth/confirm, however spelled, is left alone', () => {
    expect(run(`/auth/confirmx?code=${CODE}`).held).toBeNull();
    expect(run(`/auth/confirm/extra?code=${CODE}`).path).toBe(`/auth/confirm/extra?code=${CODE}`);
  });

  it('a trailing slash is the same page', () => {
    expect(strip(run(`/auth/confirm/?code=${CODE}`))).toEqual({ path: '/auth/confirm', outcome: 'confirmed', referrer: 'no-referrer' });
  });

  it('a reload keeps the outcome (history state), a stale code-less visit does not invent one', () => {
    expect(run('/auth/confirm', { authConfirm: 'confirmed' }).outcome).toBe('confirmed');
    expect(run('/auth/confirm', { authConfirm: 'error' }).outcome).toBe('error');
    expect(run('/auth/confirm', { authConfirm: 'bogus' }).outcome).toBe('none');
  });

  it('a new link wins over an older outcome in state', () => {
    expect(run('/auth/confirm?error=access_denied', { authConfirm: 'confirmed' }).outcome).toBe('error');
    expect(run(`/auth/confirm?code=${CODE}`, { authConfirm: 'error' }).outcome).toBe('confirmed');
  });
});

type Held = { code: string | null; invite: string | null; via: string; error: false | string };
const heldCallback = () => (window as unknown as { __stockpileWebCallback?: Held }).__stockpileWebCallback ?? null;
const runCallback = (url: string, priorState: unknown = null) => {
  delete (window as unknown as Record<string, unknown>).__stockpileWebCallback;
  delete (window as unknown as Record<string, unknown>).__stockpileAuthConfirm;
  window.history.replaceState(priorState, '', url);
  document.head.querySelectorAll('meta[name="referrer"]').forEach((mm) => mm.remove());
  new Function(scripts[0])();
  return { path: window.location.pathname + window.location.search + window.location.hash, held: heldCallback(), referrer: document.head.querySelector('meta[name="referrer"]')?.getAttribute('content') ?? null };
};

describe('/auth/web-callback (the web flow\'s own return: this page exchanges, so the code is kept for it)', () => {
  it('an email link: the code and invite move into memory, the URL is bare', () => {
    const r = runCallback(`/auth/web-callback?invite=ABCDE23456&via=email&code=${CODE}`);
    expect(r.path).toBe('/auth/web-callback');
    expect(r.held).toEqual({ code: CODE, invite: 'ABCDE23456', via: 'email', error: false });
    expect(r.referrer).toBe('no-referrer');
    expect(Object.keys(window)).not.toContain('__stockpileWebCallback');
    expect(Object.isFrozen(r.held)).toBe(true);
    expect(window.location.href).not.toContain(CODE);
    expect(JSON.stringify(window.history.state)).not.toContain(CODE);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(CODE);
    expect(document.documentElement.outerHTML).not.toContain(CODE);
  });

  it('an OAuth return says so; anything else is email', () => {
    expect(runCallback(`/auth/web-callback?invite=A1B2C3&via=oauth&code=${CODE}`).held?.via).toBe('oauth');
    expect(runCallback(`/auth/web-callback?invite=A1B2C3&via=sms&code=${CODE}`).held?.via).toBe('email');
    expect(runCallback(`/auth/web-callback?invite=A1B2C3&code=${CODE}`).held?.via).toBe('email');
  });

  it.each([
    ['a query error', '/auth/web-callback?via=email&invite=ABCDE23456&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', 'other'],
    ['a hash error', '/auth/web-callback?via=oauth&invite=ABCDE23456#error=access_denied&error_description=User+denied', 'other'],
    ['the signup gate', '/auth/web-callback?via=oauth&invite=ABCDE23456&error=server_error&error_description=Stockpile+is+not+open+for+new+signups+yet', 'paused'],
    ['the signup gate, in the hash, any case', '/auth/web-callback?via=oauth#error_description=NOT%20OPEN%20FOR%20NEW%20SIGNUPS', 'paused'],
  ])('%s: only the KIND of failure is kept, never its text, and never a code', (_label, url, kind) => {
    const r = runCallback(url);
    expect(r.held?.error).toBe(kind);
    expect(r.held?.code).toBeNull();
    expect(JSON.stringify(r.held)).not.toMatch(/expired|denied|signups|access_denied/i);
    expect(r.path).toBe('/auth/web-callback');
  });

  it('an error beats a code that came with it', () => {
    const r = runCallback(`/auth/web-callback?invite=ABCDE23456&code=${CODE}&error=access_denied`);
    expect(r.held).toEqual({ code: null, invite: 'ABCDE23456', via: 'email', error: 'other' });
  });

  it('the web callback applies the same rule to a code that is not token-shaped', () => {
    expect(runCallback('/auth/web-callback?invite=ABCDE23456&code=%3Cscript%3E').held).toEqual({ code: null, invite: 'ABCDE23456', via: 'email', error: false });
    expect(runCallback('/auth/web-callback?invite=ABCDE23456&code=short').held?.code).toBeNull();
  });

  it('a visit with no code and no error holds neither', () => {
    expect(runCallback('/auth/web-callback?invite=ABCDE23456').held).toEqual({ code: null, invite: 'ABCDE23456', via: 'email', error: false });
  });

  it.each(['/Auth/Web-Callback', '/AUTH/WEB-CALLBACK/', '/auth/web%2Dcallback'])('%s is the same page', (path) => {
    const r = runCallback(`${path}?code=${CODE}&invite=ABCDE23456`);
    expect(r.path).toBe('/auth/web-callback');
    expect(r.held?.code).toBe(CODE);
  });

  it('does not touch /auth/confirm\'s own state, and /auth/confirm does not hold a web callback', () => {
    const c = run(`/auth/confirm?code=${CODE}`);
    expect(c.outcome).toBe('confirmed');
    expect(heldCallback()).toBeNull();
    const w = runCallback(`/auth/web-callback?code=${CODE}`);
    expect(w.held?.code).toBe(CODE);
    expect((window as unknown as Record<string, unknown>).__stockpileAuthConfirm).toBeUndefined();
  });

  it('/auth/web-callbackx and /auth/web-callback/extra are left alone', () => {
    expect(runCallback(`/auth/web-callbackx?code=${CODE}`).held).toBeNull();
    expect(runCallback(`/auth/web-callback/extra?code=${CODE}`).path).toBe(`/auth/web-callback/extra?code=${CODE}`);
  });
});

describe('other paths', () => {
  it('/join/<code>: no-referrer, URL untouched', () => {
    expect(strip(run('/join/ABCDE23456?x=1'))).toEqual({ path: '/join/ABCDE23456?x=1', outcome: 'none', referrer: 'no-referrer' });
  });

  it('/JOIN/<code>: no-referrer too (case-insensitive like the router)', () => {
    expect(run('/JOIN/ABCDE23456').referrer).toBe('no-referrer');
  });

  it.each(['/', '/auth/confirmx?code=abc', '/dashboard?code=abc', '/join'])('%s: untouched, no meta', (url) => {
    const r = run(url);
    expect(r.path).toBe(url);
    expect(r.referrer).toBeNull();
  });
});
