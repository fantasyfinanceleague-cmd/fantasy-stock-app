/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Image, StyleSheet, View } from 'react-native';

import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';
import { ICON_GLYPHS } from '@/components/sp/logic/icon';
import { discInitials, initialFontSize } from '@/components/sp/logic/avatar';
import { isDeletedSeatName } from '@/lib/account/deletedSeat';
import { useDeletedManagerLabel } from '@/lib/account/deletedLabelStore';
import type { ThemeColors } from '@/constants/tokens';

// Stockpile — <Avatar> (§9A, "One design, two themes", 2026-09-29). Used for
// the Home header avatar button (Profile leaves the tab bar per
// DESIGN_DIRECTION §3 decision 4) and anywhere a member/opponent needs a
// face — a photo when we have a URI, otherwise their initial on a
// "you"-coloured circle (colors.you / colors.onYou — the PAIRS list's own
// "Avatar initials" pair, board.jsx-verified 4.5:1 in both themes).

export interface AvatarProps {
  uri?: string | null;
  /** Display name — its initials (up to two) are shown when there's no photo. */
  name: string;
  size?: number;
  /** Game Night (§9C): whose fill the initials sit on. `you` (the default, today's look)
   * is `you` + `onYou`; `opp` is the slate `opp` + `onOpp`; `neutral` is `inset` + `text`. */
  tone?: 'you' | 'opp' | 'neutral';
  /** §9C: your avatar's 2pt `you` ring across a 2pt `bg` gap (adds 4pt on each side). */
  ring?: boolean;
}

/** §9C ring geometry: 2pt ring + 2pt gap on each side. */
export const AVATAR_RING = 2;
export const AVATAR_RING_GAP = 2;

const DEFAULT_SIZE = 36;
/** The deleted seat's person glyph, as a share of its disc (the board's 0.58). */
const DELETED_GLYPH_RATIO = 0.58;

type Tone = NonNullable<AvatarProps['tone']>;
const FILL: Record<Tone, (c: ThemeColors) => string> = { you: (c) => c.you, opp: (c) => c.opp, neutral: (c) => c.inset };
const INK: Record<Tone, (c: ThemeColors) => string> = { you: (c) => c.onYou, opp: (c) => c.onOpp, neutral: (c) => c.text };

export function Avatar({ ring = false, ...props }: AvatarProps) {
  const { colors } = useTheme();
  if (!ring) return <AvatarFace {...props} />;
  const outer = (props.size ?? DEFAULT_SIZE) + 2 * (AVATAR_RING + AVATAR_RING_GAP);
  return (
    <View
      testID="avatar-ring"
      style={[styles.ring, { width: outer, height: outer, borderRadius: outer / 2, borderWidth: AVATAR_RING, borderColor: colors.you, backgroundColor: colors.bg }]}
    >
      <AvatarFace {...props} />
    </View>
  );
}

function AvatarFace({ uri, name, size = DEFAULT_SIZE, tone = 'you' }: Omit<AvatarProps, 'ring'>) {
  const { colors } = useTheme();
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  // Account deletion (W4, Giorgio's board pick): a deleted manager's seat gets the DEFAULT avatar (a person glyph on
  // a neutral disc), never initials of the label ("FM") and never a photo. Every seat name arrives from the server
  // through this component, so the one check lives here: lib/account/deletedSeat.ts decides what counts as the seat.
  const deletedLabel = useDeletedManagerLabel();
  if (isDeletedSeatName(name, deletedLabel)) {
    return (
      <View testID="avatar-deleted-seat" style={[styles.fallback, { backgroundColor: colors.inset }, dimension]} accessibilityLabel={name}>
        {/* A glyph in a fixed-diameter disc, like the initial: proportional to the disc (the board's 0.58) and fixed, so Dynamic Type can't outgrow it. */}
        <Ionicons name={ICON_GLYPHS.person as React.ComponentProps<typeof Ionicons>['name']} size={Math.round(size * DELETED_GLYPH_RATIO)} color={colors.text2} />
      </View>
    );
  }
  // Two initials (Design Lead ruling, Phase 3b-1): "Roberto B." → "RB",
  // "roberto_b" → "RB", one word → one letter, nothing → "?". Under 24pt, one (§9C).
  const initial = discInitials(name, size);
  // Blue (colors.you) means "you" elsewhere in the app (§9A team colour), so
  // an avatar with no real initial to show shouldn't borrow that meaning for
  // someone unidentified — it gets a neutral fill instead (Design Lead,
  // 2026-09-29).
  const isUnknown = initial === '?';

  if (uri) {
    return <Image source={{ uri }} style={[{ backgroundColor: colors.sunken }, dimension]} accessibilityLabel={name} />;
  }

  // Design Lead, 2026-09-29 (DESIGN-CHANGES follow-up): the initial is a
  // GLYPH inside a fixed-diameter circle, not running text — scaling it with
  // Dynamic Type outgrows the circle and clips ("G"/"?" clipped in the xl-03
  // capture). Sized proportionally to the circle (components/sp/logic/avatar.ts,
  // so it stays legible at any `size` this component is ever given) and
  // rendered with allowFontScaling={false} so the system font setting can't
  // grow it past that either — two independent causes of the same clip.
  return (
    <View
      style={[styles.fallback, { backgroundColor: isUnknown ? colors.line : FILL[tone](colors) }, dimension]}
      accessibilityLabel={name}
    >
      <Text
        variant="callout"
        color={isUnknown ? colors.text2 : INK[tone](colors)}
        allowFontScaling={false}
        style={{ fontSize: initialFontSize(size), lineHeight: initialFontSize(size) }}
      >
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
