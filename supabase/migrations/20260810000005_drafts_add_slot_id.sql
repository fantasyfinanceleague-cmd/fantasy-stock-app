-- In-house simulator (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 2)
-- Binding consequence #2 (simulator-recon.md, Phase 0.5).
--
-- WHAT: add ONLY `slot_id` to `drafts` — a nullable FK to league_draft_slots
--   recording which draft slot a pick fills.
--
-- WHY ONLY slot_id: the spec sketch (line 71) also lists quantity / entry_price
--   / entry_at, but Phase 0.5 proved:
--     - `drafts.quantity`     ALREADY EXISTS (widened to numeric in
--                             20260810000000 — do NOT re-add).
--     - `drafts.entry_price`  ALREADY EXISTS (numeric NOT NULL — do NOT re-add).
--     - `entry_at`            is served by the existing `drafts.draft_date`
--                             (timestamp WITHOUT time zone, default now()). No
--                             parallel entry_at column is added. NOTE: draft_date
--                             is the lone timestamp-without-tz column on the
--                             table while every other timestamp is timestamptz;
--                             this asymmetry is LEFT AS-IS in Phase 2 (a type
--                             migration is a separate cleanup, flagged not fixed).
--   Adding any of those three would duplicate an existing column — exactly the
--   "assuming absence" footgun the Phase 0.5 gate exists to prevent.
--
-- Depends on league_draft_slots (20260810000004) for the FK target.
--
-- SAFETY: `slot_id` is confirmed ABSENT (Phase 0.5 lists all 17 drafts columns;
--   slot_id is not among them). Nullable FK, ON DELETE SET NULL so removing a
--   slot definition never deletes picks. `if not exists` guards the ADD.
--
-- HUMAN ACTION: `supabase db push` is Giorgio's.

alter table drafts
  add column if not exists slot_id uuid null
    references league_draft_slots(id) on delete set null;

create index if not exists drafts_slot_id_idx on drafts(slot_id);
