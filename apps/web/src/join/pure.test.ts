import { describe, expect, it, vi } from 'vitest';
import { clearPendingInvite, getPendingInvite, PENDING_INVITE_KEY, setPendingInvite } from './pendingInvite';
import { webCallbackUrl } from './config';
import { getConfig } from '@testing-library/react';

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

describe('webCallbackUrl', () => {
  it('carries the invite and the kind of return, and nothing else', () => {
    expect(webCallbackUrl('https://x.example', 'ABCDE23456', 'email')).toBe('https://x.example/auth/web-callback?invite=ABCDE23456&via=email');
    expect(webCallbackUrl('https://x.example', 'ABCDE23456', 'oauth')).toBe('https://x.example/auth/web-callback?invite=ABCDE23456&via=oauth');
  });

  it('is never the app\'s path (that one is in the apple-app-site-association)', () => {
    expect(webCallbackUrl('https://x.example', 'ABCDE23456', 'email')).not.toContain('/auth/confirm');
  });
});

describe('the test setup', () => {
  it('waits up to 4s for async UI (the shared setup\'s asyncUtilTimeout took effect for the library the tests use)', () => {
    expect(getConfig().asyncUtilTimeout).toBe(4000);
  });
});
