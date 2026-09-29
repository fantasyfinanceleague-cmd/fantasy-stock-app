import { router } from 'expo-router';

import { OnboardingPager } from '@/components/shell/onboarding/OnboardingPager';

// Phase 3b-1 — Onboarding ×3 (spec row 6): signed out, first run only
// (app/_layout.tsx guards it on the stored "seen" flag). Skip and the last
// card's [Get started] both lead to Get started.
export default function OnboardingScreen() {
  const toGetStarted = () => router.replace('/get-started');
  return <OnboardingPager onFinish={toGetStarted} onSkip={toGetStarted} />;
}
