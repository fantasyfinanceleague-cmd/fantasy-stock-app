-- Set up automatic cron schedules for weekly matchup processing
-- This migration creates the actual cron jobs that call the edge functions

-- Ensure extensions are enabled
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Remove any existing schedules with these names (idempotent)
do $$
begin
  perform cron.unschedule('process-weekly-matchups');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('snapshot-week-start');
exception when others then null;
end $$;

-- Schedule process-week-results to run every Friday at 9:30 PM UTC
-- (4:30 PM ET / 1:30 PM PT, 30 minutes after market close)
-- This processes the completed week's matchups and updates standings
select cron.schedule(
  'process-weekly-matchups',
  '30 21 * * 5',  -- minute hour day-of-month month day-of-week (Friday)
  $$
  select net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/process-week-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Schedule snapshot-week-start to run every Tuesday at 2:35 PM UTC
-- (9:35 AM ET / 6:35 AM PT, 5 minutes after market open)
-- This captures the starting prices for the new week's matchups
select cron.schedule(
  'snapshot-week-start',
  '35 14 * * 2',  -- minute hour day-of-month month day-of-week (Tuesday)
  $$
  select net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-start',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Instructions for setup:
-- After running this migration, add your service_role_key to Vault:
-- 1. Go to Supabase Dashboard → Integrations → Vault → Secrets tab
-- 2. Click "Add new secret"
-- 3. Name: service_role_key
-- 4. Secret: (paste your service_role_key from Project Settings → API)
--
-- Or via SQL:
-- select vault.create_secret('YOUR_SERVICE_ROLE_KEY_HERE', 'service_role_key');
