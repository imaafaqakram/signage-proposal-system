// Luminus CRM — Orders ledger.
//
// Mounted at /api/crm/orders in server.js, gated by requireAdmin — NOT the
// shared employee requireBypassAuth every other CRM router uses. This is real
// revenue/tax data, so it sits at the same owner-only tier as Admin ->
// Follow-Up Automation and /api/admin/settings.
//
//   app.use('/api/crm/orders', createCrmOrdersRouter({ requireAuth: requireAdmin }))
import express from 'express'
import { _crmSupabase as supabase } from './crm-db.js'
import { auditWrite } from './crm-audit.js'
import { moneyForWrite, withFx, hasFxColumn, MoneyError } from './crm-fx.js'
import { htmlToPdfBuffer, buildOrdersReportHtml, buildOrdersWorkbook } from './crm-reports.js'

const ORDER_COLS = 'id, lead_id, client_name, client_email, description, amount_charged, sales_tax, total_amount, currency, status, payment_method, order_date, notes, created_at, updated_at'
const STATUSES = ['paid', 'pending', 'partial', 'refunded']
// `fx` (original currency + locked rate) only exists after migration 016 — added to selects only then.
const orderCols = () => withFx('orders', ORDER_COLS)
const orderLabel = (r) => r?.client_name || null
const audit = () => auditWrite({ table: 'orders', prefix: 'order', entityType: 'order', resultKey: 'order', labelOf: orderLabel })

function parseFilters(query) {
  const filters = {}
  if (query.from) filters.from = query.from
  if (query.to) filters.to = query.to
  if (query.status) filters.status = query.status
  if (query.q) filters.q = String(query.q).trim()
  return filters
}

function applyFilters(q, filters) {
  if (filters.from) q = q.gte('order_date', filters.from)
  if (filters.to) q = q.lte('order_date', filters.to)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.q) {
    const term = filters.q.replace(/[%,]/g, '')
    q = q.or(`client_name.ilike.%${term}%,client_email.ilike.%${term}%,description.ilike.%${term}%`)
  }
  return q
}

async function ordersSummary(filters) {
  let q = supabase.from('orders').select('amount_charged, sales_tax')
  q = applyFilters(q, filters)
  const { data, error } = await q
  if (error) throw error
  const rows = data || []
  const revenue = rows.reduce((a, r) => a + Number(r.amount_charged || 0), 0)
  const tax = rows.reduce((a, r) => a + Number(r.sales_tax || 0), 0)
  return { revenue, tax, total: revenue + tax, count: rows.length }
}

export function createCrmOrdersRouter({ requireAuth } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())
  const jsonBody = express.json({ limit: '64kb' })

  router.get('/', auth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50))
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)
      const filters = parseFilters(req.query)
      let q = supabase.from('orders').select(await orderCols(), { count: 'exact' }).order('order_date', { ascending: false }).range(offset, offset + limit - 1)
      q = applyFilters(q, filters)
      const { data, count, error } = await q
      if (error) throw error
      res.json({ rows: data || [], total: count || 0, limit, offset })
    } catch (err) {
      console.error('[crm-orders] list', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/summary', auth, async (req, res) => {
    try {
      res.json(await ordersSummary(parseFilters(req.query)))
    } catch (err) {
      console.error('[crm-orders] summary', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /suggest-amount?leadId=N — a best-effort price hint from that lead's
  // latest proposal. Never trusted automatically — the create form always
  // requires the user to confirm/type the real charged amount, since this
  // field (pricing[0].cost) is only the first tier, not necessarily what was
  // actually sold, and is stored as a free-text string in the proposal JSON.
  router.get('/suggest-amount', auth, async (req, res) => {
    try {
      const leadId = Number(req.query.leadId)
      if (!Number.isFinite(leadId)) return res.json({ suggestedAmount: null })
      const { data: versions, error } = await supabase
        .from('lead_versions').select('data').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1)
      if (error) throw error
      const page0 = versions?.[0]?.data?.pages?.[0]
      const rawCost = page0?.pricing?.[0]?.cost
      const suggestedAmount = rawCost != null ? (Number(String(rawCost).replace(/[^0-9.]/g, '')) || null) : null
      res.json({ suggestedAmount, signType: page0?.signType || null })
    } catch (err) {
      console.error('[crm-orders] suggest-amount', err)
      res.json({ suggestedAmount: null })
    }
  })

  router.post('/', auth, jsonBody, audit(), async (req, res) => {
    try {
      const b = req.body || {}
      if (!b.clientName || !String(b.clientName).trim()) return res.status(400).json({ error: 'Client name is required' })
      // amount_charged / sales_tax are always stored in USD (what every total sums). Typed in
      // another currency, both are converted with ONE shared rate and the originals kept in `fx`.
      const money = await moneyForWrite({ table: 'orders', body: b, fields: { amountCharged: 'amount_charged', salesTax: 'sales_tax' } })
      if (!money || money.columns.amount_charged === undefined) return res.status(400).json({ error: 'A valid amount charged is required' })

      const insert = {
        lead_id: b.leadId ? Number(b.leadId) : null,
        client_name: String(b.clientName).trim(),
        client_email: b.clientEmail ? String(b.clientEmail).trim() : null,
        description: b.description ? String(b.description).trim() : null,
        amount_charged: money.columns.amount_charged,
        sales_tax: money.columns.sales_tax ?? 0,
        currency: money.currency,
        status: STATUSES.includes(b.status) ? b.status : 'paid',
        payment_method: b.paymentMethod || null,
        order_date: b.orderDate || new Date().toISOString().slice(0, 10),
        notes: b.notes || null
      }
      if (money.fx) insert.fx = money.fx
      const { data, error } = await supabase.from('orders').insert(insert).select(await orderCols()).single()
      if (error) throw error
      res.json({ ok: true, order: data })
    } catch (err) {
      if (err instanceof MoneyError) return res.status(err.status).json({ error: err.message })
      console.error('[crm-orders] create', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.patch('/:id', auth, jsonBody, audit(), async (req, res) => {
    try {
      const b = req.body || {}
      const patch = { updated_at: new Date().toISOString() }
      if (b.clientName !== undefined) patch.client_name = String(b.clientName).trim()
      if (b.clientEmail !== undefined) patch.client_email = b.clientEmail
      if (b.description !== undefined) patch.description = b.description
      if (b.status !== undefined && STATUSES.includes(b.status)) patch.status = b.status
      if (b.paymentMethod !== undefined) patch.payment_method = b.paymentMethod
      if (b.orderDate !== undefined) patch.order_date = b.orderDate
      if (b.notes !== undefined) patch.notes = b.notes
      const money = await moneyForWrite({ table: 'orders', body: b, fields: { amountCharged: 'amount_charged', salesTax: 'sales_tax' }, existing: req.auditBefore })
      if (money) {
        Object.assign(patch, money.columns)
        patch.currency = money.currency
        // Editing a record back to USD must clear its old foreign-currency info.
        if (await hasFxColumn('orders')) patch.fx = money.fx
      }
      const { data, error } = await supabase.from('orders').update(patch).eq('id', req.params.id).select(await orderCols()).single()
      if (error) throw error
      res.json({ ok: true, order: data })
    } catch (err) {
      if (err instanceof MoneyError) return res.status(err.status).json({ error: err.message })
      console.error('[crm-orders] update', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.delete('/:id', auth, audit(), async (req, res) => {
    try {
      const { error } = await supabase.from('orders').delete().eq('id', req.params.id)
      if (error) throw error
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm-orders] delete', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/export/pdf', auth, async (req, res) => {
    try {
      const filters = parseFilters(req.query)
      let q = supabase.from('orders').select(await orderCols()).order('order_date', { ascending: false }).limit(5000)
      q = applyFilters(q, filters)
      const [{ data: rows, error }, summary] = await Promise.all([q, ordersSummary(filters)])
      if (error) throw error
      const theme = req.query.theme === 'dark' ? 'dark' : 'light'
      const pdf = await htmlToPdfBuffer(buildOrdersReportHtml(rows || [], summary, filters, theme))
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Orders-${new Date().toISOString().slice(0, 10)}.pdf"`)
      res.send(pdf)
    } catch (err) {
      console.error('[crm-orders] export pdf', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/export/excel', auth, async (req, res) => {
    try {
      const filters = parseFilters(req.query)
      let q = supabase.from('orders').select(await orderCols()).order('order_date', { ascending: false }).limit(5000)
      q = applyFilters(q, filters)
      const [{ data: rows, error }, summary] = await Promise.all([q, ordersSummary(filters)])
      if (error) throw error
      const buf = await buildOrdersWorkbook(rows || [], summary)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Orders-${new Date().toISOString().slice(0, 10)}.xlsx"`)
      res.send(buf)
    } catch (err) {
      console.error('[crm-orders] export excel', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}

export { ordersSummary as fetchOrdersSummary }
