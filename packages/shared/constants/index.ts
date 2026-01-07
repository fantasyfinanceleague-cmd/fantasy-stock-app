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

// Password validation rules
export const PASSWORD_RULES = {
  minLength: 6,
};
