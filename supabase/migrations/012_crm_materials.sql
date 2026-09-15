-- Materials / Inventory tracking. No RLS, matching this app's existing convention
-- (access control lives at the Express route layer via requireAdmin, not Postgres).
create table materials (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  category text not null check (category in ('acrylic','led','vinyl','hardware','metal','other')),
  unit text not null default 'each',
  unit_cost numeric(10,2) not null default 0,
  quantity_on_hand numeric(10,2) not null default 0,
  reorder_threshold numeric(10,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table material_movements (
  id uuid default gen_random_uuid() primary key,
  material_id uuid not null references materials(id) on delete cascade,
  delta numeric(10,2) not null,
  reason text not null check (reason in ('purchase','used_on_order','adjustment','waste')),
  related_order_id uuid references orders(id) on delete set null,
  note text,
  employee_name text,
  created_at timestamptz not null default now()
);

create index on material_movements(material_id, created_at desc);
