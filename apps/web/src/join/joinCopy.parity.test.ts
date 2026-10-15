// @vitest-environment node
//
// The web lines that also exist in the app are the app's approved lines,
// verbatim: this loads the app's own modules (pure TS, no React Native) and
// compares output for output.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type * as AppModule from '../../../mobile/lib/join/joinPreview';
import type * as AppConfirmCopy from '../../../mobile/constants/confirmEmailCopy';
import type * as AppUsername from '../../../mobile/lib/shell/usernameMachine';
import type * as AppUsernameRules from '../../../mobile/lib/shell/usernameRules';
import * as web from './joinCopy';
import * as webRules from './usernameRules';
import { loadMobile, mobilePath } from './testing/loadMobile';

const app = loadMobile<typeof AppModule>('lib/join/joinPreview.ts');
const appEntry = mobilePath('lib/join/joinPreview.ts');

const league = { name: 'Stock Scudetto', max: 6 };

describe('refusal copy parity with apps/mobile/lib/join/joinPreview.ts', () => {
  it.each(web.JOIN_BLOCKS.map((b) => [b]))('%s', (block) => {
    expect(web.blockMessage(block, league)).toBe(app.blockMessage(block, league));
  });

  it('the shared JOIN_COPY lines are identical', () => {
    for (const [key, line] of Object.entries(web.JOIN_COPY)) {
      expect(line).toBe(app.JOIN_COPY[key as keyof typeof app.JOIN_COPY]);
    }
  });

  it('errorMessage', () => {
    for (const kind of ['unreachable', 'rate_limited'] as const) expect(web.errorMessage(kind)).toBe(app.errorMessage(kind));
  });

  it('coerceBlock and refineBlock agree on every reason, and on junk', () => {
    const reasons = [...web.JOIN_BLOCKS, 'invalid_code', 'not_a_reason', '', null, undefined, 42, {}];
    for (const r of reasons) expect(web.coerceBlock(r)).toBe(app.coerceBlock(r));
    for (const b of web.JOIN_BLOCKS) {
      for (const s of ['not_started', 'in_progress', 'completed', null, undefined]) {
        expect(web.refineBlock(b, s)).toBe(app.refineBlock(b, s));
      }
    }
  });

  it("the web knows every block the app's blockMessage handles (a new one fails here)", () => {
    const src = readFileSync(appEntry, 'utf-8');
    const body = src.slice(src.indexOf('export function blockMessage'), src.indexOf('export type PreviewAction'));
    const appCases = [...body.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]).sort();
    expect(appCases.length).toBeGreaterThan(0);
    expect(web.JOIN_BLOCKS.filter((b) => b !== 'unknown').slice().sort()).toEqual(appCases);
  });

  it('the shared JOIN_COPY lines are exactly the web subset (a new web key must exist in the app)', () => {
    for (const key of Object.keys(web.JOIN_COPY)) expect(Object.keys(app.JOIN_COPY)).toContain(key);
  });
});

describe('check-your-email copy parity with apps/mobile/constants/confirmEmailCopy.ts', () => {
  const copy = loadMobile<typeof AppConfirmCopy>('constants/confirmEmailCopy.ts');

  it('title, back, resend and the chip', () => {
    expect(web.WEB_COPY.checkEmailTitle).toBe(copy.CONFIRM_EMAIL_COPY.title);
    expect(web.WEB_COPY.checkEmailBack).toBe(copy.CONFIRM_EMAIL_COPY.back);
    expect(web.WEB_COPY.resend).toBe(copy.CONFIRM_EMAIL_COPY.resend);
    expect(web.WEB_COPY.confirmedChip).toBe(copy.CONFIRM_EMAIL_COPY.confirmedChip);
  });

  it('the two bodies', () => {
    expect(web.WEB_COPY.confirmSentInvite('a@b.co', 'Stock Scudetto')).toBe(copy.confirmSentBody('a@b.co', 'Stock Scudetto'));
    expect(web.WEB_COPY.confirmSentPlain('a@b.co')).toBe(copy.confirmSentBody('a@b.co', null));
  });
});

describe('username copy and rule parity with the app', () => {
  const machine = loadMobile<typeof AppUsername>('lib/shell/usernameMachine.ts');
  const rules = loadMobile<typeof AppUsernameRules>('lib/shell/usernameRules.ts');

  it('the messages', () => {
    expect(web.WEB_COPY.usernameTaken).toBe(machine.MSG_TAKEN);
    expect(web.WEB_COPY.usernameNotAllowed).toBe(machine.MSG_NOT_ALLOWED);
    expect(web.WEB_COPY.usernameCheckFailed).toBe(machine.MSG_CHECK_FAILED);
    expect(web.WEB_COPY.usernameLength).toBe(rules.RULE_LENGTH);
    expect(web.WEB_COPY.usernameCharset).toBe(rules.RULE_CHARSET);
  });

  it('the format pattern, and the first failing rule for any input', () => {
    expect(webRules.USERNAME_PATTERN).toBe(rules.USERNAME_PATTERN);
    for (const v of ['', 'ab', 'abc', 'a'.repeat(20), 'a'.repeat(21), 'has space', 'ok_name_1', 'bad-name', 'émile', '____']) {
      expect(webRules.firstFailingRule(v)).toBe(rules.firstFailingRule(v));
    }
  });

  it('the pattern is the migration\'s, byte for byte', () => {
    const sql = readFileSync(mobilePath('../../supabase/migrations/20261007000000_username_write_path.sql'), 'utf-8');
    expect(sql).toContain(webRules.USERNAME_PATTERN.replace(/^\^|\$$/g, ''));
  });
});
