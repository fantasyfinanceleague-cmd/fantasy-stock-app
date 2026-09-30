import { router } from 'expo-router';

import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { GetStarted } from '@/components/shell/GetStarted';
import { markOnboardingSeen } from '@/lib/shell/firstRun';
import { pendingRoute } from '@/lib/shell/pendingRoute';

// Phase 3b-1 — Get started (spec row 7; D1 ruling). The end of onboarding.
// A choice is remembered as the place to resume after auth (the same
// mechanism as a signed-out deep link), then Create account opens. Leaving
// here by any path marks onboarding seen; the screen is replaced FIRST so
// the route the user is on survives the guard dropping onboarding.
export default function GetStartedScreen() {
  const leave = (to: '/create-account' | '/login', resume?: '/create-league' | '/join-league') => {
    if (resume) pendingRoute.record(resume);
    router.replace(to);
    markOnboardingSeen();
  };
  return (
    <AuthScaffold>
      <GetStarted
        onCreate={() => leave('/create-account', '/create-league')}
        onJoin={() => leave('/create-account', '/join-league')}
        onSignIn={() => leave('/login')}
      />
    </AuthScaffold>
  );
}
