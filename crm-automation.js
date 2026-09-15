// Luminus CRM — Automation tab API.
//
// Mounted at /api/crm/automation in server.js:
//   app.use('/api/crm/automation', createCrmAutomationRouter({ requireAuth: requireBypassAuth }))
//
// This is the "who gets contacted automatically" control surface. It does NOT own the
// follow-up drip's cadence settings (first-delay/interval/max count) — those stay exactly
// where they've always been, behind the separate admin-password tier
// (GET/POST /api/admin/settings, requireAdmin) — the CRM Automation page calls those
// same routes directly with the admin session, it doesn't duplicate them.
//
// What this router DOES own, under the normal employee CRM login:
//   - the Do-Not-Contact list (leads.follow_up_stopped_at IS NOT NULL) — view + resume
//   - stopping a lead's follow-ups by hand (the same action as the Proposal System's
//     🔕 button, exposed here too so it doesn't only live in the other app)
//   - a lightweight lead search, so a lead can be added to the DNC list without hunting
//     for them in the Proposal System's Saved Leads panel first
//   - a "who actually got a follow-up email" list (leads.follow_up_count > 0)
//   - a "gone quiet" list: leads at stage='responded' with no activity in 3+ days,
//     surfaced for a human decision only — never auto-actioned
//
// Every route here reads/writes ONLY the `leads` table (real CRM leads that the
// follow-up drip actually emails). It never touches `crm_airtable_projects` — the
// read-only Airtable "Projects" mirror shown on the Projects tab has no follow-up
// columns at all and plays no part in who gets a follow-up email. Deliberate: this
// list must always be provably "our real leads only," never the Airtable mirror.
//
// Self-contained like every other CRM module: only touches crm-db.js's shared Supabase
// client, and only ever writes the single follow_up_stopped_at column on `leads`.
import express from 'express'
import { _crmSupabase as supabase, logCrmActivity } from './crm-db.js'

const LEAD_COLS = 'id, client_name, contact_email, email_sent_at, follow_up_stopped_at, follow_up_count, follow_up_last_sent_at'

// A lead that replied sits at stage='responded' — if nothing has happened on it
// (from either side) for this many days, it's gone quiet and needs a human
// decision, not an automatic action.
const STALE_DAYS = 3

async function fetchStaleResponded(term) {
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString()
  let { data: statusRows, error } = await supabase
    .from('crm_lead_status')
    .select('lead_id, last_activity_at, stale_dismissed_at')
    .eq('stage', 'responded')
    .lt('last_activity_at', cutoff)
    .order('last_activity_at', { ascending: true })
    .limit(500)
  if (error && /stale_dismissed_at/i.test(error.message || '')) {
    // Migration 011 (crm_lead_status.stale_dismissed_at) hasn't been run yet —
    // degrade instead of breaking the whole card: everything reads as "not
    // dismissed," which is the correct default anyway. Self-heals with no
    // further deploy once the column exists.
    ;({ data: statusRows, error } = await supabase
      .from('crm_lead_status')
      .select('lead_id, last_activity_at')
      .eq('stage', 'responded')
      .lt('last_activity_at', cutoff)
      .order('last_activity_at', { ascending: true })
      .limit(500))
  }
  if (error) throw error

  // stale_dismissed_at is compared against last_activity_at in JS, not the DB query,
  // since PostgREST's simple filter syntax can't compare one column to another —
  // dismissing just quiets a lead until its NEXT real activity, not permanently.
  const stale = (statusRows || []).filter(
    (r) => !r.stale_dismissed_at || new Date(r.stale_dismissed_at) < new Date(r.last_activity_at)
  )
  if (!stale.length) return []

  const leadIds = stale.map((r) => r.lead_id)
  const { data: leads, error: lErr } = await supabase
    .from('leads').select('id, client_name, contact_email').in('id', leadIds)
  if (lErr) throw lErr
  const leadMap = new Map((leads || []).map((l) => [l.id, l]))

  // Most recent thread per lead, so the UI can deep-link straight into the right
  // conversation (CrmInbox.vue already auto-opens ?thread=<id> on load).
  const { data: threads, error: tErr } = await supabase
    .from('crm_threads').select('id, lead_id, last_message_at')
    .in('lead_id', leadIds).order('last_message_at', { ascending: false })
  if (tErr) throw tErr
  const threadMap = new Map()
  for (const t of threads || []) if (!threadMap.has(t.lead_id)) threadMap.set(t.lead_id, t.id)

  let rows = stale.map((r) => {
    const lead = leadMap.get(r.lead_id) || {}
    return {
      leadId: r.lead_id,
      clientName: lead.client_name || null,
      contactEmail: lead.contact_email || null,
      lastActivityAt: r.last_activity_at,
      daysSince: Math.floor((Date.now() - new Date(r.last_activity_at).getTime()) / 86400000),
      threadId: threadMap.get(r.lead_id) || null
    }
  })
  if (term) {
    const t = term.toLowerCase()
    rows = rows.filter((r) => (r.clientName || '').toLowerCase().includes(t) || (r.contactEmail || '').toLowerCase().includes(t))
  }
  return rows
}

export function createCrmAutomationRouter({ requireAuth, requireAdmin } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())
  const adminAuth = requireAdmin || ((req, res, next) => next())
  const jsonBody = express.json({ limit: '64kb' })

  // GET /summary — quick counts for the page header. No admin-settings values here on
  // purpose (those need the admin session; the frontend fetches them separately).
  router.get('/summary', auth, async (_req, res) => {
    try {
      const { count: dncCount, error: e1 } = await supabase
        .from('leads').select('*', { count: 'exact', head: true }).not('follow_up_stopped_at', 'is', null)
      if (e1) throw e1
      const { count: candidateCount, error: e2 } = await supabase
        .from('leads').select('*', { count: 'exact', head: true })
        .not('email_sent_at', 'is', null).is('follow_up_stopped_at', null)
      if (e2) throw e2
      const { count: sentCount, error: e3 } = await supabase
        .from('leads').select('*', { count: 'exact', head: true }).gt('follow_up_count', 0)
      if (e3) throw e3
      const staleRows = await fetchStaleResponded('')
      res.json({ dncCount: dncCount || 0, candidateCount: candidateCount || 0, sentCount: sentCount || 0, staleCount: staleRows.length })
    } catch (err) {
      console.error('[crm-automation] summary', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /sent?limit=&offset=&q= — every lead that has actually received at least one
  // follow-up email, newest-sent first. Reads ONLY `leads.follow_up_count`/
  // `follow_up_last_sent_at` — this is the audit trail for "who did we actually email,"
  // scoped to real CRM leads and nothing from the Airtable Projects mirror.
  router.get('/sent', auth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50))
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)
      let q = supabase
        .from('leads')
        .select(LEAD_COLS, { count: 'exact' })
        .gt('follow_up_count', 0)
        .order('follow_up_last_sent_at', { ascending: false })
        .range(offset, offset + limit - 1)
      const term = (req.query.q || '').toString().replace(/[%,]/g, '').trim()
      if (term) q = q.or(`client_name.ilike.%${term}%,contact_email.ilike.%${term}%`)
      const { data, count, error } = await q
      if (error) throw error
      res.json({ rows: data || [], total: count || 0, limit, offset })
    } catch (err) {
      console.error('[crm-automation] sent list', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /dnc?limit=&offset=&q= — everyone currently excluded from the drip.
  router.get('/dnc', auth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50))
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)
      let q = supabase
        .from('leads')
        .select(LEAD_COLS, { count: 'exact' })
        .not('follow_up_stopped_at', 'is', null)
        .order('follow_up_stopped_at', { ascending: false })
        .range(offset, offset + limit - 1)
      const term = (req.query.q || '').toString().replace(/[%,]/g, '').trim()
      if (term) q = q.or(`client_name.ilike.%${term}%,contact_email.ilike.%${term}%`)
      const { data, count, error } = await q
      if (error) throw error
      res.json({ rows: data || [], total: count || 0, limit, offset })
    } catch (err) {
      console.error('[crm-automation] dnc list', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /search?q= — find a lead to add to the DNC list by hand. Requires 2+ characters
  // so this never accidentally lists the whole table.
  router.get('/search', auth, async (req, res) => {
    try {
      const term = (req.query.q || '').toString().replace(/[%,]/g, '').trim()
      if (term.length < 2) return res.json({ rows: [] })
      const { data, error } = await supabase
        .from('leads')
        .select(LEAD_COLS)
        .or(`client_name.ilike.%${term}%,contact_email.ilike.%${term}%`)
        .order('updated_at', { ascending: false })
        .limit(20)
      if (error) throw error
      res.json({ rows: data || [] })
    } catch (err) {
      console.error('[crm-automation] search', err)
      res.status(500).json({ error: err.message })
    }
  })

  // POST /:id/stop — add to the Do-Not-Contact list (idempotent).
  router.post('/:id/stop', auth, jsonBody, async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })
      const { error } = await supabase
        .from('leads')
        .update({ follow_up_stopped_at: new Date().toISOString() })
        .eq('id', id)
        .is('follow_up_stopped_at', null)
      if (error) throw error
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm-automation] stop', err)
      res.status(500).json({ error: err.message })
    }
  })

  // POST /:id/resume — take off the Do-Not-Contact list.
  router.post('/:id/resume', auth, jsonBody, async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })
      const { error } = await supabase.from('leads').update({ follow_up_stopped_at: null }).eq('id', id)
      if (error) throw error
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm-automation] resume', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /stale-responded?limit=&offset=&q= — leads that replied but have had zero
  // activity (from either side) in STALE_DAYS days. Never auto-actioned — this is
  // purely "flag it for a human to decide," per the owner's explicit instruction.
  router.get('/stale-responded', auth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50))
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)
      const term = (req.query.q || '').toString().trim()
      const rows = await fetchStaleResponded(term)
      res.json({ rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset })
    } catch (err) {
      console.error('[crm-automation] stale-responded', err)
      res.status(500).json({ error: err.message })
    }
  })

  // POST /:id/dismiss-stale — quiets this lead's stale flag until its NEXT real
  // activity (not a permanent mute — see fetchStaleResponded's comparison above).
  router.post('/:id/dismiss-stale', auth, jsonBody, async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })
      const { error } = await supabase
        .from('crm_lead_status')
        .update({ stale_dismissed_at: new Date().toISOString() })
        .eq('lead_id', id)
      if (error && /stale_dismissed_at/i.test(error.message || '')) {
        // Migration 011 hasn't been run yet — there's genuinely nowhere to persist
        // a dismissal without that column. Fail clearly rather than a raw 500.
        return res.status(503).json({ error: 'Not available yet — a pending database migration needs to be run first.' })
      }
      if (error) throw error
      const name = (req.headers['x-employee-name'] || '').toString().trim().slice(0, 80) || null
      logCrmActivity({ employeeName: name, action: 'stale.dismiss', entityType: 'lead', entityId: id })
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm-automation] dismiss-stale', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /team-activity?days= — admin-only, despite living on the employee-tier
  // automation router: the router's other routes take `auth`, this one takes the
  // stricter `adminAuth` instead, same DI pattern used everywhere else for mixed-tier
  // access (see server.js passing both requireAuth and requireAdmin in here).
  router.get('/team-activity', adminAuth, async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30))
      const cutoff = new Date(Date.now() - days * 86400000).toISOString()
      const { data, error } = await supabase
        .from('crm_activity_log')
        .select('employee_name, action, entity_type, entity_id, meta, created_at')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error && /relation .*crm_activity_log.* does not exist/i.test(error.message || '')) {
        // Migration for crm_activity_log hasn't been run yet — degrade to an empty,
        // clearly-labeled list rather than a raw 500.
        return res.json({ rows: [], migrationPending: true })
      }
      if (error) throw error
      res.json({ rows: data || [] })
    } catch (err) {
      console.error('[crm-automation] team-activity', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
