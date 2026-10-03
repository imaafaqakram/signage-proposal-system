import { ref, computed } from 'vue'
import { crmJson } from '@/services/crmApi'

// Live exchange rates for the CRM's multi-currency entry. The server (crm-fx.js) does the
// real conversion when a record is saved; this is only for the currency picker and the
// live "≈ $719.62 USD" preview, so it can be fetched once and shared across every form.
// Module-level state, same sharing pattern as useInboxUnread.js.
const data = ref(null) // { base, asOf, source, stale, enabled, currencies: [{ code, name, rate }] }
const error = ref('')
let loadedAt = 0
let inflight = null
const TTL_MS = 10 * 60 * 1000

// Pinned to the top of the picker — the currencies this business is most likely to use.
export const POPULAR = ['USD', 'PKR', 'EUR', 'GBP', 'CAD', 'AUD', 'AED', 'INR', 'CNY', 'MXN', 'SAR', 'TRY']

export function useFx() {
  async function load(force = false) {
    if (!force && data.value && Date.now() - loadedAt < TTL_MS) return
    if (!inflight) {
      inflight = crmJson('/fx/rates')
        .then((d) => { data.value = d; loadedAt = Date.now(); error.value = '' })
        .catch((e) => { error.value = e.message || 'Exchange rates are unavailable right now.' })
        .finally(() => { inflight = null })
    }
    await inflight
  }

  const byCode = computed(() => {
    const m = new Map()
    for (const c of data.value?.currencies || []) m.set(c.code, c)
    return m
  })
  const rateFor = (code) => (code === 'USD' ? 1 : byCode.value.get(code)?.rate || null)
  const nameFor = (code) => byCode.value.get(code)?.name || code

  const options = computed(() => {
    const all = data.value?.currencies || []
    const popular = POPULAR.map((code) => all.find((c) => c.code === code)).filter(Boolean)
    const rest = all.filter((c) => !POPULAR.includes(c.code))
    return { popular, rest }
  })

  return {
    load,
    error,
    enabled: computed(() => !!data.value?.enabled),
    ready: computed(() => !!data.value),
    asOf: computed(() => data.value?.asOf || null),
    source: computed(() => data.value?.source || ''),
    stale: computed(() => !!data.value?.stale),
    options,
    rateFor,
    nameFor
  }
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** Same maths the server uses when it saves: foreign amount ÷ (units per USD). */
export function toUsd(amount, rate) {
  const n = Number(amount)
  if (!Number.isFinite(n) || !(rate > 0)) return null
  return round2(n / rate)
}

/** "PKR 200,000" — the amount as originally typed, for display next to the USD figure. */
export function formatOriginal(code, amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return ''
  return `${code} ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}
