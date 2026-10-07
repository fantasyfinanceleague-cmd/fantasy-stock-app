/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';

import { space } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { ScreenTitle } from '@/components/shell/ScreenTitle';

// 3f — Not found (1.2.0; board key-screens.html #not-found). Every bad deep
// link lands here: a calm dead end with ONE way out. Replaces the Expo
// default ("Oops!").
//
// - No tab bar and no back arrow, and the swipe-back is off: a cold-start
//   link has nothing behind it to go back to.
// - "Go to Home" REPLACES the stack (pops to the root, then replaces it), so
//   the dead end can't be reached again with Back. Signed out, Home is
//   guarded and sends the user to sign-in, exactly as a cold start does.
function goHome() {
  if (router.canDismiss()) router.dismissAll();
  router.replace('/');
}

export default function NotFoundScreen() {
  return (
    <AuthScaffold>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={styles.center}>
        <Icon name="search" size="medallion" tone="text2" discTone="sunken" />
        <ScreenTitle style={styles.text}>Nothing here</ScreenTitle>
        <Text variant="body" tone="secondary" style={styles.text}>
          This link is old or incomplete. Everything in your leagues is still where you left it.
        </Text>
        <View style={styles.button}>
          <Button label="Go to Home" onPress={goHome} />
        </View>
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    gap: space[4],
    paddingTop: space[10] * 2,
  },
  text: {
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
    marginTop: space[3],
  },
});
