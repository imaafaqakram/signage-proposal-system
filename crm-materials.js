// Luminus CRM — Materials / Inventory tracking.
//
// Mounted at /api/crm/materials in server.js, gated by requireAdmin — same owner-only
// tier as Orders/Finance, since inventory value/cost is business-sensitive the same way.
//
//   app.use('/api/crm/materials', createCrmMaterialsRouter({ requireAuth: requireAdmin }))
//
// Stock only ever changes through POST /:id/adjust, which inserts a material_movements
// row and updates materials.quantity_on_hand in the same request — quantity_on_hand is a
// maintained column (Express-side), not a DB trigger, matching this codebase's existing
// convention of keeping logic in the app layer, not Postgres (no triggers/RLS anywhere
// else here either). There is deliberately no way to PATCH quantity_on_hand directly.
import express from 'express'
import { _crmSupabase as supabase, logCrmActivity } from './crm-db.js'
import { htmlToPdfBuffer, buildMaterialsReportHtml, buildMaterialsWorkbook } from './crm-reports.js'

const MATERIAL_COLS = 'id, name, category, unit, unit_cost, quantity_on_hand, reorder_threshold, notes, created_at, updated_at'
const CATEGORIES = ['acrylic', 'led', 'vinyl', 'hardware', 'metal', 'other']
const REASONS = ['purchase', 'used_on_order', 'adjustment', 'waste']

async function fetchMaterials({ lowStock }) {
  let q = supabase.from('materials').select(MATERIAL_COLS).order('name', { ascending: true })
  const { data, error } = await q
  if (error) throw error
  let rows = data || []
  if (lowStock) rows = rows.filter((r) => Number(r.quantity_on_hand) <= Number(r.reorder_threshold))
  return rows
}

async function materialsSummary() {
  const { data, error } = await supabase.from('materials').select('quantity_on_hand, unit_cost, reorder_threshold')
  if (error) throw error
  const rows = data || []
  const lowStockCount = rows.filter((r) => Number(r.quantity_on_hand) <= Number(r.reorder_threshold)).length
  const totalValue = rows.reduce((a, r) => a + Number(r.quantity_on_hand || 0) * Number(r.unit_cost || 0), 0)
  return { itemCount: rows.length, lowStockCount, totalValue }
}

export function createCrmMaterialsRouter({ requireAuth } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())
  const jsonBody = express.json({ limit: '64kb' })
  const employeeName = (req) => (req.headers['x-employee-name'] || '').toString().trim().slice(0, 80) || null

  router.get('/', auth, async (req, res) => {
    try {
      const rows = await fetchMaterials({ lowStock: req.query.lowStock === 'true' })
      res.json({ rows })
    } catch (err) {
      console.error('[crm-materials] list', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/summary', auth, async (_req, res) => {
    try {
      res.json(await materialsSummary())
    } catch (err) {
      console.error('[crm-materials] summary', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/', auth, jsonBody, async (req, res) => {
    try {
      const b = req.body || {}
      if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Name is required' })
      if (!CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'Invalid category' })
      const insert = {
        name: String(b.name).trim(),
        category: b.category,
        unit: b.unit ? String(b.unit).trim() : 'each',
        unit_cost: Number(b.unitCost) || 0,
        quantity_on_hand: Number(b.quantityOnHand) || 0,
        reorder_threshold: Number(b.reorderThreshold) || 0,
        notes: b.notes || null
      }
      const { data, error } = await supabase.from('materials').insert(insert).select(MATERIAL_COLS).single()
      if (error) throw error
      res.json({ ok: true, material: data })
    } catch (err) {
      console.error('[crm-materials] create', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.patch('/:id', auth, jsonBody, async (req, res) => {
    try {
      const b = req.body || {}
      const patch = { updated_at: new Date().toISOString() }
      if (b.name !== undefined) patch.name = String(b.name).trim()
      if (b.category !== undefined && CATEGORIES.includes(b.category)) patch.category = b.category
      if (b.unit !== undefined) patch.unit = b.unit
      if (b.unitCost !== undefined) patch.unit_cost = Number(b.unitCost)
      if (b.reorderThreshold !== undefined) patch.reorder_threshold = Number(b.reorderThreshold)
      if (b.notes !== undefined) patch.notes = b.notes
      const { data, error } = await supabase.from('materials').update(patch).eq('id', req.params.id).select(MATERIAL_COLS).single()
      if (error) throw error
      res.json({ ok: true, material: data })
    } catch (err) {
      console.error('[crm-materials] update', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.delete('/:id', auth, async (req, res) => {
    try {
      const { error } = await supabase.from('materials').delete().eq('id', req.params.id)
      if (error) throw error
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm-materials] delete', err)
      res.status(500).json({ error: err.message })
    }
  })

  // POST /:id/adjust — the ONLY way quantity_on_hand changes. Inserts the movement row
  // first (the audit trail is the source of truth), then updates the maintained total.
  router.post('/:id/adjust', auth, jsonBody, async (req, res) => {
    try {
      const b = req.body || {}
      const delta = Number(b.delta)
      if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'A non-zero delta is required' })
      if (!REASONS.includes(b.reason)) return res.status(400).json({ error: 'Invalid reason' })

      const { data: material, error: mErr } = await supabase
        .from('materials').select('id, quantity_on_hand').eq('id', req.params.id).single()
      if (mErr) throw mErr
      const newQty = Number(material.quantity_on_hand || 0) + delta
      if (newQty < 0) return res.status(400).json({ error: 'This would take stock below zero' })

      const name = employeeName(req)
      const { error: moveErr } = await supabase.from('material_movements').insert({
        material_id: req.params.id,
        delta,
        reason: b.reason,
        related_order_id: b.relatedOrderId || null,
        note: b.note || null,
        employee_name: name
      })
      if (moveErr) throw moveErr

      const { data: updated, error: upErr } = await supabase
        .from('materials')
        .update({ quantity_on_hand: newQty, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select(MATERIAL_COLS)
        .single()
      if (upErr) throw upErr

      logCrmActivity({ employeeName: name, action: 'material.adjust', entityType: 'material', entityId: req.params.id, meta: { delta, reason: b.reason } })
      res.json({ ok: true, material: updated })
    } catch (err) {
      console.error('[crm-materials] adjust', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/:id/movements', auth, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('material_movements')
        .select('id, delta, reason, related_order_id, note, employee_name, created_at')
        .eq('material_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      res.json({ rows: data || [] })
    } catch (err) {
      console.error('[crm-materials] movements', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/export/pdf', auth, async (req, res) => {
    try {
      const rows = await fetchMaterials({ lowStock: req.query.lowStock === 'true' })
      const summary = await materialsSummary()
      const theme = req.query.theme === 'dark' ? 'dark' : 'light'
      const pdf = await htmlToPdfBuffer(buildMaterialsReportHtml(rows, summary, theme))
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Materials-${new Date().toISOString().slice(0, 10)}.pdf"`)
      res.send(pdf)
    } catch (err) {
      console.error('[crm-materials] export pdf', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/export/excel', auth, async (req, res) => {
    try {
      const rows = await fetchMaterials({ lowStock: req.query.lowStock === 'true' })
      const summary = await materialsSummary()
      const buf = await buildMaterialsWorkbook(rows, summary)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Materials-${new Date().toISOString().slice(0, 10)}.xlsx"`)
      res.send(buf)
    } catch (err) {
      console.error('[crm-materials] export excel', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
