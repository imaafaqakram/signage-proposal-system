-- CRM Orders ledger — admin-only (requireAdmin, see crm-orders.js), separate
-- from the estimated proposal pricing that already lives in lead_versions.data
-- (that figure is only the first pricing tier and isn't necessarily what a
-- client actually bought). This is the authoritative "what did we actually
-- charge" record.
create table if not exists orders (
  id uuid default gen_random_uuid() primary key,
  lead_id integer references leads(id) on delete set null,
  client_name text not null,
  client_email text,
  description text,
  amount_charged numeric(10,2) not null,
  sales_tax numeric(10,2) not null default 0,
  total_amount numeric(10,2) generated always as (amount_charged + sales_tax) stored,
  currency text not null default 'USD',
  status text not null default 'paid' check (status in ('paid','pending','partial','refunded')),
  payment_method text,
  order_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_order_date on orders(order_date desc);
create index if not exists idx_orders_lead_id on orders(lead_id);
create index if not exists idx_orders_status on orders(status);

-- No RLS — matches every other CRM/leads table in this app (checked
-- 004_add_leads_tables.sql). Every read/write goes through the server's
-- service-role Supabase client (crm-db.js's _crmSupabase export), itself
-- gated by requireAdmin — access control lives at the application layer here,
-- not in Postgres policies.
