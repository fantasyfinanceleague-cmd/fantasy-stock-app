// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type * as AppAuthErrors from '../../../mobile/lib/authErrors';
import type * as AppCooldown from '../../../mobile/lib/auth/resendCooldown';
import { brand } from '../brand';
import { getAuthErrorMessage, isEmailNotConfirmedError, isSignupsPausedError } from './authErrors';
import { createResendCooldown, RESEND_COOLDOWN_MS, RESEND_TOO_SOON } from './resendCooldown';
import { loadMobile } from './testing/loadMobile';

const app = loadMobile<typeof AppAuthErrors>('lib/authErrors.ts');
const cooldown = loadMobile<typeof AppCooldown>('lib/auth/resendCooldown.ts');

const SENTENCE = 'Use at least 8 characters, with an uppercase letter, a lowercase letter, a number, and a symbol.';

const ERRORS: unknown[] = [
  { code: 'invalid_credentials' },
  { message: 'Invalid login credentials' },
  { code: 'email_not_confirmed' },
  { message: 'Email not confirmed' },
  { code: 'user_already_exists' },
  { message: 'User already registered' },
  { code: 'same_password' },
  { message: 'New password should be different from the old password.' },
  { code: 'weak_password' },
  { message: 'Password should be at least 8 characters' },
  { code: 'email_address_invalid' },
  { message: 'Unable to validate email address: invalid format' },
  { code: 'over_request_rate_limit' },
  { code: 'over_email_send_rate_limit' },
  { message: 'For security purposes, you can only request this after 59 seconds.' },
  { message: 'Signups are not open for new signups right now' },
  { message: 'Failed to fetch' },
  { message: 'Network request failed' },
  { message: 'a raw GoTrue sentence we have no line for' },
  { code: 'something_new', message: 'Database error saving new user' },
  { message: '' },
  {},
  null,
  undefined,
  'a string',
  42,
];

describe('getAuthErrorMessage: the same error reads the same line as in the app', () => {
  it.each(ERRORS.map((e, i) => [i, e] as const))('case %#: %j', (_i, error) => {
    expect(getAuthErrorMessage(error, SENTENCE)).toBe(app.getAuthErrorMessage(error, SENTENCE, brand.name));
    expect(getAuthErrorMessage(error)).toBe(app.getAuthErrorMessage(error, undefined, brand.name));
  });

  it('never the server\'s own words: an unmapped error is the generic line', () => {
    expect(getAuthErrorMessage({ message: 'duplicate key value violates unique constraint "x"' })).toBe('Something went wrong. Please try again.');
  });

  it('the two classifiers agree with the app', () => {
    for (const e of ERRORS) {
      expect(isEmailNotConfirmedError(e)).toBe(app.isEmailNotConfirmedError(e));
      expect(isSignupsPausedError(e)).toBe(app.isSignupsPausedError(e));
    }
  });
});

describe('the resend cooldown: the app\'s, ported', () => {
  it('the constants are the app\'s', () => {
    expect(RESEND_COOLDOWN_MS).toBe(cooldown.RESEND_COOLDOWN_MS);
    expect(RESEND_TOO_SOON).toEqual(cooldown.RESEND_TOO_SOON);
    expect(getAuthErrorMessage(RESEND_TOO_SOON)).toBe('Too many attempts — please wait a minute and try again.');
  });

  it('behaves identically over the same clock', () => {
    let t = 1_000_000;
    const web = createResendCooldown(() => t);
    const theirs = cooldown.createResendCooldown(() => t);
    const steps: [string, number][] = [['A@x.co', 0], ['a@x.co ', 10_000], ['a@x.co', 59_999], ['a@x.co', 60_000], ['b@x.co', 1]];
    web.markSent('a@x.co');
    theirs.markSent('a@x.co');
    for (const [email, advance] of steps) {
      t += advance;
      expect(web.remainingMs(email)).toBe(theirs.remainingMs(email));
    }
    expect(web.remainingMs('')).toBe(0);
  });

  it('a blank address is never recorded', () => {
    const c = createResendCooldown(() => 0);
    c.markSent('   ');
    expect(c.remainingMs('   ')).toBe(0);
  });
});
