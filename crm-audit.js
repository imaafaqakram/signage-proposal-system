// Luminus CRM — audit trail: WHO created / edited / deleted what, with before → after.
//
// Everything is recorded in the existing crm_activity_log table (migration 014) — no new
// table: `employee_name` carries the acting user's name, `meta` carries
//   { label, changes: { field: { from, to } }, snapshot, user: { id, role, via } }.
// `via` is 'personal' when the actor came from a real per-user login (crm-auth.js) and
// 'shared' when they used the old shared password (then the name is just whatever they
// typed at login — an honor-system label, and the history says so).
//
// auditWrite() is an Express middleware you put in front of a create/edit/delete route.
// It never changes what the route does: it snapshots the row before an edit/delete, lets
// the handler run untouched, and — only if the handler succeeded — logs the result after
// the response has already been sent, so auditing can neither slow a save down nor make
// one fail. (logCrmActivity swallows its own errors for the same reason.)
import express from 'express'
import { _crmSupabase as supabase, logCrmActivity } from './crm-db.js'

// Records whose history only admin-tier users may read (they hold money data).
export const MONEY_ENTITY_TYPES = new Set(['expense', 'order', 'material', 'vendor', 'purchase_order'])

export function getActor(req) {
  if (req.crmUser) return { id: req.crmUser.id, name: req.crmUser.name, role: req.crmUser.role, via: 'personal' }
  const name = (req.headers['x-employee-name'] || '').toString().trim().slice(0, 80) || null
  return { id: null, name, role: null, via: 'shared' }
}

const IGNORED_FIELDS = new Set(['id', 'created_at', 'updated_at'])

function norm(v) {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  return v
}

function fxLabel(fx) {
  if (!fx || !fx.currency || fx.currency === 'USD') return 'USD'
  const first = fx.original ? Object.values(fx.original)[0] : null
  return first != null ? `${fx.currency} ${Number(first).toLocaleString('en-US')} @ ${fx.rate}` : `${fx.currency} @ ${fx.rate}`
}

/** { field: { from, to } } for every field present on both sides whose value changed. */
export function diffRows(before, after) {
  const changes = {}
  if (!before || !after) return changes
  for (const key of Object.keys(after)) {
    if (IGNORED_FIELDS.has(key) || !(key in before)) continue
    if (norm(before[key]) === norm(after[key])) continue
    if (key === 'fx') changes.fx = { from: fxLabel(before.fx), to: fxLabel(after.fx) }
    else changes[key] = { from: before[key] ?? null, to: after[key] ?? null }
  }
  return changes
}

function snapshotOf(row) {
  if (!row) return null
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (IGNORED_FIELDS.has(k) || v === null || v === undefined || v === '') continue
    out[k] = k === 'fx' ? fxLabel(v) : v
  }
  return out
}

/**
 * @param table      table to snapshot before an edit/delete
 * @param prefix     action prefix — 'expense' -> expense.create / expense.update / expense.delete
 * @param entityType stored in entity_type (drives who may read the history)
 * @param resultKey  key of the row in the handler's JSON response ({ ok, expense: {...} });
 *                   omit when the response body IS the row
 * @param idColumn   primary-key column of `table` (default 'id')
 * @param labelOf    row -> short human label shown in the history ("Facebook ads · Meta")
 */
export function auditWrite({ table, prefix, entityType, resultKey, idColumn = 'id', labelOf }) {
  return async function auditMiddleware(req, res, next) {
    const method = req.method
    const isEdit = method === 'PATCH' || method === 'PUT'
    const isDelete = method === 'DELETE'
    const id = req.params.id

    let before = null
    if ((isEdit || isDelete) && id != null) {
      try {
        const { data } = await supabase.from(table).select('*').eq(idColumn, id).maybeSingle()
        before = data || null
      } catch { before = null }
      req.auditBefore = before // handlers that need the current row can reuse it (saves a query)
    }

    let payload
    const originalJson = res.json.bind(res)
    res.json = (body) => { payload = body; return originalJson(body) }

    res.on('finish', () => {
      if (res.statusCode >= 400) return
      try {
        const actor = getActor(req)
        const user = { id: actor.id, role: actor.role, via: actor.via }
        const rowOf = (p) => (resultKey ? p?.[resultKey] : p)
        if (isDelete) {
          if (!before) return
          logCrmActivity({
            employeeName: actor.name, action: `${prefix}.delete`, entityType, entityId: id,
            meta: { label: labelOf?.(before) || null, snapshot: snapshotOf(before), user }
          })
        } else if (isEdit) {
          const after = rowOf(payload)
          const changes = diffRows(before, after)
          if (!Object.keys(changes).length) return
          logCrmActivity({
            employeeName: actor.name, action: `${prefix}.update`, entityType, entityId: id,
            meta: { label: labelOf?.(after) || labelOf?.(before) || null, changes, user }
          })
        } else if (method === 'POST') {
          const created = rowOf(payload)
          if (!created || created[idColumn] == null) return
          logCrmActivity({
            employeeName: actor.name, action: `${prefix}.create`, entityType, entityId: created[idColumn],
            meta: { label: labelOf?.(created) || null, snapshot: snapshotOf(created), user }
          })
        }
      } catch (e) {
        console.warn('[crm-audit] could not record history entry:', e.message)
      }
    })
    next()
  }
}

/** Log an event that isn't a row edit (login, user created, security setting…). */
export function logEvent(req, { action, entityType = null, entityId = null, meta = {} }) {
  const actor = getActor(req)
  logCrmActivity({
    employeeName: actor.name, action, entityType, entityId,
    meta: { ...meta, user: { id: actor.id, role: actor.role, via: actor.via } }
  })
}

const HISTORY_COLS = 'employee_name, action, entity_type, entity_id, meta, created_at'

export function createCrmHistoryRouter({ requireAuth, requireAdmin, isAdmin } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())
  const adminAuth = requireAdmin || ((req, res, next) => next())

  const tableMissing = (error) => error && /relation .*crm_activity_log.* does not exist/i.test(error.message || '')

  // GET /?entity_type=expense&entity_id=12 — full timeline for one record, newest first.
  router.get('/', auth, async (req, res) => {
    try {
      const type = String(req.query.entity_type || '')
      const id = String(req.query.entity_id || '')
      if (!type || !id) return res.status(400).json({ error: 'entity_type and entity_id are required' })
      if (MONEY_ENTITY_TYPES.has(type) && !(isAdmin && isAdmin(req))) return res.status(403).json({ error: 'Admin access required' })
      const { data, error } = await supabase
        .from('crm_activity_log').select(HISTORY_COLS)
        .eq('entity_type', type).eq('entity_id', id)
        .order('created_at', { ascending: false }).limit(200)
      if (tableMissing(error)) return res.json({ rows: [], migrationPending: true })
      if (error) throw error
      res.json({ rows: data || [] })
    } catch (err) {
      console.error('[crm-audit] history', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /summary?entity_type=expense&ids=1,2,3 — "added by / last edited by" for a page of rows.
  router.get('/summary', auth, async (req, res) => {
    try {
      const type = String(req.query.entity_type || '')
      const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
      if (!type || !ids.length) return res.json({ summary: {} })
      if (MONEY_ENTITY_TYPES.has(type) && !(isAdmin && isAdmin(req))) return res.status(403).json({ error: 'Admin access required' })
      const { data, error } = await supabase
        .from('crm_activity_log').select('employee_name, action, entity_id, created_at')
        .eq('entity_type', type).in('entity_id', ids)
        .order('created_at', { ascending: false }).limit(2000)
      if (tableMissing(error)) return res.json({ summary: {}, migrationPending: true })
      if (error) throw error
      const summary = {}
      for (const r of data || []) {
        const s = (summary[r.entity_id] ||= { createdBy: null, createdAt: null, updatedBy: null, updatedAt: null, edits: 0 })
        if (r.action.endsWith('.create')) { s.createdBy = r.employee_name; s.createdAt = r.created_at }
        else {
          s.edits += 1
          if (!s.updatedAt) { s.updatedBy = r.employee_name; s.updatedAt = r.created_at } // rows are newest-first
        }
      }
      res.json({ summary })
    } catch (err) {
      console.error('[crm-audit] summary', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /activity?days=30&user=&type=&limit=200 — the team-wide feed (admin).
  router.get('/activity', adminAuth, async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30))
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200))
      const cutoff = new Date(Date.now() - days * 86400000).toISOString()
      let q = supabase.from('crm_activity_log').select(HISTORY_COLS).gte('created_at', cutoff)
        .order('created_at', { ascending: false }).limit(limit)
      if (req.query.user) q = q.eq('employee_name', String(req.query.user))
      if (req.query.type) q = q.eq('entity_type', String(req.query.type))
      const { data, error } = await q
      if (tableMissing(error)) return res.json({ rows: [], migrationPending: true })
      if (error) throw error
      res.json({ rows: data || [] })
    } catch (err) {
      console.error('[crm-audit] activity', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
