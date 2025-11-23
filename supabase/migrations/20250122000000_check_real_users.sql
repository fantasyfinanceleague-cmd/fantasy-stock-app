-- Function to check which user IDs from a list are real auth users
-- Returns an array of user IDs that exist in auth.users

create or replace function get_real_user_ids(user_ids text[])
returns text[]
language sql
security definer
as $$
  select array_agg(id::text)
  from auth.users
  where id::text = any(user_ids);
$$;

-- Grant execute permission to authenticated users
grant execute on function get_real_user_ids(text[]) to authenticated;
grant execute on function get_real_user_ids(text[]) to anon;
