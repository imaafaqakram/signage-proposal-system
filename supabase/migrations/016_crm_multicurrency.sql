-- Multi-currency entry with automatic USD conversion.
--
-- Every existing money column (expenses.amount, orders.amount_charged / sales_tax,
-- purchase_orders.amount, materials.unit_cost) keeps meaning USD, so all totals, reports
-- and tax figures are untouched. When a cost is entered in another currency (say
-- 200,000 PKR) the server converts it to USD, stores the USD figure in the normal column,
-- and records what was actually typed plus the exchange rate used here:
--
--   { "currency": "PKR", "rate": 277.93, "original": { "amount": 200000 },
--     "asOf": "2026-09-21T00:02:31Z", "source": "open.er-api.com", "manual": false }
--
-- `rate` = units of that currency per 1 USD. It is locked in at save time, so a record
-- keeps the same USD value forever. NULL means the entry was made in USD.
alter table expenses        add column if not exists fx jsonb;
alter table orders          add column if not exists fx jsonb;
alter table purchase_orders add column if not exists fx jsonb;
alter table materials       add column if not exists fx jsonb;
