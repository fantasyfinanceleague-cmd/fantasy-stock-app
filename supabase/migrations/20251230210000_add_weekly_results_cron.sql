-- Enable pg_cron extension (if not already enabled)
create extension if not exists pg_cron;

-- For Supabase, the recommended approach is to use pg_net extension with pg_cron:
create extension if not exists pg_net;

-- Schedule the process-week-results function to run every Friday at 9:30 PM UTC
-- (4:30 PM ET, 30 minutes after market close to ensure all trades are settled)
--
-- Cron expression: minute hour day-of-month month day-of-week
-- '30 21 * * 5' = 21:30 UTC every Friday (day 5)
--
-- NOTE: You need to set up the cron job in Supabase Dashboard > Database > Extensions > pg_cron
-- Or use the Supabase Dashboard scheduled functions feature

-- Manual trigger function for testing/admin use
-- Uses the service_role key from Supabase vault
create or replace function trigger_week_processing()
returns bigint as $$
declare
  request_id bigint;
  supabase_url text := 'https://haiaaifjcclsvmkfqgmd.supabase.co';
  service_key text;
begin
  -- Get service role key from vault (must be stored there first)
  -- If not using vault, you can hardcode for testing but this is not recommended for production
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  -- If no vault secret, try with anon key (limited functionality)
  if service_key is null then
    service_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhaWFhaWZqY2Nsc3Zta2ZxZ21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjM2NzM4ODMsImV4cCI6MjAzOTI0OTg4M30.OmPOPSgDyF4mRAYOFof8OKHKk0SvpLLHPEVBSKBAXL4';
  end if;

  select net.http_post(
    url := supabase_url || '/functions/v1/process-week-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  ) into request_id;

  return request_id;
end;
$$ language plpgsql security definer;
