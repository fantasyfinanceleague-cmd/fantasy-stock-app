-- Function to update league standings after a matchup completes
create or replace function update_standings(
  p_league_id uuid,
  p_user_id text,
  p_won boolean,
  p_lost boolean,
  p_tied boolean,
  p_points_for numeric,
  p_points_against numeric
) returns void as $$
begin
  insert into league_standings (league_id, user_id, wins, losses, ties, points_for, points_against, updated_at)
  values (
    p_league_id,
    p_user_id,
    case when p_won then 1 else 0 end,
    case when p_lost then 1 else 0 end,
    case when p_tied then 1 else 0 end,
    p_points_for,
    p_points_against,
    now()
  )
  on conflict (league_id, user_id) do update set
    wins = league_standings.wins + case when p_won then 1 else 0 end,
    losses = league_standings.losses + case when p_lost then 1 else 0 end,
    ties = league_standings.ties + case when p_tied then 1 else 0 end,
    points_for = league_standings.points_for + p_points_for,
    points_against = league_standings.points_against + p_points_against,
    updated_at = now();
end;
$$ language plpgsql security definer;
