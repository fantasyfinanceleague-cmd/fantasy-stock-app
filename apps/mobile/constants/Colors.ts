// Fantasy Stock App - Theme Colors (matching web app)

export const Colors = {
  // Backgrounds
  background: '#0f172a',      // Main page background (slate blue)
  headerBg: '#111827',        // Header/tab bar background
  cardBg: '#1e293b',          // Card background
  cardBgAlt: '#15181e',       // Alternative card bg (slightly darker)
  inputBg: '#0f1319',         // Input field background

  // Borders
  border: '#334155',          // Primary border color
  borderLight: '#2a3040',     // Lighter border
  borderDark: '#1f2937',      // Darker border

  // Text
  textPrimary: '#ffffff',     // Primary text (white)
  textSecondary: '#e5e7eb',   // Secondary text (light gray)
  textMuted: '#9ca3af',       // Muted text (gray)
  textDark: '#6b7280',        // Darker muted text

  // Accent Colors
  primary: '#3b82f6',         // Primary blue
  primaryHover: '#2563eb',    // Primary blue hover
  primaryLight: '#60a5fa',    // Light blue (for highlights)
  primaryBg: 'rgba(59, 130, 246, 0.2)',  // Blue background tint

  secondary: '#8b5cf6',       // Purple accent
  secondaryBg: 'rgba(139, 92, 246, 0.2)',

  // Status Colors
  success: '#16a34a',         // Green (gains, positive)
  successLight: '#22c55e',    // Lighter green
  successBg: 'rgba(22, 163, 74, 0.2)',

  error: '#ef4444',           // Red (losses, negative)
  errorDark: '#dc2626',
  errorBg: 'rgba(239, 68, 68, 0.2)',

  warning: '#f59e0b',         // Yellow/amber
  warningBg: 'rgba(245, 158, 11, 0.2)',

  // Special
  gold: '#fbbf24',            // Gold for champions/special
  cyan: '#0ea5e9',            // Cyan for rank badges

  // Tab bar specific
  tabActive: '#3b82f6',       // Active tab (blue)
  tabInactive: '#6b7280',     // Inactive tab (gray)
};

// Legacy export for backwards compatibility
export default {
  light: {
    text: '#000',
    background: '#fff',
    tint: '#2f95dc',
    tabIconDefault: '#ccc',
    tabIconSelected: '#2f95dc',
  },
  dark: {
    text: '#fff',
    background: Colors.background,
    tint: Colors.primary,
    tabIconDefault: Colors.tabInactive,
    tabIconSelected: Colors.tabActive,
  },
};
