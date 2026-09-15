-- CRM Expense tracker — admin-only (requireAdmin, see crm-expenses.js).
-- Feeds the combined Revenue/Expenses/Net-Profit business report alongside
-- the orders table (009_crm_orders.sql).
create table if not exists expenses (
  id uuid default gen_random_uuid() primary key,
  category text not null check (category in ('ad_spend','shipping','tax','materials','software','other')),
  description text,
  amount numeric(10,2) not null,
  vendor text,
  expense_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_expenses_expense_date on expenses(expense_date desc);
create index if not exists idx_expenses_category on expenses(category);

-- No RLS — same reasoning as orders (009_crm_orders.sql): access control is
-- at the application layer (requireAdmin), matching every other CRM table.
