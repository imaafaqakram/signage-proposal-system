-- CRM Automation "Needs a Decision — Gone Quiet" panel: a lead that replied
-- (crm_lead_status.stage = 'responded') but has had no activity from either
-- side in 3+ days gets surfaced for a human to decide on, never auto-actioned.
-- Detection itself needs no new column (crm_lead_status.last_activity_at
-- already exists and is bumped on every inbound/outbound touch) — this just
-- adds a way to quiet one down until its next real activity.
alter table crm_lead_status add column if not exists stale_dismissed_at timestamptz;
