// Fantasy Stock App — legacy `Colors` surface.
// PURE ALIAS LAYER over constants/theme/colors.ts — no color VALUE may be
// defined here. Add new tokens in theme/colors.ts and alias them if the
// legacy name differs.

import { colors } from './theme/colors';

export const Colors = {
  // Backgrounds
  background: colors.bgBase,
  headerBg: colors.bgBase,
  cardBg: colors.bgBase,
  cardBgAlt: colors.bgSurface,
  bgSurface: colors.bgSurface,
  bgElevated: colors.bgElevated,
  inputBg: colors.bgElevated,
  white: colors.white,

  // Glassmorphic → light equivalents
  glassBg: colors.bgBase,
  glassBorder: colors.border,

  // Borders
  border: colors.border,
  borderLight: colors.borderLight,
  borderDark: colors.border,

  // Overlays
  overlay: colors.overlay,

  // Text
  textPrimary: colors.textPrimary,
  textSecondary: colors.textSecondary,
  textMuted: colors.textTertiary,
  textDark: colors.textTertiary,
  textDisabled: colors.textDisabled,

  // Accent Colors
  primary: colors.cyan,
  primaryHover: colors.cyanDark,
  primaryLight: colors.cyan,
  primaryBg: colors.cyanMuted,
  cyanLight: colors.cyanLight,

  accent: colors.positive,
  accentBg: colors.positiveMuted,

  secondary: colors.secondary,
  secondaryBg: colors.secondaryMuted,

  // Status Colors
  success: colors.positive,
  successLight: colors.positive,
  successBg: colors.positiveMuted,
  successBorder: colors.positiveBorder,

  error: colors.negative,
  errorDark: colors.negativeDark,
  errorBg: colors.negativeMuted,
  errorBorder: colors.negativeBorder,

  warning: colors.warning,
  warningBg: colors.warningMuted,
  warningBorder: colors.warningBorder,

  info: colors.info,
  infoBg: colors.infoMuted,
  infoBorder: colors.infoBorder,

  // Roles
  commissioner: colors.commissioner,
  commissionerBg: colors.commissionerMuted,
  memberHighlight: colors.memberHighlight,

  // Special
  gold: colors.gold,
  goldBg: colors.goldBg,
  goldText: colors.goldText,
  silver: colors.silver,
  silverBg: colors.silverBg,
  bronze: colors.bronze,
  bronzeBg: colors.bronzeBg,
  championText: colors.championText,
  cyan: colors.cyan,

  // Tab bar specific
  tabActive: colors.tabActive,
  tabInactive: colors.tabInactive,
};

// Legacy export for backwards compatibility (Expo template Themed.tsx)
export default {
  light: {
    text: colors.textPrimary,
    background: colors.bgBase,
    tint: colors.cyan,
    tabIconDefault: colors.tabInactive,
    tabIconSelected: colors.tabActive,
  },
  dark: {
    text: colors.textPrimary,
    background: colors.bgBase,
    tint: colors.cyan,
    tabIconDefault: colors.tabInactive,
    tabIconSelected: colors.tabActive,
  },
};
