-- Vendors & Purchase Orders. expenses.vendor (existing free-text field) is
-- deliberately left untouched — no backfill linking historical expense rows to
-- vendor_id. See crm-vendors.js's matchedExpenseTotals() for the query-time join.
create table vendors (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table purchase_orders (
  id uuid default gen_random_uuid() primary key,
  vendor_id uuid not null references vendors(id) on delete cascade,
  description text,
  amount numeric(10,2) not null,
  status text not null default 'ordered' check (status in ('ordered','received','partial','cancelled')),
  order_date date not null default current_date,
  expected_date date,
  received_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on purchase_orders(vendor_id, order_date desc);
