/**
 * The onboarding auth layer as vi.fn()s. Each test file does
 *   const m = vi.hoisted(() => makeAuthMock()); vi.mock('../onboardingAuth', () => m);
 * (vi.hoisted can't import, so the file passes the factory it needs.)
 */
import { vi } from 'vitest';

export function makeAuthMock() {
  return {
    onboardingClient: vi.fn(() => null),
    currentSession: vi.fn(),
    signInWithProvider: vi.fn(),
    signUpWithEmail: vi.fn(),
    signInWithEmail: vi.fn(),
    exchangeCode: vi.fn(),
    signOutLocal: vi.fn(),
    readOwnUsername: vi.fn(),
    checkUsernames: vi.fn(),
    setUsername: vi.fn(),
    previewWithSession: vi.fn(),
    joinWithSession: vi.fn(),
  };
}
