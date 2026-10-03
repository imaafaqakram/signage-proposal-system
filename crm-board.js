// Luminus CRM — Phase 3: pipeline kanban board (backend)
//
// Mounted at /api/crm/board in server.js, next to the other CRM routers:
//
//   import { createCrmBoardRouter } from './crm-board.js'
//   app.use('/api/crm/board', createCrmBoardRouter({ requireAuth: requireBypassAuth }))
//
// Read-only. The board's drag-and-drop writes go through the EXISTING
// PATCH /api/crm/leads/:id/status endpoint (crm-leads.js) — this router does
// NOT reimplement stage writes.
//
// Self-contained: the only thing it touches is the shared CRM Supabase client
// exported from crm-db.js. Every route sits behind requireAuth.
//
// ── Bounded working set ──────────────────────────────────────────────────────
// A true pipeline board needs a stage for every lead that has ever existed.
// To keep every request O(bounded) — a handful of Supabase round-trips no
// matter how large the funnel — the board only reasons about the newest
// BOARD_LEAD_CAP (= 800) leads, ordered by `leads.id` DESC. Consequences the
// integrator should know:
//   * A lead older than that cutoff never appears on the board and is not
//     counted, even if it has a crm_lead_status row (e.g. an old `won`/`lost`).
//   * Recent leads skew heavily `new`, so in a mature funnel the `new` column's
//     count approaches the cap while the late-stage columns are the ones that
//     get truncated. Bump BOARD_LEAD_CAP if that becomes a problem — the scan
//     cost barely moves.
//   * `count` on each column is the real total for that stage *within the
//     working set*, not the all-time total.

import express from 'express'
import { _crmSupabase as supabase } from './crm-db.js'

const STAGES = ['new', 'contacted', 'responded', 'negotiating', 'won', 'lost']
const BOARD_LEAD_CAP = 800 // newest leads (by leads.id desc) the board considers
const COLUMN_LEAD_LIMIT = 50 // cards returned per column (count is still the real total)
const PAGE_SIZE = 1000 // Supabase caps a single select near here

/**
 * Page through a Supabase select in PAGE_SIZE chunks.
 * `build` must return a *fresh* query builder each call so .range() can apply.
 */
async function selectAll(build) {
  let from = 0
  const rows = []
  for (;;) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

/**
 * Build the working set and bucket it by stage. Shared by GET / and GET /counts.
 * Returns { buckets } — a Map keyed by every stage in STAGES, each value an
 * array of { id, owner, last_activity_at } ordered newest-first (leads.id desc).
 */
async function computeBuckets() {
  // Steps 1 and 2 don't depend on each other — the status fetch reads every
  // crm_lead_status row regardless of the leads working set, filtering against
  // it only happens after both are in hand — so they run together instead of
  // one after the other. Each round trip to Supabase from this VM runs
  // ~200-300ms, so every sequential await here was real, felt latency.

  // 1. Bounded working set: the newest BOARD_LEAD_CAP lead ids.
  const leadRowsPromise = supabase
    .from('leads')
    .select('id')
    .order('id', { ascending: false })
    .limit(BOARD_LEAD_CAP)

  // 2. Every crm_lead_status row, paged in 1000-row chunks.
  const statusRowsPromise = selectAll(() =>
    supabase.from('crm_lead_status').select('lead_id, stage, owner, last_activity_at'),
  )

  const [{ data: leadRows, error: leadErr }, statusRows] = await Promise.all([leadRowsPromise, statusRowsPromise])
  if (leadErr) throw leadErr
  const leadIds = (leadRows || []).map((r) => r.id)
  const inWorkingSet = new Set(leadIds)
  const statusByLead = new Map()
  for (const r of statusRows) {
    if (r.lead_id != null && inWorkingSet.has(r.lead_id)) statusByLead.set(r.lead_id, r)
  }

  // 3. Bucket. No status row → 'new'. An unrecognised stage value also falls
  //    back to 'new' so the per-column counts always sum to the working set.
  const buckets = new Map(STAGES.map((s) => [s, []]))
  for (const id of leadIds) {
    const st = statusByLead.get(id)
    const stage = st && STAGES.includes(st.stage) ? st.stage : 'new'
    buckets.get(stage).push({
      id,
      owner: (st && st.owner) || null,
      last_activity_at: (st && st.last_activity_at) || null,
    })
  }

  return { buckets }
}

export function createCrmBoardRouter({ requireAuth } = {}) {
  const router = express.Router()
  const auth = typeof requireAuth === 'function' ? requireAuth : (_req, _res, next) => next()
  router.use(auth) // every route below is authed

  // ───────────────────────────────────────────────────────────────────────────
  // GET /  — the whole board
  // { columns: [ { stage, count, leads: [ { id, client_name, contact_email,
  //   source_alias, owner, last_activity_at, has_proposal_pdf, has_thread } ] } ] }
  // One entry per stage, in STAGES order, up to COLUMN_LEAD_LIMIT leads each.
  // ───────────────────────────────────────────────────────────────────────────
  router.get('/', async (_req, res) => {
    try {
      const { buckets } = await computeBuckets()

      // The lead ids we will actually render (<= STAGES.length * COLUMN_LEAD_LIMIT).
      const shownIds = []
      for (const s of STAGES) {
        for (const row of buckets.get(s).slice(0, COLUMN_LEAD_LIMIT)) shownIds.push(row.id)
      }

      // Batched, display-only lookups for just those leads — no per-lead queries.
      const nameById = new Map()
      const aliasById = new Map()
      const pdfLeadIds = new Set()
      const threadLeadIds = new Set()

      if (shownIds.length) {
        const [names, aliases, pdfs, threads] = await Promise.all([
          supabase.from('leads').select('id, client_name, contact_email').in('id', shownIds),
          supabase
            .from('lead_versions')
            .select('lead_id, crm_source_alias, version_number, created_at')
            .in('lead_id', shownIds)
            .order('lead_id', { ascending: true })
            .order('version_number', { ascending: false })
            .order('created_at', { ascending: false }),
          supabase
            .from('crm_attachments')
            .select('lead_id')
            .eq('kind', 'proposal-pdf')
            .in('lead_id', shownIds),
          supabase.from('crm_threads').select('lead_id').in('lead_id', shownIds),
        ])
        if (names.error) throw names.error
        if (aliases.error) throw aliases.error
        if (pdfs.error) throw pdfs.error
        if (threads.error) throw threads.error

        for (const r of names.data || []) nameById.set(r.id, r)
        // rows are ordered newest version first — keep the first alias seen per lead
        for (const r of aliases.data || []) {
          if (!aliasById.has(r.lead_id)) aliasById.set(r.lead_id, r.crm_source_alias || null)
        }
        for (const r of pdfs.data || []) if (r.lead_id != null) pdfLeadIds.add(r.lead_id)
        for (const r of threads.data || []) if (r.lead_id != null) threadLeadIds.add(r.lead_id)
      }

      const columns = STAGES.map((stage) => {
        const bucket = buckets.get(stage)
        const leads = bucket.slice(0, COLUMN_LEAD_LIMIT).map((row) => {
          const info = nameById.get(row.id) || {}
          return {
            id: row.id,
            client_name: info.client_name || null,
            contact_email: info.contact_email || null,
            source_alias: aliasById.get(row.id) || null,
            owner: row.owner,
            last_activity_at: row.last_activity_at,
            has_proposal_pdf: pdfLeadIds.has(row.id),
            has_thread: threadLeadIds.has(row.id),
          }
        })
        return { stage, count: bucket.length, leads }
      })

      res.json({ columns })
    } catch (err) {
      console.error('[crm-board]', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ───────────────────────────────────────────────────────────────────────────
  // GET /counts — per-stage totals only: { new: n, contacted: n, ... }
  // Same bounded scan as GET /, minus the display lookups.
  // ───────────────────────────────────────────────────────────────────────────
  router.get('/counts', async (_req, res) => {
    try {
      const { buckets } = await computeBuckets()
      const out = {}
      for (const s of STAGES) out[s] = buckets.get(s).length
      res.json(out)
    } catch (err) {
      console.error('[crm-board]', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
