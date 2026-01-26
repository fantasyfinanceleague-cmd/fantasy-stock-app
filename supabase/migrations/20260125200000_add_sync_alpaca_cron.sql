-- Add cron job to sync trades with Alpaca daily
-- Runs at 9:30 PM UTC (4:30 PM ET) after market close on weekdays

-- Remove existing schedule if it exists (idempotent)
do $$
begin
  perform cron.unschedule('sync-alpaca-orders');
exception when others then null;
end $$;

-- Schedule sync-alpaca-orders to run every weekday at 9:30 PM UTC
-- (4:30 PM ET / 1:30 PM PT, 30 minutes after market close)
select cron.schedule(
  'sync-alpaca-orders',
  '30 21 * * 1-5',  -- minute hour day-of-month month day-of-week (Mon-Fri)
  $$
  select net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/sync-alpaca-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
    ),
    body := '{"mode": "sync-all"}'::jsonb
  );
  $$
);

-- Add comment
comment on extension pg_cron is 'Job scheduler - includes sync-alpaca-orders daily at market close';
