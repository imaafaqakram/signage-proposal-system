-- Team Activity (name-tag): a clean, purpose-built log for general CRM actions.
-- Distinct from the older employee-activity.log file, which is narrowly scoped to
-- the Airtable-fetch feature. Every insert is fire-and-forget from crm-db.js's
-- logCrmActivity() — never blocks the write it's describing.
create table crm_activity_log (
  id uuid default gen_random_uuid() primary key,
  employee_name text,
  action text not null,
  entity_type text,
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index on crm_activity_log(created_at desc);
