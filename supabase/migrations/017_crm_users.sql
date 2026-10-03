-- Personal CRM logins + faster per-record history.
--
-- crm_users holds one row per person (username, display name, role, password hash).
-- Passwords are stored only as salted scrypt hashes, never in plain text.
--
-- SECURITY: the browser bundle contains this project's public (anon) Supabase key, so
-- any table left readable by that key can be read by anyone who opens DevTools. Row
-- Level Security with NO policies, plus revoking the anon/authenticated grants, makes
-- this table reachable ONLY by the server's service-role key.
create table if not exists crm_users (
  id            uuid default gen_random_uuid() primary key,
  username      text not null unique,
  display_name  text not null,
  role          text not null default 'employee' check (role in ('admin', 'employee')),
  password_hash text not null,
  active        boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

alter table crm_users enable row level security;
revoke all on table crm_users from anon, authenticated;

-- The per-record history screen looks entries up by (entity_type, entity_id).
create index if not exists crm_activity_log_entity_idx
  on crm_activity_log (entity_type, entity_id, created_at desc);
