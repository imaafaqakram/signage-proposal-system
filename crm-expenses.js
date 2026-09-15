// Luminus CRM — Expense tracker + the combined Revenue/Expenses/Net-Profit
// business report.
//
// Mounted at /api/crm/expenses in server.js, gated by requireAdmin (same
// owner-only tier as Orders — see crm-orders.js's header comment).
//
//   app.use('/api/crm/expenses', createCrmExpensesRouter({ requireAuth: requireAdmin }))
import express from 'express'
import { _crmSupabase as supabase, logCrmActivity } from './crm-db.js'
import { fetchOrdersSummary } from './crm-orders.js'
import {
  htmlToPdfBuffer,
  buildExpensesReportHtml,
  buildFinanceReportHtml,
  buildTaxSummaryReportHtml,
  buildExpensesWorkbook,
  buildFinanceWorkbook,
  buildTaxSummaryWorkbook
} from './crm-reports.js'

const EXPENSE_COLS = 'id, category, description, amount, vendor, expense_date, notes, created_at, updated_at'
const CATEGORIES = ['ad_spend', 'shipping', 'tax', 'materials', 'software', 'other']

function parseFilters(query) {
  const filters = {}
  if (query.from) filters.from = query.from
  if (query.to) filters.to = query.to
  if (query.category) filters.category = query.category
  if (query.q) filters.q = String(query.q).trim()
  return filters
}

function applyFilters(q, filters) {
  if (filters.from) q = q.gte('expense_date', filters.from)
  if (filters.to) q = q.lte('expense_date', filters.to)
  if (filters.category) q = q.eq('category', filters.category)
  if (filters.q) {
    const term = filters.q.replace(/[%,]/g, '')
    q = q.or(`description.ilike.%${term}%,vendor.ilike.%${term}%`)
  }
  return q
}

async function expensesSummary(filters) {
  let q = supabase.from('expenses').select('category, amount')
  q = applyFilters(q, filters)
  const { data, error } = await q
  if (error) throw error
  const rows = data || []
  const byCategory = {}
  for (const c of CATEGORIES) byCategory[c] = 0
  let total = 0
  for (const r of rows) {
    const amt = Number(r.amount || 0)
    byCategory[r.category] = (byCategory[r.category] || 0) + amt
    total += amt
  }
  return { total, count: rows.length, byCategory }
}

// ── Tax & Compliance (Milestone 4) — pure reporting on orders/expenses, no new table.
async function quarterlySalesTax(year) {
  const { data, error } = await supabase
    .from('orders').select('amount_charged, sales_tax, order_date')
    .gte('order_date', `${year}-01-01`).lte('order_date', `${year}-12-31`)
  if (error) throw error
  const quarters = [1, 2, 3, 4].map((q) => ({ quarter: q, revenue: 0, tax: 0 }))
  for (const r of data || []) {
    // order_date is a plain DATE column (no timezone) — use UTC parsing so e.g.
    // "2026-03-31" doesn't shift into February in a negative-UTC-offset environment.
    const month = new Date(r.order_date).getUTCMonth()
    const q = quarters[Math.floor(month / 3)]
    q.revenue += Number(r.amount_charged || 0)
    q.tax += Number(r.sales_tax || 0)
  }
  return quarters
}

// Groups expenses.vendor by normalized text directly — deliberately NOT restricted to
// rows matching a real vendors.name entry, so an untracked/ad-hoc vendor still shows up
// and gets checked against the $600 threshold rather than silently dropping out.
async function vendorPaymentTotals(year) {
  const { data, error } = await supabase
    .from('expenses').select('vendor, amount')
    .not('vendor', 'is', null)
    .gte('expense_date', `${year}-01-01`).lte('expense_date', `${year}-12-31`)
  if (error) throw error
  const byKey = new Map()
  for (const row of data || []) {
    const raw = (row.vendor || '').trim()
    if (!raw) continue
    const key = raw.toLowerCase()
    const entry = byKey.get(key) || { name: raw, total: 0 }
    entry.total += Number(row.amount || 0)
    byKey.set(key, entry)
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total)
}

async function businessTaxPaid(year) {
  const { data, error } = await supabase
    .from('expenses').select('amount').eq('category', 'tax')
    .gte('expense_date', `${year}-01-01`).lte('expense_date', `${year}-12-31`)
  if (error) throw error
  return (data || []).reduce((a, r) => a + Number(r.amount || 0), 0)
}

async function taxSummaryForYear(year) {
  const [quarters, vendorTotals, taxPaid] = await Promise.all([
    quarterlySalesTax(year), vendorPaymentTotals(year), businessTaxPaid(year)
  ])
  return { year, quarters, vendorTotals, businessTaxPaid: taxPaid }
}

export function createCrmExpensesRouter({ requireAuth } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())
  const jsonBody = express.json({ limit: '64kb' })

  router.get('/', auth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50))
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)
      const filters = parseFilters(req.query)
      let q = supabase.from('expenses').select(EXPENSE_COLS, { count: 'exact' }).order('expense_date', { ascending: false }).range(offset, offset + limit - 1)
      q = applyFilters(q, filters)
      const { data, count, error } = await q
      if (error) throw error
      res.json({ rows: data || [], total: count || 0, limit, offset })
    } catch (err) {
      console.error('[crm-expenses] list', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/summary', auth, async (req, res) => {
    try {
      res.json(await expensesSummary(parseFilters(req.query)))
    } catch (err) {
      console.error('[crm-expenses] summary', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/', auth, jsonBody, async (req, res) => {
    try {
      const b = req.body || {}
      if (!CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'A valid category is required' })
      const amount = Number(b.amount)
      if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'A valid amount is required' })

      const insert = {
        category: b.category,
        description: b.description ? String(b.description).trim() : null,
        amount,
        vendor: b.vendor ? String(b.vendor).trim() : null,
        expense_date: b.expenseDate || new Date().toISOString().slice(0, 10),
        notes: b.notes || null
      }
      const { data, error } = await supabase.from('expenses').insert(insert).select(EXPENSE_COLS).single()
      if (error) throw error
      const employeeName = (req.headers['x-employee-name'] || '').toString().trim().slice(0, 80) || null
      logCrmActivity({ employeeName, action: 'expense.create', entityType: 'expense', entityId: data.id, meta: { amount } })
      res.json({ ok: true, expense: data })
    } catch (err) {
      console.error('[crm-expenses] create', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.patch('/:id', auth, jsonBody, async (req, res) => {
    try {
      const b = req.body || {}
      const patch = { updated_at: new Date().toISOString() }
      if (b.category !== undefined && CATEGORIES.includes(b.category)) patch.category = b.category
      if (b.description !== undefined) patch.description = b.description
      if (b.amount !== undefined) patch.amount = Number(b.amount)
      if (b.vendor !== undefined) patch.vendor = b.vendor
      if (b.expenseDate !== undefined) patch.expense_date = b.expenseDate
      if (b.notes !== undefined) patch.notes = b.notes
      const { data, error } = await supabase.from('expenses').update(patch).eq('id', req.params.id).select(EXPENSE_COLS).single()
      if (error) throw error
      res.json({ ok: true, expense: data })
    } catch (err) {
      console.error('[crm-expenses] update', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.delete('/:id', auth, async (req, res) => {
    try {
      const { error } = await supabase.from('expenses').delete().eq('id', req.params.id)
      if (error) throw error
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm-expenses] delete', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/export/pdf', auth, async (req, res) => {
    try {
      const filters = parseFilters(req.query)
      let q = supabase.from('expenses').select(EXPENSE_COLS).order('expense_date', { ascending: false }).limit(5000)
      q = applyFilters(q, filters)
      const [{ data: rows, error }, summary] = await Promise.all([q, expensesSummary(filters)])
      if (error) throw error
      const theme = req.query.theme === 'dark' ? 'dark' : 'light'
      const pdf = await htmlToPdfBuffer(buildExpensesReportHtml(rows || [], summary, filters, theme))
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Expenses-${new Date().toISOString().slice(0, 10)}.pdf"`)
      res.send(pdf)
    } catch (err) {
      console.error('[crm-expenses] export pdf', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/export/excel', auth, async (req, res) => {
    try {
      const filters = parseFilters(req.query)
      let q = supabase.from('expenses').select(EXPENSE_COLS).order('expense_date', { ascending: false }).limit(5000)
      q = applyFilters(q, filters)
      const [{ data: rows, error }, summary] = await Promise.all([q, expensesSummary(filters)])
      if (error) throw error
      const buf = await buildExpensesWorkbook(rows || [], summary)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Expenses-${new Date().toISOString().slice(0, 10)}.xlsx"`)
      res.send(buf)
    } catch (err) {
      console.error('[crm-expenses] export excel', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ── Combined business report: Revenue (Orders) + Expenses -> Net Profit ──
  router.get('/report/summary', auth, async (req, res) => {
    try {
      const filters = parseFilters(req.query)
      const [orders, expenses] = await Promise.all([fetchOrdersSummary(filters), expensesSummary(filters)])
      res.json({ orders, expenses, netProfit: orders.revenue - expenses.total })
    } catch (err) {
      console.error('[crm-expenses] report summary', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/report/pdf', auth, async (req, res) => {
    try {
      const filters = parseFilters(req.query)
      const [orders, expenses] = await Promise.all([fetchOrdersSummary(filters), expensesSummary(filters)])
      const theme = req.query.theme === 'dark' ? 'dark' : 'light'
      const pdf = await htmlToPdfBuffer(buildFinanceReportHtml(orders, expenses, filters, theme))
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Business-Report-${new Date().toISOString().slice(0, 10)}.pdf"`)
      res.send(pdf)
    } catch (err) {
      console.error('[crm-expenses] report pdf', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/report/excel', auth, async (req, res) => {
    try {
      const filters = parseFilters(req.query)
      let oq = supabase.from('orders').select('order_date, client_name, description, amount_charged, sales_tax, total_amount').order('order_date', { ascending: false }).limit(5000)
      if (filters.from) oq = oq.gte('order_date', filters.from)
      if (filters.to) oq = oq.lte('order_date', filters.to)
      let eq = supabase.from('expenses').select(EXPENSE_COLS).order('expense_date', { ascending: false }).limit(5000)
      eq = applyFilters(eq, filters)
      const [{ data: orderRows, error: oErr }, { data: expenseRows, error: eErr }, orders, expenses] = await Promise.all([
        oq, eq, fetchOrdersSummary(filters), expensesSummary(filters)
      ])
      if (oErr) throw oErr
      if (eErr) throw eErr
      const buf = await buildFinanceWorkbook(orderRows || [], orders, expenseRows || [], expenses)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Business-Report-${new Date().toISOString().slice(0, 10)}.xlsx"`)
      res.send(buf)
    } catch (err) {
      console.error('[crm-expenses] report excel', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ── Tax & Compliance summary (Milestone 4) ──
  router.get('/report/tax-summary', auth, async (req, res) => {
    try {
      const year = parseInt(req.query.year, 10) || new Date().getFullYear()
      res.json(await taxSummaryForYear(year))
    } catch (err) {
      console.error('[crm-expenses] tax summary', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/report/tax-summary/pdf', auth, async (req, res) => {
    try {
      const year = parseInt(req.query.year, 10) || new Date().getFullYear()
      const summary = await taxSummaryForYear(year)
      const theme = req.query.theme === 'dark' ? 'dark' : 'light'
      const pdf = await htmlToPdfBuffer(buildTaxSummaryReportHtml(summary, theme))
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Tax-Summary-${year}.pdf"`)
      res.send(pdf)
    } catch (err) {
      console.error('[crm-expenses] tax summary pdf', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/report/tax-summary/excel', auth, async (req, res) => {
    try {
      const year = parseInt(req.query.year, 10) || new Date().getFullYear()
      const summary = await taxSummaryForYear(year)
      const buf = await buildTaxSummaryWorkbook(summary)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="Signage-Crafting-Tax-Summary-${year}.xlsx"`)
      res.send(buf)
    } catch (err) {
      console.error('[crm-expenses] tax summary excel', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
