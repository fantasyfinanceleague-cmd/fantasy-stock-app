-- Enable realtime for drafts table so clients can subscribe to new picks
-- This allows all connected clients to see picks as they happen without manual refresh

alter publication supabase_realtime add table drafts;
