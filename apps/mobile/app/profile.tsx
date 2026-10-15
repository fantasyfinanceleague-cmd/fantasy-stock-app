import { useState } from 'react';
import { router } from 'expo-router';

import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { HowItWorksSheet } from '@/components/shell/HowItWorksSheet';
import { ProfileView } from '@/components/shell/ProfileView';
import { useSession } from '@/lib/SessionProvider';

// Phase 3b-1 — Profile (spec row 11). Reached from the Home avatar.
export default function ProfileScreen() {
  const { user, username, signOut } = useSession();
  const [howItWorks, setHowItWorks] = useState(false);
  return (
    <AuthScaffold back={{ label: 'Home', onPress: () => (router.canGoBack() ? router.back() : router.replace('/')) }}>
      <ProfileView
        username={username}
        email={user?.email ?? null}
        onUsername={() => router.push('/username')}
        onChangePassword={() => router.push('/change-password')}
        onAppearance={() => router.push('/appearance')}
        onHowItWorks={() => setHowItWorks(true)}
        onSignOut={signOut}
      />
      <HowItWorksSheet visible={howItWorks} onClose={() => setHowItWorks(false)} />
    </AuthScaffold>
  );
}
