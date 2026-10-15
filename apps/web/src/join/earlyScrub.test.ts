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
