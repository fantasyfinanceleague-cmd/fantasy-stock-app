import { router } from 'expo-router';

import { AppearancePicker } from '@/components/shell/AppearancePicker';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { ScreenTitle } from '@/components/shell/ScreenTitle';

// Phase 3b-1 — Profile › Appearance (spec row 12).
export default function AppearanceScreen() {
  return (
    <AuthScaffold back={{ label: 'Profile', onPress: () => (router.canGoBack() ? router.back() : router.replace('/profile')) }}>
      <ScreenTitle>Appearance</ScreenTitle>
      <AppearancePicker />
    </AuthScaffold>
  );
}
