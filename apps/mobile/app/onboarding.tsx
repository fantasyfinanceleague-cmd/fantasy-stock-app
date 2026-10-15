import { router } from 'expo-router';

import { OnboardingPager } from '@/components/shell/onboarding/OnboardingPager';
import { useFixtureInitialRoute } from '@/lib/shell/fixtureRoute';
import { markOnboardingSeen, openGetStarted } from '@/lib/shell/firstRun';

// Phase 3b-1 — Onboarding ×3 (spec row 6): signed out, first run only
// (app/_layout.tsx guards it on the stored "seen" flag). Skip and the last
// card's [Get started] both lead to Get started.
export default function OnboardingScreen() {
  // DEV captures only: EXPO_PUBLIC_SHELL_INITIAL_ROUTE (e.g. /get-started) opens once.
  useFixtureInitialRoute();
  // Skip and the last card's Get started both lead to Get started, and BOTH mark the cards seen at
  // once (plan 2026-10-14: "Skip is remembered forever"; before, only leaving Get started did, so a
  // skip then a relaunch showed the cards again). Get started is held open first, so marking the
  // cards seen doesn't pull it out from under the person (lib/shell/firstRun.ts).
  const toGetStarted = () => {
    openGetStarted();
    router.replace('/get-started');
    markOnboardingSeen();
  };
  return <OnboardingPager onFinish={toGetStarted} onSkip={toGetStarted} />;
}
