import { router } from 'expo-router';

import { Text } from '@/components/sp/Text';
import { AppearancePicker } from '@/components/shell/AppearancePicker';
import { AuthScaffold } from '@/components/shell/AuthScaffold';

// Phase 3b-1 — Profile › Appearance (spec row 12).
export default function AppearanceScreen() {
  return (
    <AuthScaffold back={{ label: 'Profile', onPress: () => (router.canGoBack() ? router.back() : router.replace('/profile')) }}>
      <Text variant="display" accessibilityRole="header">
        Appearance
      </Text>
      <AppearancePicker />
    </AuthScaffold>
  );
}
