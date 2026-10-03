// Luminus CRM — multi-currency support (live USD conversion).
//
// The CRM's books are in USD: every existing `amount` / `amount_charged` /
// `unit_cost` column, and every total, report, and tax figure built from them, stays
// USD and is never rewritten. When someone enters a cost in another currency (e.g.
// 200,000 PKR), the server converts it to USD at entry time, stores the USD figure in
// the normal column, and keeps the original amount + the rate used in a small `fx`
// JSON column next to it (migration 016). The rate is LOCKED IN when the entry is
// saved — reopening the record next month shows the same USD figure, the books don't
// shift when the exchange rate moves.
//
// Rate source: Google has no public exchange-rate API (scraping its page would be
// fragile and against its terms), so this uses free mid-market rate feeds — the same
// kind of underlying market data Google's converter shows, typically within a fraction
// of a percent of it. Primary: open.er-api.com (ExchangeRate-API's open endpoint, ~165
// currencies, refreshed daily). Fallback: the jsDelivr-hosted currency-api. Last resort:
// the most recent rates saved to disk, flagged as stale. A user can always override the
// rate on an individual entry (e.g. to use their bank's actual rate).
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { _crmSupabase as supabase } from './crm-db.js'

const CACHE_FILE = path.join(process.cwd(), 'fx-cache.json')
const TTL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000

let cache = null // { rates, asOf, source, fetchedAt }
let inflight = null

const ISO_CODES = (() => {
  try { return new Set(Intl.supportedValuesOf('currency')) } catch { return null }
})()
const currencyNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'currency' }) } catch { return null }
})()

function loadDiskCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    if (j && j.rates && j.rates.USD) return j
  } catch { /* none yet */ }
  return null
}
function saveDiskCache(c) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(c)) } catch { /* non-fatal */ }
}

async function fetchPrimary() {
  const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`open.er-api.com HTTP ${res.status}`)
  const j = await res.json()
  if (j.result !== 'success' || !j.rates || !j.rates.PKR) throw new Error('open.er-api.com returned no rates')
  return {
    rates: j.rates,
    asOf: j.time_last_update_utc ? new Date(j.time_last_update_utc).toISOString() : new Date().toISOString(),
    source: 'open.er-api.com'
  }
}

async function fetchFallback() {
  const res = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`jsdelivr currency-api HTTP ${res.status}`)
  const j = await res.json()
  if (!j.usd) throw new Error('jsdelivr currency-api returned no rates')
  const rates = {}
  for (const [k, v] of Object.entries(j.usd)) {
    const code = k.toUpperCase()
    // The feed also lists crypto tokens — keep only real ISO currencies.
    if (ISO_CODES && !ISO_CODES.has(code)) continue
    if (Number(v) > 0) rates[code] = Number(v)
  }
  if (!rates.PKR) throw new Error('jsdelivr currency-api returned no usable rates')
  return { rates, asOf: j.date ? new Date(j.date).toISOString() : new Date().toISOString(), source: 'currency-api (jsDelivr)' }
}

async function refresh() {
  let result
  try {
    result = await fetchPrimary()
  } catch (e1) {
    console.warn('[crm-fx] primary rate source failed:', e1.message)
    try {
      result = await fetchFallback()
    } catch (e2) {
      console.warn('[crm-fx] fallback rate source failed:', e2.message)
      return null
    }
  }
  cache = { ...result, fetchedAt: Date.now() }
  saveDiskCache(cache)
  return cache
}

/** { base:'USD', rates:{CODE:unitsPerUSD}, asOf, source, stale } — never throws if any rates exist. */
export async function getRates() {
  if (!cache) cache = loadDiskCache()
  const fresh = cache && Date.now() - (cache.fetchedAt || 0) < TTL_MS
  if (!fresh) {
    if (!inflight) inflight = refresh().finally(() => { inflight = null })
    await inflight
  }
  if (!cache) throw new MoneyError('Live exchange rates are unavailable right now. Enter USD, or try again in a minute.', 503)
  const stale = Date.now() - (cache.fetchedAt || 0) >= TTL_MS
  return { base: 'USD', rates: cache.rates, asOf: cache.asOf, source: cache.source, stale }
}

export class MoneyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6

/**
 * Convert one or more amounts entered in `currency` to USD with a single shared rate.
 *   amounts: { amount: 200000 }  or  { amount_charged: 1000, sales_tax: 50 }
 * Returns { usd: { amount: 718.31 }, fx } where fx is null for USD, otherwise
 *   { currency, rate, original: { amount: 200000 }, asOf, source, manual }
 * `rate` is units of `currency` per 1 USD (what every rate feed publishes).
 * A caller-supplied fxRate wins (manual override / the rate the user previewed).
 */
export async function convertToUsd({ amounts, currency, fxRate, fxManual }) {
  const code = String(currency || 'USD').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) throw new MoneyError('Currency must be a 3-letter code such as USD or PKR.')

  const usd = {}
  const original = {}
  for (const [key, raw] of Object.entries(amounts || {})) {
    if (raw === null || raw === undefined || raw === '') continue
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) throw new MoneyError('Enter a valid amount.')
    original[key] = n
  }

  if (code === 'USD') {
    for (const [k, n] of Object.entries(original)) usd[k] = round2(n)
    return { usd, currency: 'USD', fx: null }
  }

  const live = await getRates()
  let rate = Number(fxRate)
  if (!(rate > 0)) {
    rate = live.rates[code]
    if (!(rate > 0)) throw new MoneyError(`No exchange rate available for ${code}.`)
  }
  for (const [k, n] of Object.entries(original)) usd[k] = round2(n / rate)
  return {
    usd,
    currency: code,
    fx: {
      currency: code,
      rate: round6(rate),
      original,
      asOf: live.asOf,
      source: live.source,
      manual: !!fxManual
    }
  }
}

// ── does this table have the `fx` column yet (migration 016)? ──
// true is cached for good; false is re-checked every 30s so the feature switches on by
// itself shortly after the migration runs, with no redeploy.
const colCache = new Map() // table -> { ok, at }
export async function hasFxColumn(table) {
  const hit = colCache.get(table)
  if (hit && (hit.ok || Date.now() - hit.at < 30000)) return hit.ok
  let ok = false
  try {
    const { error } = await supabase.from(table).select('fx').limit(1)
    ok = !error
  } catch { ok = false }
  colCache.set(table, { ok, at: Date.now() })
  return ok
}

/** Columns string for a select, with `fx` appended only when the column exists. */
export async function withFx(table, cols) {
  return (await hasFxColumn(table)) ? `${cols}, fx` : cols
}

/**
 * Build the money-related part of an insert/patch. Throws MoneyError (400/503) — callers
 * turn that into a JSON response. `fields` maps request-amount-key -> db-column, e.g.
 *   { amount: 'amount' }  or  { amountCharged: 'amount_charged', salesTax: 'sales_tax' }
 * Returns { columns: {amount: usd...}, fx, currency } to spread into the row.
 */
export async function moneyForWrite({ table, body, fields, existing }) {
  const b = body || {}
  const touched = Object.keys(fields).some((k) => b[k] !== undefined) || b.currency !== undefined || b.fxRate !== undefined
  if (!touched) return null

  // On edits where the client only re-sent some fields, fall back to what's stored:
  // the ORIGINAL foreign amount if the record was entered in another currency.
  const existingFx = existing?.fx || null
  const currency = String(b.currency ?? existingFx?.currency ?? existing?.currency ?? 'USD').trim().toUpperCase()

  const amounts = {}
  for (const [reqKey, col] of Object.entries(fields)) {
    if (b[reqKey] !== undefined) amounts[col] = b[reqKey]
    else if (existing) {
      const stored = currency !== 'USD' && existingFx?.currency === currency && existingFx.original?.[col] != null
        ? existingFx.original[col]
        : (currency === 'USD' ? existing[col] : undefined)
      if (stored !== undefined) amounts[col] = stored
    }
  }

  const fxRate = b.fxRate !== undefined ? b.fxRate : (existingFx?.currency === currency ? existingFx.rate : undefined)
  const result = await convertToUsd({ amounts, currency, fxRate, fxManual: b.fxManual ?? existingFx?.manual })

  if (result.fx && !(await hasFxColumn(table))) {
    throw new MoneyError('Multi-currency is not switched on yet — run database migration 016 in Supabase, then try again.', 503)
  }

  // Only hand back the columns the request actually touched (or all of them if the
  // currency/rate changed, since every amount then needs re-converting) — so editing one
  // field never silently rewrites its siblings.
  const recalcAll = b.currency !== undefined || b.fxRate !== undefined
  const columns = {}
  for (const [reqKey, col] of Object.entries(fields)) {
    if ((recalcAll || b[reqKey] !== undefined) && result.usd[col] !== undefined) columns[col] = result.usd[col]
  }
  return { columns, fx: result.fx, currency: result.currency }
}

export function createCrmFxRouter({ requireAuth } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())

  // GET /rates — the currency list + today's rates, for the picker and the live preview.
  router.get('/rates', auth, async (_req, res) => {
    try {
      const r = await getRates()
      const currencies = Object.keys(r.rates)
        .filter((c) => !ISO_CODES || ISO_CODES.has(c))
        .map((code) => ({ code, name: (currencyNames && currencyNames.of(code)) || code, rate: r.rates[code] }))
        .sort((a, b) => a.code.localeCompare(b.code))
      const enabled = await hasFxColumn('expenses')
      res.json({ base: 'USD', asOf: r.asOf, source: r.source, stale: r.stale, enabled, currencies })
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message })
    }
  })

  // GET /convert?amount=200000&from=PKR — one-off conversion (same math the save path uses).
  router.get('/convert', auth, async (req, res) => {
    try {
      const out = await convertToUsd({ amounts: { amount: req.query.amount }, currency: req.query.from })
      const r = await getRates()
      res.json({ usd: out.usd.amount ?? 0, currency: out.currency, rate: out.fx ? out.fx.rate : 1, asOf: r.asOf, source: r.source })
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message })
    }
  })

  return router
}
