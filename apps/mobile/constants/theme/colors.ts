// Stockpile — Light Theme Color Palette
// SINGLE SOURCE OF TRUTH for every color value in the app.
// constants/Colors.ts is a thin alias layer over this file — never write a
// raw hex in a screen or component; add a semantic token here instead.

export const colors = {
  // Backgrounds — layered depth system (3 levels, light)
  bgBase: '#FFFFFF',
  bgSurface: '#F8FAFC',
  bgElevated: '#F1F5F9',
  bgScreen: '#FFFFFF',

  // Pure white — for text/icons on colored backgrounds
  white: '#FFFFFF',

  // Brand Cyan — used surgically, NOT decoratively
  cyan: '#0891B2',
  cyanDark: '#0E7490',
  cyanLight: '#ECFEFF',
  cyanMuted: 'rgba(8,145,178,0.08)',

  // Semantic Colors
  positive: '#059669',
  positiveMuted: '#ECFDF5',
  positiveBorder: '#A7F3D0',
  negative: '#DC2626',
  negativeDark: '#B91C1C',
  negativeMuted: '#FEF2F2',
  negativeBorder: '#FECACA',
  warning: '#D97706',
  warningMuted: '#FFFBEB',
  warningBorder: '#FDE68A',
  info: '#3B82F6',
  infoMuted: '#EFF6FF',
  infoBorder: '#BFDBFE',

  // Secondary accent (indigo)
  secondary: '#6366F1',
  secondaryMuted: '#EEF2FF',

  // Role / status accents
  commissioner: '#A855F7',
  commissionerMuted: 'rgba(168,85,247,0.13)',
  memberHighlight: '#1E3A5F',

  // Text Hierarchy
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  textDisabled: '#CBD5E1',
  textInverse: '#FFFFFF',

  // Borders & Dividers
  border: '#E2E8F0',
  borderLight: '#F1F5F9',

  // Overlays
  overlay: 'rgba(0, 0, 0, 0.4)',

  // Tab Bar
  tabInactive: '#94A3B8',
  tabActive: '#0891B2',
  tabBarBg: '#FFFFFF',

  // Rank / medal accents (standings, champions)
  gold: '#D97706',
  goldBg: '#FFFBEB',
  goldText: '#92400E',
  silver: '#94A3B8',
  silverBg: '#F1F5F9',
  bronze: '#EA580C',
  bronzeBg: '#FFF7ED',
  championText: '#451A03',
};
