// CRM — Airtable "Projects" mirror (sync + read API).
//
//   import { syncAirtableProjects, createCrmProjectsRouter } from './crm-airtable-projects.js'
//   app.use('/api/crm/projects', createCrmProjectsRouter({ requireAuth }))
//
// This is the ONLY part of the CRM that talks to Airtable. It pulls a curated
// slice of each base's master "Projects" table into `crm_airtable_projects`
// (migration 007) — kept completely separate from `leads` / `lead_versions`.
//
// Uses the existing PAT (env CRM_API_TOKEN — same token migrate.py uses, no new
// token). Paginates sequentially with a small delay between pages, so peak rate
// stays well under Airtable's 5 req/s-per-base limit. Default sync window is the
// last 14 days by record-creation time (CREATED_TIME(), a built-in Airtable
// function — no dependency on any per-base "modified" field); a manual sync can
// widen that or pull everything.
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { _crmSupabase as supabase } from './crm-db.js'

const PAT = process.env.CRM_API_TOKEN
const API = 'https://api.airtable.com/v0'

// Every Airtable list call this module makes is logged to the SAME usage_log.jsonl
// migrate.py writes, so the Admin dashboard's "API Usage" counter and any monthly
// budgeting see these calls too (they count against the Airtable quota either way).
const USAGE_LOG =
  (process.env.MIGRATION_SCRIPT_DIR && path.join(process.env.MIGRATION_SCRIPT_DIR, 'usage_log.jsonl')) || null
function logAirtableCall() {
  if (!USAGE_LOG) return
  try {
    fs.appendFileSync(USAGE_LOG, JSON.stringify({ ts: Date.now() / 1000, kind: 'airtable' }) + '\n')
  } catch {
    /* best-effort, mirrors migrate.py */
  }
}

// alias → { baseId, tableId }.  Table ids are the master "Projects" table in
// each base (400-500 fields), the same tables migrate.py fetches leads from.
const BASES = [
  { alias: 'Brown', baseId: 'apphaeSdThQQ8dbA8', tableId: 'tblDogFZSYftAaSAc' },
  { alias: 'Black', baseId: 'appF4rxgm3BfhpCrn', tableId: 'tbleyyQFHguc2YQNJ' },
  { alias: 'Blue',  baseId: 'appYzqtP4X3BDRXTZ', tableId: 'tbl8nlpdA6Q6bacKJ' },
  { alias: 'White', baseId: 'appzWDi7CP5aUcXZw', tableId: 'tbl8XC0h6psQ2oRDo' }
]

const PAGE_DELAY_MS = 260 // ~3.8 req/s per base, under the 5/s cap
const PAGE_SIZE = 100 // Airtable max — fewer pages = fewer API calls
const DEFAULT_SYNC_DAYS = 14 // recent leads only; "Full sync" (all=true) ignores this
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── field extraction ──────────────────────────────────────
// Field names drift slightly between bases (trailing spaces, singular/plural),
// so every value is looked up through a fallback chain.
function pick(f, ...names) {
  for (const n of names) {
    const v = f[n]
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) return v
  }
  return null
}
const asText = (v) => {
  if (v == null) return null
  let s
  if (Array.isArray(v)) s = v.map((x) => (typeof x === 'object' ? x.name || x.text || '' : x)).filter(Boolean).join(', ')
  else if (typeof v === 'object') s = v.name || v.text || v.url || JSON.stringify(v)
  else s = String(v)
  s = s.trim()
  return s === '' ? null : s
}
const asNum = (v) => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
const asBool = (v) => (v === true || v === 'true' || v === 1 ? true : v === false || v == null ? false : Boolean(v))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const attUrl = (v) => {
  if (Array.isArray(v) && v[0]) return v[0].url || null
  if (typeof v === 'string' && /^https?:\/\//.test(v)) return v
  return null
}

function mapRecord(alias, rec) {
  const f = rec.fields || {}
  const curated = {
    name: asText(pick(f, 'Name')),
    email: asText(pick(f, 'Email')),
    phone: asText(pick(f, 'Phone Formula', 'Phone')),
    // Brown/Black carry a real sales status ("Proposal Sent", "Won", "Lost", …);
    // Blue/White only track a funnel stage in "Journey" (New/Visited/Purchased).
    status: asText(pick(f, 'Status', 'Call Status', 'Call Status ', 'Call Status :', 'Journey')),
    call_status: asText(pick(f, 'Call Status', 'Call Status ', 'Call Status :')),
    sign_type: asText(pick(f, 'Default Sign Type', 'Sign Type')),
    details: asText(pick(f, 'Details')),
    quote_value: asNum(pick(f, 'Avg. Quote Value')),
    user_preferred_price: asNum(pick(f, 'Revised User Preferred Price', 'User Preferred Price')),
    discounted_value: asNum(pick(f, 'Discounted Quote Value')),
    lead_source: asText(pick(f, 'Lead Source')),
    proposal_sent: asBool(pick(f, 'Proposal Sent?')),
    last_email_stage: asText(pick(f, 'Last email sent was :')),
    followup_status: asText(pick(f, 'Followup Emails Status', 'Follow up emails status ', 'Follow emails status ')),
    airtable_modified_at: asDate(pick(f, 'Last Modified', 'Last_Modified', 'Last Modified Time')),
    proposal_link: asText(pick(f, 'New Link')),
    payment_link: asText(pick(f, 'Payment Link')),
    mockup_url: attUrl(pick(f, 'Mockup', 'Image'))
  }
  return {
    base_alias: alias,
    airtable_id: rec.id,
    ...curated,
    airtable_created_at: asDate(rec.createdTime || pick(f, 'CreatedAt', 'Created_at_Auto_AT', 'Date & Time')),
    raw: curated,
    synced_at: new Date().toISOString()
  }
}

// ── one page of a base's Projects table ───────────────────
async function fetchPage(base, { formula, offset }, retry = 0) {
  const u = new URL(`${API}/${base.baseId}/${base.tableId}`)
  u.searchParams.set('pageSize', String(PAGE_SIZE))
  if (formula) u.searchParams.set('filterByFormula', formula)
  if (offset) u.searchParams.set('offset', offset)
  logAirtableCall()
  const res = await fetch(u, { headers: { Authorization: `Bearer ${PAT}` } })
  if (res.status === 429 && retry < 4) {
    await sleep(31000) // Airtable's documented 30s lockout
    return fetchPage(base, { formula, offset }, retry + 1)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Airtable ${base.alias} ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function upsertRows(rows) {
  if (!rows.length) return
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const { error } = await supabase
      .from('crm_airtable_projects')
      .upsert(chunk, { onConflict: 'base_alias,airtable_id' })
    if (error) throw error
  }
}

let running = false

/**
 * @param {object}  opts
 * @param {number}  opts.days         look-back window by record creation time (default 14)
 * @param {boolean} opts.all          ignore the window, pull the whole table
 * @param {string}  opts.triggeredBy  'daily' | 'manual'
 */
export async function syncAirtableProjects({ days = DEFAULT_SYNC_DAYS, all = false, triggeredBy = 'daily' } = {}) {
  if (!PAT) throw new Error('CRM_API_TOKEN not set — cannot sync Airtable projects')
  if (running) return { skipped: true, reason: 'a sync is already running' }
  running = true

  const startedAt = new Date().toISOString()
  const perBase = {}
  let scanned = 0
  let upserted = 0
  await supabase.from('crm_airtable_sync_state').update({
    started_at: startedAt, finished_at: null, ok: null, error: null, triggered_by: triggeredBy
  }).eq('id', 1)

  const formula = all
    ? null
    : `IS_AFTER(CREATED_TIME(), DATEADD(TODAY(), -${Math.max(1, Math.round(days))}, 'days'))`

  try {
    for (const base of BASES) {
      let offset
      let baseScanned = 0
      let baseUpserted = 0
      do {
        const page = await fetchPage(base, { formula, offset })
        const rows = (page.records || []).map((r) => mapRecord(base.alias, r))
        await upsertRows(rows)
        baseScanned += rows.length
        baseUpserted += rows.length
        offset = page.offset
        if (offset) await sleep(PAGE_DELAY_MS)
      } while (offset)
      perBase[base.alias] = { scanned: baseScanned, upserted: baseUpserted }
      scanned += baseScanned
      upserted += baseUpserted
    }

    const finishedAt = new Date().toISOString()
    await supabase.from('crm_airtable_sync_state').update({
      finished_at: finishedAt, ok: true, scanned, upserted, per_base: perBase, error: null
    }).eq('id', 1)
    return { ok: true, startedAt, finishedAt, scanned, upserted, perBase }
  } catch (err) {
    await supabase.from('crm_airtable_sync_state').update({
      finished_at: new Date().toISOString(), ok: false, error: err.message, per_base: perBase
    }).eq('id', 1)
    throw err
  } finally {
    running = false
  }
}

// ── read API ──────────────────────────────────────────────
export function createCrmProjectsRouter({ requireAuth } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())

  const STATUS_BUCKETS = ['New', 'In Progress', 'Won', 'Lost', 'Cold Lead']

  // GET /  — paginated list; ?base= ?status= ?q= ?limit= ?offset= ?sort=
  router.get('/', auth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50))
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)
      const sort = req.query.sort === 'value' ? 'user_preferred_price' : 'airtable_created_at'

      let q = supabase
        .from('crm_airtable_projects')
        .select(
          'id, base_alias, airtable_id, name, email, phone, status, sign_type, ' +
          'user_preferred_price, quote_value, lead_source, proposal_sent, ' +
          'last_email_stage, followup_status, airtable_created_at, proposal_link, payment_link',
          { count: 'exact' }
        )
      if (req.query.base) q = q.eq('base_alias', req.query.base)
      if (req.query.status) q = q.eq('status', req.query.status)
      if (req.query.q) {
        const term = String(req.query.q).replace(/[%,]/g, '').trim()
        if (term) q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%,details.ilike.%${term}%`)
      }
      q = q.order(sort, { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1)

      const { data, count, error } = await q
      if (error) throw error
      res.json({ rows: data || [], total: count || 0, limit, offset })
    } catch (err) {
      console.error('[crm-projects] list', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /summary  — counts by base + status, and last-sync state
  router.get('/summary', auth, async (_req, res) => {
    try {
      const rows = []
      let from = 0
      for (;;) {
        const { data, error } = await supabase
          .from('crm_airtable_projects')
          .select('base_alias, status')
          .range(from, from + 999)
        if (error) throw error
        rows.push(...data)
        if (data.length < 1000) break
        from += 1000
      }
      const byBase = {}
      const byStatus = {}
      for (const r of rows) {
        byBase[r.base_alias] = (byBase[r.base_alias] || 0) + 1
        const s = r.status || '—'
        byStatus[s] = (byStatus[s] || 0) + 1
      }
      const { data: state } = await supabase
        .from('crm_airtable_sync_state').select('*').eq('id', 1).maybeSingle()
      res.json({ total: rows.length, byBase, byStatus, statusOrder: STATUS_BUCKETS, sync: state || null })
    } catch (err) {
      console.error('[crm-projects] summary', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /:id  — one row, full curated snapshot
  router.get('/:id', auth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('crm_airtable_projects').select('*').eq('id', req.params.id).maybeSingle()
      if (error) throw error
      if (!data) return res.status(404).json({ error: 'not found' })
      res.json(data)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // POST /sync  — manual trigger. ?days=N or ?all=1. Fire-and-forget: a full
  // sweep can take a couple of minutes, so we kick it off and let the UI poll
  // GET /summary (the crm_airtable_sync_state row) for progress + result.
  router.post('/sync', auth, async (req, res) => {
    const all = req.query.all === '1' || req.body?.all === true
    const days = parseInt(req.query.days || req.body?.days, 10)
    const opts = { all, days: Number.isFinite(days) ? days : DEFAULT_SYNC_DAYS, triggeredBy: 'manual' }
    if (running) return res.status(409).json({ error: 'a sync is already running' })
    syncAirtableProjects(opts).catch((err) => console.error('[crm-projects] manual sync failed:', err.message))
    res.status(202).json({ started: true, ...opts })
  })

  return router
}
