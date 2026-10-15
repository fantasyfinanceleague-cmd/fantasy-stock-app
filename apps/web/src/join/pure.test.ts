import { describe, expect, it, vi } from 'vitest';
import { clearPendingInvite, getPendingInvite, PENDING_INVITE_KEY, setPendingInvite } from './pendingInvite';
import { suggestUsername } from './usernameSuggestion';
import { USERNAME_RE } from './usernameRules';
import { webCallbackUrl } from './config';

describe('pendingInvite', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('round-trips a code and clears it', () => {
    const s = memory();
    setPendingInvite('ABCDE23456', s);
    expect(getPendingInvite(s)).toBe('ABCDE23456');
    clearPendingInvite(s);
    expect(getPendingInvite(s)).toBeNull();
  });

  it('only ever hands back something that can be a code', () => {
    const s = memory();
    s.setItem(PENDING_INVITE_KEY, '<script>alert(1)</script>');
    expect(getPendingInvite(s)).toBeNull();
    s.setItem(PENDING_INVITE_KEY, 'abcde23456');
    expect(getPendingInvite(s)).toBe('ABCDE23456');
  });

  it('works without storage, and when storage throws', () => {
    expect(() => setPendingInvite('ABCDE23456', null)).not.toThrow();
    expect(getPendingInvite(null)).toBeNull();
    const boom = { getItem: vi.fn(() => { throw new Error('denied'); }), setItem: vi.fn(() => { throw new Error('denied'); }), removeItem: vi.fn(() => { throw new Error('denied'); }) };
    expect(() => setPendingInvite('ABCDE23456', boom)).not.toThrow();
    expect(getPendingInvite(boom)).toBeNull();
    expect(() => clearPendingInvite(boom)).not.toThrow();
  });
});

describe('the username suggestion (a gamertag, never a name)', () => {
  it('is {adjective}{animal}{digits} and always passes the format rule', () => {
    for (let i = 0; i < 500; i++) {
      const name = suggestUsername();
      expect(name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{3}$/);
      expect(USERNAME_RE.test(name)).toBe(true);
    }
  });

  it('is deterministic for a given random source', () => {
    const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };
    expect(suggestUsername(seq([0, 0, 0]))).toBe(suggestUsername(seq([0, 0, 0])));
    expect(suggestUsername(seq([0, 0, 0]))).toBe('HelpfulHornet100');
  });

  // MIRROR PENDING: W4 owns the app's generator. When its path is relayed, this
  // stand-in becomes a mirror and this todo becomes the parity test.
  it.todo("matches W4's generator for the same random source");
});

describe('webCallbackUrl', () => {
  it('carries the invite and the kind of return, and nothing else', () => {
    expect(webCallbackUrl('https://x.example', 'ABCDE23456', 'email')).toBe('https://x.example/auth/web-callback?invite=ABCDE23456&via=email');
    expect(webCallbackUrl('https://x.example', 'ABCDE23456', 'oauth')).toBe('https://x.example/auth/web-callback?invite=ABCDE23456&via=oauth');
  });

  it('is never the app\'s path (that one is in the apple-app-site-association)', () => {
    expect(webCallbackUrl('https://x.example', 'ABCDE23456', 'email')).not.toContain('/auth/confirm');
  });
});
