// Stockpile — <Icon> (DESIGN_DIRECTION §9B, "one drawn icon set"). The sp icon
// set on Ionicons: a screen passes a SEMANTIC name, never a glyph. Outline by
// default; the size follows the text role it sits with and scales with Dynamic
// Type up to that role's maxScale. Colour is a theme token only. Decorative
// unless `label` is given: an icon-only control must carry a label.
import { useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from './ThemeProvider';
import type { ThemeColors } from '@/constants/tokens/color';
import { ICON_GLYPHS, iconAccessibility, iconPointSize, type IconName, type IconRole } from './logic/icon';

export interface IconProps {
  name: IconName;
  size: IconRole;
  /** A theme token, matching the text this icon sits with. */
  tone?: keyof ThemeColors;
  /** Makes the icon accessible; an icon-only control must have one. */
  label?: string;
}

export function Icon({ name, size, tone = 'text', label }: IconProps) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const a11y = iconAccessibility(label);
  return (
    <Ionicons
      name={ICON_GLYPHS[name] as React.ComponentProps<typeof Ionicons>['name']}
      size={iconPointSize(size, fontScale)}
      color={colors[tone]}
      accessible={a11y.accessible}
      accessibilityLabel={a11y.label}
      importantForAccessibility={a11y.hidden ? 'no' : 'yes'}
      accessibilityElementsHidden={a11y.hidden}
    />
  );
}
