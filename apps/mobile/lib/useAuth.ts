import { useSession } from './SessionProvider';

// The auth state now lives in ONE place: lib/SessionProvider.tsx (Phase
// 3b-1). This hook keeps its original return shape so its ~20 call sites
// are unchanged; it no longer opens its own onAuthStateChange subscription.
export function useAuth() {
  const { session, user, loading, signOut } = useSession();
  return { session, user, loading, signOut };
}
