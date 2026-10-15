/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/sp/Text';
import { NAME_MIN_SCALE, nameLines } from '@/lib/shell/fitText';

// Onboarding W4 (Design Lead gate on cd9a7b71) — a display heading in two parts: a LEAD sentence that
// wraps ("Roberto invited you to", "You're in") and a league NAME that is never broken inside a word.
// The name sits on its own line, so a heading breaks BEFORE it, never inside it. A hidden probe measures
// the name's one-line width at the current text size; lib/shell/fitText.ts decides: one line down to
// 0.75x, otherwise a wrap at spaces on 2 lines (3 only if 2 cannot hold it at 0.75x), always at >= 0.75x.
// The lead pushes out its last line (lineBreakStrategyIOS) so a lone word is never left on it.

const PROBE_WIDTH = 4000;

export function FittedTitle({ lead, name, label }: { lead: string; name: string | null; label: string }) {
  const [available, setAvailable] = useState(0);
  const [natural, setNatural] = useState(0);
  const lines = nameLines(natural, available);
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={label}
      style={styles.heading}
      onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}
    >
      <Text variant="display" numberOfLines={0} lineBreakStrategyIOS="push-out" style={styles.title}>
        {lead}
      </Text>
      {name ? (
        <>
          {/* The probe: the name's natural width at this size, one line, never shown. */}
          <Text
            variant="display"
            numberOfLines={1}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.probe}
            onTextLayout={(e) => setNatural(e.nativeEvent.lines[0]?.width ?? 0)}
          >
            {name}
          </Text>
          <Text variant="display" numberOfLines={lines} adjustsFontSizeToFit minimumFontScale={NAME_MIN_SCALE} style={styles.title}>
            {name}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // overflow hidden: the 4000pt probe is absolutely positioned and must never widen the page.
  heading: {
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  title: {
    textAlign: 'center',
  },
  probe: {
    position: 'absolute',
    opacity: 0,
    width: PROBE_WIDTH,
  },
});
