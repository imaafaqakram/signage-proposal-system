-- Client announcements ("Broadcast"): one message queued to many clients, sent 30 per hour.
--
-- crm_broadcasts            one row per announcement (subject, message, status, progress counters)
-- crm_broadcast_recipients  one row per client: pending -> sending -> sent / failed / skipped
--
-- The queue lives here (not in server memory) so a restart or redeploy never loses it, never
-- re-sends anyone, and never resets the "30 per hour" count (it is derived from attempted_at).
--
-- SECURITY: like crm_users, these tables hold client contact details, and the browser bundle
-- contains the project's public (anon) Supabase key — so Row Level Security with no policies
-- plus revoked grants makes them reachable only by the server's service-role key.
create table if not exists crm_broadcasts (
  id            uuid default gen_random_uuid() primary key,
  subject       text not null,
  body          text not null,
  status        text not null default 'sending' check (status in ('sending', 'paused', 'completed', 'cancelled')),
  total         integer not null default 0,
  sent_count    integer not null default 0,
  failed_count  integer not null default 0,
  skipped_count integer not null default 0,
  created_by    text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table if not exists crm_broadcast_recipients (
  id           uuid default gen_random_uuid() primary key,
  broadcast_id uuid not null references crm_broadcasts(id) on delete cascade,
  lead_id      bigint,
  email        text not null,
  name         text,
  position     integer not null default 0,
  status       text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempted_at timestamptz,
  sent_at      timestamptz,
  message_id   text,
  error        text,
  created_at   timestamptz not null default now(),
  unique (broadcast_id, email)
);

create index if not exists crm_broadcast_recipients_queue_idx   on crm_broadcast_recipients (broadcast_id, status, position);
create index if not exists crm_broadcast_recipients_attempt_idx on crm_broadcast_recipients (attempted_at) where attempted_at is not null;

alter table crm_broadcasts           enable row level security;
alter table crm_broadcast_recipients enable row level security;
revoke all on table crm_broadcasts           from anon, authenticated;
revoke all on table crm_broadcast_recipients from anon, authenticated;
