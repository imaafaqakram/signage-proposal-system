<template>
  <div class="crm">
    <header class="crm-top">
      <div class="crm-brand"><span class="dot"></span> Luminus CRM</div>
      <nav class="crm-nav">
        <router-link :to="{ name: 'crm' }">Inbox<span v-if="unreadCount" class="nav-unread-badge">{{ unreadCount }}</span></router-link>
        <router-link :to="{ name: 'crm-leads' }">Leads</router-link>
        <router-link :to="{ name: 'crm-responses' }">Responses</router-link>
        <router-link :to="{ name: 'crm-pipeline' }">Pipeline</router-link>
        <router-link :to="{ name: 'crm-projects' }">Projects</router-link>
        <router-link :to="{ name: 'crm-automation' }">Automation</router-link>
        <router-link :to="{ name: 'crm-orders' }">Orders</router-link>
        <router-link :to="{ name: 'crm-finance' }">Finance</router-link>
        <router-link :to="{ name: 'crm-materials' }">Materials</router-link>
        <router-link :to="{ name: 'crm-vendors' }">Vendors</router-link>
        <router-link :to="{ name: 'crm-templates' }">Templates</router-link>
      </nav>
      <button class="crm-theme-toggle" @click="crmTheme.toggle()" :title="crmTheme.theme === 'pro' ? 'Switch to Light theme' : 'Switch to Pro theme'">
        <i class="fas" :class="crmTheme.theme === 'pro' ? 'fa-sun' : 'fa-moon'"></i>
      </button>
      <div class="crm-counts" v-if="adminAuth.isAuthenticated">
        <span :style="{ color: netProfit >= 0 ? 'var(--crm-success)' : 'var(--crm-danger)' }">{{ money(netProfit) }} net</span>
      </div>
      <button v-if="adminAuth.isAuthenticated" class="crm-refresh" @click="loadAll" :disabled="loading" title="Refresh">
        <i class="fas" :class="loading ? 'fa-circle-notch fa-spin' : 'fa-rotate'"></i>
      </button>
    </header>

    <div class="crm-body">
      <!-- ═══ LOCK SCREEN ═══ -->
      <div v-if="!adminAuth.isAuthenticated" class="lock-wrap">
        <div class="lock-card">
          <i class="fas fa-lock lock-icon"></i>
          <h2>Finance</h2>
          <p>Expenses, revenue and net profit — admin password required.</p>
          <form class="gate-form" @submit.prevent="unlockAdmin">
            <input v-model="adminPassword" :type="showAdminPassword ? 'text' : 'password'" placeholder="Admin password" />
            <button type="button" class="pw-toggle" @click="showAdminPassword = !showAdminPassword" tabindex="-1"><i class="fas" :class="showAdminPassword ? 'fa-eye-slash' : 'fa-eye'"></i></button>
            <button type="submit" :disabled="adminAuth.loading">Unlock</button>
          </form>
          <p v-if="adminError" class="err-text">{{ adminError }}</p>
        </div>
      </div>

      <!-- ═══ FINANCE ═══ -->
      <div v-else class="wrap">
        <div class="stat-row">
          <div class="stat-box"><div class="lbl">Revenue</div><div class="val" style="color:var(--crm-success)">{{ money(reportSummary.orders.revenue) }}</div></div>
          <div class="stat-box"><div class="lbl">Expenses</div><div class="val" style="color:var(--crm-danger)">{{ money(reportSummary.expenses.total) }}</div></div>
          <div class="stat-box"><div class="lbl">Net Profit</div><div class="val" :style="{ color: netProfit >= 0 ? 'var(--crm-success)' : 'var(--crm-danger)' }">{{ money(netProfit) }}</div></div>
        </div>

        <section class="card">
          <div class="card-head">
            <h2><i class="fas fa-file-invoice-dollar"></i> Business Summary Report</h2>
          </div>
          <p class="sub">Revenue (from Orders) vs. expenses by category, for the date range below.</p>
          <div class="filter-bar" style="margin-bottom:0">
            <input type="date" v-model="filters.from" class="finp" @change="loadAll" />
            <span class="fto">to</span>
            <input type="date" v-model="filters.to" class="finp" @change="loadAll" />
            <button class="btn-sm" @click="exportReport('pdf')">⬇ Report PDF</button>
            <button class="btn-sm" @click="exportReport('excel')">⬇ Report Excel</button>
          </div>
          <div class="cat-breakdown">
            <div v-for="(amt, cat) in reportSummary.expenses.byCategory" :key="cat" class="cat-row">
              <span class="cat-name">{{ catLabel(cat) }}</span>
              <div class="cat-bar-track"><div class="cat-bar" :style="{ width: barWidth(amt) + '%' }"></div></div>
              <span class="cat-amt">{{ money(amt) }}</span>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <h2><i class="fas fa-scale-balanced"></i> Tax & Compliance</h2>
          </div>
          <p class="sub">Quarterly sales tax collected, plus vendor payment totals checked against the
            $600 1099-NEC reference threshold. Informational only — confirm actual filing requirements
            with an accountant.</p>
          <div class="filter-bar">
            <input type="number" v-model.number="taxYear" @change="loadTaxSummary" class="finp" style="width:90px" />
            <button class="btn-sm" @click="exportTaxSummary('pdf')">⬇ Tax Summary PDF</button>
            <button class="btn-sm" @click="exportTaxSummary('excel')">⬇ Tax Summary Excel</button>
          </div>

          <table class="tbl" style="margin-bottom:16px">
            <thead><tr><th>Quarter</th><th class="num">Revenue</th><th class="num">Sales Tax</th></tr></thead>
            <tbody>
              <tr v-for="q in taxSummary.quarters" :key="q.quarter">
                <td>Q{{ q.quarter }}</td>
                <td class="num">{{ money(q.revenue) }}</td>
                <td class="num">{{ money(q.tax) }}</td>
              </tr>
            </tbody>
          </table>

          <div class="sub" style="margin:0 0 8px;font-weight:700;color:var(--crm-text-secondary)">Vendor Payments — 1099 Reference</div>
          <table class="tbl" v-if="taxSummary.vendorTotals.length">
            <thead><tr><th>Vendor</th><th class="num">Total Paid</th><th></th></tr></thead>
            <tbody>
              <tr v-for="v in taxSummary.vendorTotals" :key="v.name">
                <td>{{ v.name }}</td>
                <td class="num">{{ money(v.total) }}</td>
                <td><span v-if="v.total >= 600" class="cat-badge" style="background:var(--crm-warn-bg);color:var(--crm-warn)">review</span></td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty" style="padding:16px 10px">
            <p>No vendor-tagged expenses for {{ taxYear }} yet.</p>
          </div>
        </section>

        <section class="card">
          <div class="filter-bar">
            <select v-model="filters.category" class="finp" @change="loadAll">
              <option value="">All categories</option>
              <option value="ad_spend">Ad Spend</option>
              <option value="shipping">Shipping</option>
              <option value="tax">Tax</option>
              <option value="materials">Materials</option>
              <option value="software">Software</option>
              <option value="other">Other</option>
            </select>
            <input v-model="filters.q" @input="onSearch" placeholder="Search description or vendor…" class="finp" style="flex:1;min-width:160px" />
            <button class="btn-sm" @click="exportFile('pdf')">⬇ PDF</button>
            <button class="btn-sm" @click="exportFile('excel')">⬇ Excel</button>
            <button class="btn-sm primary" @click="openNew">+ New Expense</button>
          </div>

          <table class="tbl" v-if="rows.length">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th class="num">Amount</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id">
                <td class="muted small">{{ fmtDate(r.expense_date) }}</td>
                <td><span class="cat-badge">{{ catLabel(r.category) }}</span></td>
                <td class="muted">{{ r.description || '—' }}</td>
                <td class="muted">{{ r.vendor || '—' }}</td>
                <td class="num" style="font-weight:700">{{ money(r.amount) }}</td>
                <td class="right">
                  <button class="btn-sm" @click="openEdit(r)">Edit</button>
                  <button class="btn-sm warn" @click="removeExpense(r)" style="margin-left:6px">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="!loading" class="empty">
            <i class="fas fa-receipt"></i>
            <p>No expenses{{ filters.q ? ' matching that search' : '' }} logged yet.</p>
          </div>
          <div v-if="rows.length < total" class="more-row">
            <button class="btn-sm" @click="loadMore">Load more ({{ total - rows.length }} left)</button>
          </div>
        </section>
      </div>
    </div>

    <!-- ═══ EXPENSE MODAL ═══ -->
    <div v-if="modalOpen" class="modal-bg" @click.self="closeModal">
      <div class="modal">
        <h3>{{ editingId ? 'Edit Expense' : 'New Expense' }}</h3>
        <div class="modal-grid">
          <div class="fg"><label>Category *</label>
            <select v-model="form.category" class="finp" style="width:100%">
              <option value="ad_spend">Ad Spend</option><option value="shipping">Shipping</option>
              <option value="tax">Tax</option><option value="materials">Materials</option>
              <option value="software">Software</option><option value="other">Other</option>
            </select>
          </div>
          <div class="fg"><label>Amount *</label><input v-model.number="form.amount" type="number" step="0.01" class="finp" style="width:100%" /></div>
        </div>
        <div class="fg"><label>Description</label><input v-model="form.description" class="finp" style="width:100%" /></div>
        <div class="modal-grid">
          <div class="fg"><label>Vendor</label><input v-model="form.vendor" class="finp" style="width:100%" /></div>
          <div class="fg"><label>Date</label><input v-model="form.expenseDate" type="date" class="finp" style="width:100%" /></div>
        </div>
        <div class="fg"><label>Notes</label><input v-model="form.notes" class="finp" style="width:100%" /></div>

        <p v-if="formError" class="err-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn-sm primary" @click="saveExpense">{{ editingId ? 'Save Changes' : 'Add Expense' }}</button>
          <button class="btn-sm" @click="closeModal">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useCrmThemeStore } from '@/stores/crmThemeStore'
import { useInboxUnread } from '@/composables/useInboxUnread'

const crmTheme = useCrmThemeStore()
const { unreadCount } = useInboxUnread()
import { ref, reactive, onMounted, computed } from 'vue'
import { useAdminAuthStore } from '@/stores/adminAuthStore'
import { employeeNameHeader } from '@/services/crmActivity'

const adminAuth = useAdminAuthStore()
const adminPassword = ref('')
const showAdminPassword = ref(false)
const adminError = ref('')
const loading = ref(false)

const api = (path, opts = {}) =>
  adminAuth.authedFetch(`/api/crm/expenses${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...employeeNameHeader(), ...(opts.headers || {}) }
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
    return j
  })

const CAT_LABELS = { ad_spend: 'Ad Spend', shipping: 'Shipping', tax: 'Tax', materials: 'Materials', software: 'Software', other: 'Other' }
function catLabel(c) { return CAT_LABELS[c] || c }

const rows = ref([])
const total = ref(0)
const reportSummary = ref({ orders: { revenue: 0, tax: 0, count: 0 }, expenses: { total: 0, count: 0, byCategory: {} }, netProfit: 0 })
const netProfit = computed(() => reportSummary.value.netProfit)
const LIMIT = 50
let offset = 0

const filters = reactive({ from: '', to: '', category: '', q: '' })

function money(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—' }
function barWidth(amt) {
  const max = Math.max(1, ...Object.values(reportSummary.value.expenses.byCategory || {}))
  return Math.max(2, Math.round((amt / max) * 100))
}

function qs(withCategory = true) {
  const p = new URLSearchParams()
  if (filters.from) p.set('from', filters.from)
  if (filters.to) p.set('to', filters.to)
  if (withCategory && filters.category) p.set('category', filters.category)
  if (filters.q.trim()) p.set('q', filters.q.trim())
  return p
}

async function loadRows(reset = true) {
  if (reset) { offset = 0; rows.value = [] }
  loading.value = true
  try {
    const p = qs(); p.set('limit', LIMIT); p.set('offset', offset)
    const { rows: r, total: t } = await api(`/?${p}`)
    rows.value = reset ? r : [...rows.value, ...r]
    total.value = t
    offset += r.length
  } catch (e) { console.error('[crm-finance] load', e) } finally { loading.value = false }
}
function loadMore() { loadRows(false) }
let searchTimer = null
function onSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadRows(true), 300) }

async function loadReportSummary() {
  try { reportSummary.value = await api(`/report/summary?${qs(false)}`) } catch (e) { console.error(e) }
}

// ── Tax & Compliance (Milestone 4) ──
const taxYear = ref(new Date().getFullYear())
const taxSummary = ref({ year: taxYear.value, quarters: [1, 2, 3, 4].map((q) => ({ quarter: q, revenue: 0, tax: 0 })), vendorTotals: [], businessTaxPaid: 0 })
async function loadTaxSummary() {
  try { taxSummary.value = await api(`/report/tax-summary?year=${taxYear.value}`) } catch (e) { console.error('[crm-finance] tax summary', e) }
}
async function exportTaxSummary(kind) {
  try {
    const res = await adminAuth.authedFetch(`/api/crm/expenses/report/tax-summary/${kind}?year=${taxYear.value}&theme=${crmTheme.theme === 'pro' ? 'dark' : 'light'}`)
    if (!res.ok) throw new Error('Export failed')
    await downloadBlob(res, `tax-summary-${taxYear.value}.${kind === 'excel' ? 'xlsx' : 'pdf'}`)
  } catch (e) { alert(e.message || 'Export failed') }
}

async function loadAll() { await Promise.all([loadReportSummary(), loadRows(true), loadTaxSummary()]) }

async function exportFile(kind) {
  try {
    const res = await adminAuth.authedFetch(`/api/crm/expenses/export/${kind}?${qs()}&theme=${crmTheme.theme === 'pro' ? 'dark' : 'light'}`)
    if (!res.ok) throw new Error('Export failed')
    await downloadBlob(res, `expenses.${kind === 'excel' ? 'xlsx' : 'pdf'}`)
  } catch (e) { alert(e.message || 'Export failed') }
}
async function exportReport(kind) {
  try {
    const res = await adminAuth.authedFetch(`/api/crm/expenses/report/${kind}?${qs(false)}&theme=${crmTheme.theme === 'pro' ? 'dark' : 'light'}`)
    if (!res.ok) throw new Error('Export failed')
    await downloadBlob(res, `business-report.${kind === 'excel' ? 'xlsx' : 'pdf'}`)
  } catch (e) { alert(e.message || 'Export failed') }
}
async function downloadBlob(res, fallbackName) {
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const cd = res.headers.get('Content-Disposition') || ''
  const m = cd.match(/filename="([^"]+)"/)
  a.href = url
  a.download = m ? m[1] : fallbackName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// ── modal / form ──
const modalOpen = ref(false)
const editingId = ref(null)
const formError = ref('')
const form = reactive({ category: 'ad_spend', description: '', amount: null, vendor: '', expenseDate: new Date().toISOString().slice(0, 10), notes: '' })

function resetForm() {
  Object.assign(form, { category: 'ad_spend', description: '', amount: null, vendor: '', expenseDate: new Date().toISOString().slice(0, 10), notes: '' })
  formError.value = ''
}
function openNew() { resetForm(); editingId.value = null; modalOpen.value = true }
function openEdit(r) {
  resetForm()
  editingId.value = r.id
  Object.assign(form, { category: r.category, description: r.description || '', amount: Number(r.amount), vendor: r.vendor || '', expenseDate: r.expense_date, notes: r.notes || '' })
  modalOpen.value = true
}
function closeModal() { modalOpen.value = false }

async function saveExpense() {
  formError.value = ''
  if (!(Number(form.amount) >= 0)) { formError.value = 'A valid amount is required.'; return }
  try {
    const body = JSON.stringify(form)
    if (editingId.value) await api(`/${editingId.value}`, { method: 'PATCH', body })
    else await api('/', { method: 'POST', body })
    modalOpen.value = false
    await loadAll()
  } catch (e) { formError.value = e.message || 'Could not save expense' }
}

async function removeExpense(r) {
  if (!confirm(`Delete this ${catLabel(r.category)} expense of ${money(r.amount)}? This can't be undone.`)) return
  try {
    await api(`/${r.id}`, { method: 'DELETE' })
    await loadAll()
  } catch (e) { alert(e.message || 'Could not delete') }
}

async function unlockAdmin() {
  adminError.value = ''
  try {
    await adminAuth.login(adminPassword.value)
    adminPassword.value = ''
    await loadAll()
  } catch (e) { adminError.value = e.message || 'Wrong password' }
}

onMounted(async () => {
  await adminAuth.initialize()
  if (adminAuth.isAuthenticated) await loadAll()
})
</script>

<style scoped>
.crm { position: fixed; inset: 0; background: var(--crm-bg); color: var(--crm-text); display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow-y: auto; }
.crm-top { display: flex; align-items: center; gap: 16px; padding: 12px 18px; border-bottom: 1px solid var(--crm-border-header); background: var(--crm-header-bg); flex: none; position: sticky; top: 0; z-index: 5; }
.crm-brand { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.crm-brand .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--crm-accent); box-shadow: 0 0 8px rgba(0, 243, 255, .7), 0 0 2px var(--crm-accent); }
.crm-nav { display: flex; gap: 4px; }
.crm-nav a { font-size: 12.5px; font-weight: 600; color: var(--crm-text-muted); text-decoration: none; padding: 5px 11px; border-radius: 6px; }
.crm-nav a:hover { color: var(--crm-text); background: var(--crm-hover-bg); }
.crm-theme-toggle { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; flex: none; }
.crm-theme-toggle:hover { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
.crm-nav a.router-link-exact-active { color: var(--crm-accent); background: var(--crm-accent-soft-bg); }
.crm-counts { display: flex; gap: 14px; font-size: 12.5px; font-weight: 700; margin-left: auto; }
.crm-refresh { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; }
.crm-refresh:hover { background: var(--crm-hover-bg-strong); }

.lock-wrap { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 57px); padding: 40px; }
.lock-card { background: var(--crm-panel-bg); border: 1px solid var(--crm-border); border-radius: 14px; padding: 40px 44px; text-align: center; max-width: 380px; }
.lock-icon { font-size: 28px; color: var(--crm-warn); margin-bottom: 14px; }
.lock-card h2 { font-size: 18px; margin-bottom: 6px; }
.lock-card p { font-size: 12.5px; color: var(--crm-text-muted); margin-bottom: 18px; line-height: 1.6; }
.gate-form { display: flex; gap: 8px; }
.gate-form input { flex: 1; background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 7px; padding: 9px 12px; font: inherit; font-size: 13px; }
.gate-form button { background: var(--crm-accent); color: var(--crm-accent-contrast); border: 0; font-weight: 700; font-size: 12.5px; padding: 9px 16px; border-radius: 7px; cursor: pointer; }
.pw-toggle { background: transparent !important; color: var(--crm-text-muted) !important; padding: 0 8px !important; font-weight: 400 !important; }
.pw-toggle:hover { color: var(--crm-text) !important; }
.err-text { color: var(--crm-danger); font-size: 11.5px; margin-top: 8px; }

.wrap { max-width: 1080px; margin: 0 auto; padding: 22px 18px 60px; display: flex; flex-direction: column; gap: 18px; }
.stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.stat-box { background: var(--crm-panel-bg); border: 1px solid var(--crm-border); border-radius: 12px; padding: 16px 18px; }
.stat-box .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--crm-text-dim); font-weight: 700; margin-bottom: 6px; }
.stat-box .val { font-family: 'Syne', sans-serif; font-size: 24px; font-weight: 800; }

.card { background: var(--crm-panel-bg); border: 1px solid var(--crm-border); border-radius: 12px; padding: 18px 20px; }
.card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.card-head h2 { margin: 0; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.card-head h2 i { color: var(--crm-accent); font-size: 13px; }
.sub { font-size: 12px; color: var(--crm-text-muted); margin: 4px 0 14px; }
.filter-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.finp { background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 7px; padding: 7px 10px; font: inherit; font-size: 12.5px; }
.fto { font-size: 11.5px; color: var(--crm-text-dim); }
.btn-sm { display: inline-block; background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); border-radius: 6px; font-size: 11.5px; font-weight: 600; padding: 7px 12px; cursor: pointer; text-decoration: none; }
.btn-sm:hover { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
.btn-sm.primary { background: var(--crm-accent); color: var(--crm-accent-contrast); border-color: var(--crm-accent); }
.btn-sm.primary:hover { background: var(--crm-accent-hover); }
.btn-sm.warn { border-color: var(--crm-warn-border); color: var(--crm-warn); }
.btn-sm.warn:hover { background: var(--crm-warn-bg); }

.cat-breakdown { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
.cat-row { display: grid; grid-template-columns: 100px 1fr 90px; align-items: center; gap: 10px; }
.cat-name { font-size: 11.5px; color: var(--crm-text-secondary); }
.cat-bar-track { height: 8px; background: var(--crm-row-border); border-radius: 4px; overflow: hidden; }
.cat-bar { height: 100%; background: linear-gradient(90deg, var(--crm-accent), #0891b2); border-radius: 4px; }
.cat-amt { text-align: right; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.cat-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 8px; border-radius: 4px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); }

.tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tbl thead th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; padding: 7px 8px; border-bottom: 1px solid var(--crm-border); }
.tbl tbody td { padding: 10px 8px; border-bottom: 1px solid var(--crm-row-border); vertical-align: top; }
.tbl .muted { color: var(--crm-text-muted); }
.tbl .small { font-size: 11.5px; }
.tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
.tbl .right { text-align: right; white-space: nowrap; }

.empty { padding: 30px 10px; text-align: center; color: var(--crm-text-faint); }
.empty i { font-size: 22px; opacity: .5; }
.empty p { margin: 8px 0 0; font-size: 12.5px; color: var(--crm-text-muted); }
.more-row { text-align: center; padding-top: 12px; }

.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.modal { background: var(--crm-header-bg); border: 1px solid var(--crm-border-header); border-radius: 14px; padding: 26px 28px; width: 480px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
.modal h3 { font-family: 'Syne', sans-serif; font-size: 18px; margin-bottom: 18px; }
.modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fg { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.fg label { font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--crm-text-muted); }
.modal-actions { display: flex; gap: 10px; margin-top: 16px; }
</style>
