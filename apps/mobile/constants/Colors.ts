// Fantasy Stock App — Light Theme (backwards-compatible shim)
// Maps legacy Colors.xxx keys to new light palette values.

export const Colors = {
  // Backgrounds
  background: '#FFFFFF',
  headerBg: '#FFFFFF',
  cardBg: '#FFFFFF',
  cardBgAlt: '#F8FAFC',
  inputBg: '#F1F5F9',

  // Glassmorphic → light equivalents
  glassBg: '#FFFFFF',
  glassBorder: '#E2E8F0',

  // Borders
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  borderDark: '#E2E8F0',

  // Text
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  textDark: '#94A3B8',

  // Accent Colors
  primary: '#0891B2',
  primaryHover: '#0E7490',
  primaryLight: '#0891B2',
  primaryBg: 'rgba(8,145,178,0.08)',

  accent: '#059669',
  accentBg: '#ECFDF5',

  secondary: '#6366F1',
  secondaryBg: 'rgba(99,102,241,0.08)',

  // Status Colors
  success: '#059669',
  successLight: '#059669',
  successBg: '#ECFDF5',

  error: '#DC2626',
  errorDark: '#B91C1C',
  errorBg: '#FEF2F2',

  warning: '#D97706',
  warningBg: '#FFFBEB',

  // Special
  gold: '#D97706',
  goldBg: '#FFFBEB',
  silver: '#94A3B8',
  silverBg: '#F1F5F9',
  cyan: '#0891B2',

  // Tab bar specific
  tabActive: '#0891B2',
  tabInactive: '#94A3B8',
};

// Legacy export for backwards compatibility
export default {
  light: {
    text: '#0F172A',
    background: '#FFFFFF',
    tint: '#0891B2',
    tabIconDefault: '#94A3B8',
    tabIconSelected: '#0891B2',
  },
  dark: {
    text: '#0F172A',
    background: '#FFFFFF',
    tint: '#0891B2',
    tabIconDefault: '#94A3B8',
    tabIconSelected: '#0891B2',
  },
};
