// Shared TypeScript types for Fantasy Stock

export interface League {
  id: string;
  name: string;
  type: 'duration' | 'matchup';
  commissioner_id: string;
  max_teams: number;
  draft_rounds: number;
  starting_budget: number;
  invite_code: string;
  status: 'draft_pending' | 'active' | 'completed';
  draft_date?: string;
  duration_days: number;
  num_weeks?: number;
  playoff_teams?: number;
  created_at: string;
}

export interface LeagueMember {
  id: string;
  league_id: string;
  user_id: string;
  joined_at: string;
  username?: string;
}

export interface UserProfile {
  id: string;
  username: string;
  created_at?: string;
}

export interface DraftPick {
  id: string;
  league_id: string;
  user_id: string;
  stock_symbol: string;
  stock_name: string;
  pick_number: number;
  round: number;
  price_at_pick: number;
  created_at: string;
}

export interface Portfolio {
  id: string;
  user_id: string;
  league_id: string;
  symbol: string;
  shares: number;
  avg_price: number;
  created_at: string;
}

export interface Stock {
  symbol: string;
  name: string;
  price: number;
  change?: number;
  changePercent?: number;
}
