-- Add draft_status column to track draft lifecycle
alter table public.leagues
  add column if not exists draft_status text not null default 'not_started'
  check (draft_status in ('not_started', 'in_progress', 'completed'));

-- Add index for querying by status
create index if not exists leagues_draft_status_idx on leagues(draft_status);

-- Enable realtime for leagues table so clients can subscribe to status changes
alter publication supabase_realtime add table leagues;
