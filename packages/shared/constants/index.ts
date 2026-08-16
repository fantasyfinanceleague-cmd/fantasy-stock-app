// Shared constants for Fantasy Stock

export const LEAGUE_DEFAULTS = {
  maxTeams: 12,
  minTeams: 4,
  maxTeamsLimit: 20,
  draftRounds: 5,
  startingBudget: 100000,
  numWeeks: 10,
  playoffTeams: 4,
};

export const DURATION_OPTIONS = [
  { label: '1 Week', value: 7 },
  { label: '1 Month', value: 30 },
  { label: '3 Months', value: 90 },
  { label: '6 Months', value: 180 },
  { label: '1 Year', value: 365 },
];

export const LEAGUE_TYPES = {
  DURATION: 'duration',
  MATCHUP: 'matchup',
} as const;

export const LEAGUE_STATUS = {
  DRAFT_PENDING: 'draft_pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
} as const;

// Username validation rules
export const USERNAME_RULES = {
  minLength: 3,
  maxLength: 20,
  pattern: /^[a-zA-Z0-9_]+$/,
  patternDescription: 'letters, numbers, and underscores',
};

// Password validation rules — the SINGLE SOURCE OF TRUTH for both the signup
// requirements checklist and client-side validation, so the list is never
// written twice. This MUST match the Supabase Auth password policy
// (Dashboard -> Authentication -> Policies): min 8 chars, and at least one
// lowercase letter, uppercase letter, digit, and symbol. If the dashboard policy
// changes, change it here (and the mobile mirror at
// apps/mobile/constants/passwordRules.ts, which Metro can't import from here).
export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRequirement {
  id: string;
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (pw) => (pw || '').length >= PASSWORD_MIN_LENGTH },
  { id: 'lowercase', label: 'A lowercase letter (a–z)', test: (pw) => /[a-z]/.test(pw || '') },
  { id: 'uppercase', label: 'An uppercase letter (A–Z)', test: (pw) => /[A-Z]/.test(pw || '') },
  { id: 'digit', label: 'A number (0–9)', test: (pw) => /[0-9]/.test(pw || '') },
  { id: 'symbol', label: 'A symbol (! ? @ # …)', test: (pw) => /[^A-Za-z0-9]/.test(pw || '') },
];

// The requirements a password FAILS (empty array = valid). Drives both the
// pre-submit error message and the per-rule checkmarks.
export function failingPasswordRequirements(pw: string): PasswordRequirement[] {
  return PASSWORD_REQUIREMENTS.filter((r) => !r.test(pw));
}

// Back-compat alias; kept aligned to the real policy.
export const PASSWORD_RULES = {
  minLength: PASSWORD_MIN_LENGTH,
};
