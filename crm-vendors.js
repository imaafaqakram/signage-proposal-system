// Luminus CRM — Vendors & Purchase Orders.
//
// Mounted at /api/crm/vendors in server.js, gated by requireAdmin.
//
//   app.use('/api/crm/vendors', createCrmVendorsRouter({ requireAuth: requireAdmin }))
//
// Deliberate simplification: expenses.vendor stays exactly as it is (a free-text field) —
// no backfill/migration linking historical expense rows to a real vendor_id. Instead,
// a vendor's "total paid" is computed by matching expenses.vendor text against
// vendors.name at query time — matchedExpenseTotals() below is that routine. The
// Tax & Compliance report (crm-expenses.js, Milestone 4) does its own similar grouping
// rather than importing this one, deliberately NOT restricted to rows matching a real
// vendors.name — an untracked/ad-hoc vendor still needs to be checked against the $600
// threshold, so that report can't just reuse this vendors-table-anchored version.
import express from 'express'
import { _crmSupabase as supabase } from './crm-db.js'
import { auditWrite } from './crm-audit.js'
import { moneyForWrite, withFx, hasFxColumn, MoneyError } from './crm-fx.js'
import { htmlToPdfBuffer, buildVendorsReportHtml, buildVendorsWorkbook } from './crm-reports.js'

const VENDOR_COLS = 'id, name, contact_email, contact_phone, notes, created_at, updated_at'
const PO_COLS = 'id, vendor_id, description, amount, status, order_date, expected_date, received_date, notes, created_at, updated_at'
const PO_STATUSES = ['ordered', 'received', 'partial', 'cancelled']
// `fx` (original currency + locked rate) only exists after migration 016 — added to selects only then.
const poCols = () => withFx('purchase_orders', PO_COLS)
const auditVendor = () => auditWrite({ table: 'vendors', prefix: 'vendor', entityType: 'vendor', resultKey: 'vendor', labelOf: (r) => r?.name || null })
const auditPo = () => auditWrite({ table: 'purchase_orders', prefix: 'po', entityType: 'purchase_order', resultKey: 'purchaseOrder', labelOf: (r) => r?.description || null })

// Best-effort, case-insensitive match of expenses.vendor text against a vendor name.
// Returns { totalsByVendorName: Map<lowercased name, number>, rows: [...] } for a
// given date range (or all time when from/to are omitted).
export async function matchedExpenseTotals({ from, to } = {}) {
  let q = supabase.from('expenses').select('vendor, amount, expense_date').not('vendor', 'is', null)
  if (from) q = q.gte('expense_date', from)
  if (to) q = q.lte('expense_date', to)
  const { data, error } = await q
  if (error) throw error
  const totals = new Map()
  for (const row of data || []) {
    const key = (row.vendor || '').trim().toLowerCase()
    if (!key) continue
    totals.set(key, (totals.get(key) || 0) + Number(row.amount || 0))
  }
  return { totalsByVendorName: totals, rows: data || [] }
}

async function vendorsSummary() {
  const [{ data: vendors, error: vErr }, { totalsByVendorName }, { data: pos, error: pErr }] = await Promise.all([
    supabase.from('vendors').select(VENDOR_COLS).order('name', { ascending: true }),
    matchedExpenseTotals(),
    supabase.from('purchase_orders').select('vendor_id, status')
  ])
  if (vErr) throw vErr
  if (pErr) throw pErr
  const openPOsByVendor = new Map()
  for (const po of pos || []) {
    if (po.status === 'ordered' || po.status === 'partial') {
      openPOsByVendor.set(po.vendor_id, (openPOsByVendor.get(po.vendor_id) || 0) + 1)
    }
  }
  const rows = (vendors || []).map((v) => ({
    ...v,
    totalPaid: totalsByVendorName.get((v.name || '').trim().toLowerCase()) || 0,
    openPOs: openPOsByVendor.get(v.id) || 0
  }))
  return rows
}

export function createCrmVendorsRouter({ requireAuth } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())
  const jsonBody = express.json({ limit: '64kb' })

  router.get('/', auth, async (_req, res) => {
    try {
      res.json({ rows: await vendorsSummary() })
    } catch (err) {
      console.error('[crm-vendors] list', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/', auth, jsonBody, auditVendor(), async (req, res) => {
    try {
      const b = req.body || {}
      if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Vendor name is required' })
      const insert = {
        name: String(b.name).trim(),
        contact_email: b.contactEmail || null,
        contact_phone: b.contactPhone || null,
        notes: b.notes || null
      }
      const { data, error } = await supabase.from('vendors').insert(insert).select(VENDOR_COLS).single()
      if (error) throw error
      res.json({ ok: true, vendor: data })
    } catch (err) {
      console.error('[crm-vendors] create', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ── purchase orders (sub-resource, registered before the generic /:id routes
  // below so Express matches these literal paths first — otherwise GET /:id would
  // shadow GET /purchase-orders, treating "purchase-orders" as a vendor id). ──
  router.get('/purchase-orders', auth, async (req, res) => {
    try {
      let q = supabase.from('purchase_orders').select(`${await poCols()}, vendors(name)`).order('order_date', { ascending: false }).limit(500)
      if (req.query.status && PO_STATUSES.includes(req.query.status)) q = q.eq('status', req.query.status)
      const { data, error } = await q
      if (error) throw error
      res.json({ rows: (data || []).map((r) => ({ ...r, vendorName: r.vendors?.name || null, vendors: undefined })) })
    } catch (err) {
      console.error('[crm-vendors] po list', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/purchase-orders', auth, jsonBody, auditPo(), async (req, res) => {
    try {
      const b = req.body || {}
      if (!b.vendorId) return res.status(400).json({ error: 'A vendor is required' })
      // `amount` is always USD (what totals sum); another currency is converted at entry
      // and the original + locked rate kept in `fx`.
      const money = await moneyForWrite({ table: 'purchase_orders', body: b, fields: { amount: 'amount' } })
      if (!money || money.columns.amount === undefined) return res.status(400).json({ error: 'A valid amount is required' })
      const insert = {
        vendor_id: b.vendorId,
        description: b.description || null,
        amount: money.columns.amount,
        status: PO_STATUSES.includes(b.status) ? b.status : 'ordered',
        order_date: b.orderDate || new Date().toISOString().slice(0, 10),
        expected_date: b.expectedDate || null,
        received_date: b.receivedDate || null,
        notes: b.notes || null
      }
      if (money.fx) insert.fx = money.fx
      const { data, error } = await supabase.from('purchase_orders').insert(insert).select(await poCols()).single()
      if (error) throw error
      res.json({ ok: true, purchaseOrder: data })
    } catch (err) {
      if (err instanceof MoneyError) return res.status(err.status).json({ error: err.message })
      console.error('[crm-vendors] po create', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.patch('/purchase-orders/:id', auth, jsonBody, auditPo(), async (req, res) => {
    try {
      const b = req.body || {}
      const patch = { updated_at: new Date().toISOString() }
      if (b.description !== undefined) patch.description = b.description
      if (b.status !== undefined && PO_STATUSES.includes(b.status)) patch.status = b.status
      if (b.expectedDate !== undefined) patch.expected_date = b.expectedDate
      if (b.receivedDate !== undefined) patch.received_date = b.receivedDate
      if (b.notes !== undefined) patch.notes = b.notes
      const money = await moneyForWrite({ table: 'purchase_orders', body: b, fields: { amount: 'amount' }, existing: req.auditBefore })
      if (money) {
        Object.assign(patch, money.columns)
        // Editing a record back to USD must clear its old foreign-currency info.
        if (await hasFxColumn('purchase_orders')) patch.fx = money.fx
      }
      const { data, error } = await supabase.from('purchase_orders').update(patch).eq('id', req.params.id).select(await poCols()).single()
      if (error) throw error
      res.json({ ok: true, purchaseOrder: data })
    } catch (err) {
      if (err instanceof MoneyError) return res.status(err.status).json({ error: err.message })
      console.error('[crm-vendors] po update', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.delete('/purchase-orders/:id', auth, auditPo(), async (req, res) => {
    try {
      const { error } = await supabase.from('purchase_orders').delete().eq('id', req.params.id)
      if (error) throw error
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm-vendors] po delete', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/export/pdf', auth, async (req, res) => {
    try {
      const rows = await vendorsSummary()
      const theme = req.query.theme === 'dark' ? 'dark' : 'light'
      const pdf = await htmlToPdfBuffer(buildVendorsReportHtml(rows, theme))
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Vendors-${new Date().toISOString().slice(0, 10)}.pdf"`)
      res.send(pdf)
    } catch (err) {
      console.error('[crm-vendors] export pdf', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/export/excel', auth, async (_req, res) => {
    try {
      const rows = await vendorsSummary()
      const buf = await buildVendorsWorkbook(rows)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Vendors-${new Date().toISOString().slice(0, 10)}.xlsx"`)
      res.send(buf)
    } catch (err) {
      console.error('[crm-vendors] export excel', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ── generic /:id vendor routes — registered last so they never shadow the
  // literal /purchase-orders* and /export/* paths above. ──
  router.get('/:id', auth, async (req, res) => {
    try {
      const { data: vendor, error: vErr } = await supabase.from('vendors').select(VENDOR_COLS).eq('id', req.params.id).single()
      if (vErr) throw vErr
      const { data: pos, error: pErr } = await supabase
        .from('purchase_orders').select(await poCols()).eq('vendor_id', req.params.id).order('order_date', { ascending: false })
      if (pErr) throw pErr
      const { data: expenses, error: eErr } = await supabase
        .from('expenses').select('id, description, amount, expense_date').ilike('vendor', vendor.name).order('expense_date', { ascending: false })
      if (eErr) throw eErr
      res.json({ vendor, purchaseOrders: pos || [], expenses: expenses || [] })
    } catch (err) {
      console.error('[crm-vendors] detail', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.patch('/:id', auth, jsonBody, auditVendor(), async (req, res) => {
    try {
      const b = req.body || {}
      const patch = { updated_at: new Date().toISOString() }
      if (b.name !== undefined) patch.name = String(b.name).trim()
      if (b.contactEmail !== undefined) patch.contact_email = b.contactEmail
      if (b.contactPhone !== undefined) patch.contact_phone = b.contactPhone
      if (b.notes !== undefined) patch.notes = b.notes
      const { data, error } = await supabase.from('vendors').update(patch).eq('id', req.params.id).select(VENDOR_COLS).single()
      if (error) throw error
      res.json({ ok: true, vendor: data })
    } catch (err) {
      console.error('[crm-vendors] update', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.delete('/:id', auth, auditVendor(), async (req, res) => {
    try {
      const { error } = await supabase.from('vendors').delete().eq('id', req.params.id)
      if (error) throw error
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm-vendors] delete', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
