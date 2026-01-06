-- Schedule the snapshot-week-start function to run every Tuesday at 2:30 PM UTC
-- (9:30 AM ET, market open)
--
-- Cron expression: minute hour day-of-month month day-of-week
-- '30 14 * * 2' = 14:30 UTC every Tuesday (day 2)
--
-- NOTE: You need to set up the cron job in Supabase Dashboard > Database > Extensions > pg_cron
-- Or use the Supabase Dashboard scheduled functions feature

-- Manual trigger function for testing/admin use
create or replace function trigger_week_snapshot()
returns bigint as $$
declare
  request_id bigint;
  supabase_url text := 'https://haiaaifjcclsvmkfqgmd.supabase.co';
  service_key text;
begin
  -- Get service role key from vault (must be stored there first)
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  -- If no vault secret, try with anon key (limited functionality)
  if service_key is null then
    service_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhaWFhaWZqY2Nsc3Zta2ZxZ21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjM2NzM4ODMsImV4cCI6MjAzOTI0OTg4M30.OmPOPSgDyF4mRAYOFof8OKHKk0SvpLLHPEVBSKBAXL4';
  end if;

  select net.http_post(
    url := supabase_url || '/functions/v1/snapshot-week-start',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  ) into request_id;

  return request_id;
end;
$$ language plpgsql security definer;

-- Comment explaining usage
comment on function trigger_week_snapshot is
  'Manually trigger week start snapshot. Run this at Tuesday 9:30 AM ET market open.';
