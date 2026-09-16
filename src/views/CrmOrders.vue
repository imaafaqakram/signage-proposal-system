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
        <span>{{ money(summary.revenue) }} revenue</span>
        <span>{{ summary.count }} orders</span>
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
          <h2>Orders</h2>
          <p>Revenue and order records — admin password required.</p>
          <form class="gate-form" @submit.prevent="unlockAdmin">
            <input v-model="adminPassword" :type="showAdminPassword ? 'text' : 'password'" placeholder="Admin password" />
            <button type="button" class="pw-toggle" @click="showAdminPassword = !showAdminPassword" tabindex="-1"><i class="fas" :class="showAdminPassword ? 'fa-eye-slash' : 'fa-eye'"></i></button>
            <button type="submit" :disabled="adminAuth.loading">Unlock</button>
          </form>
          <p v-if="adminError" class="err-text">{{ adminError }}</p>
        </div>
      </div>

      <!-- ═══ ORDERS ═══ -->
      <div v-else class="wrap">
        <div class="stat-row">
          <div class="stat-box"><div class="lbl">Revenue</div><div class="val" style="color:var(--crm-success)">{{ money(summary.revenue) }}</div><div class="sub2">{{ rangeLabel }}</div></div>
          <div class="stat-box"><div class="lbl">Sales Tax Collected</div><div class="val" style="color:var(--crm-info)">{{ money(summary.tax) }}</div></div>
          <div class="stat-box"><div class="lbl">Orders</div><div class="val" style="color:var(--crm-accent)">{{ summary.count }}</div></div>
        </div>

        <section class="card">
          <div class="filter-bar">
            <input type="date" v-model="filters.from" class="finp" @change="loadAll" />
            <span class="fto">to</span>
            <input type="date" v-model="filters.to" class="finp" @change="loadAll" />
            <select v-model="filters.status" class="finp" @change="loadAll">
              <option value="">All statuses</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="refunded">Refunded</option>
            </select>
            <input v-model="filters.q" @input="onSearch" placeholder="Search client or email…" class="finp" style="flex:1;min-width:160px" />
            <button class="btn-sm" @click="exportFile('pdf')">⬇ PDF</button>
            <button class="btn-sm" @click="exportFile('excel')">⬇ Excel</button>
            <button class="btn-sm primary" @click="openNew">+ New Order</button>
          </div>

          <table class="tbl" v-if="rows.length">
            <thead><tr><th>Date</th><th>Client</th><th>Description</th><th>Status</th><th class="num">Amount</th><th class="num">Tax</th><th class="num">Total</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id">
                <td class="muted small">{{ fmtDate(r.order_date) }}</td>
                <td>{{ r.client_name }}<div v-if="r.client_email" class="sub-email">{{ r.client_email }}</div></td>
                <td class="muted">{{ r.description || '—' }}</td>
                <td><span class="status-badge" :class="'st-' + r.status">{{ r.status }}</span></td>
                <td class="num">{{ money(r.amount_charged) }}</td>
                <td class="num muted">{{ money(r.sales_tax) }}</td>
                <td class="num" style="font-weight:700">{{ money(r.total_amount) }}</td>
                <td class="right">
                  <button class="btn-sm" @click="openEdit(r)">Edit</button>
                  <button class="btn-sm warn" @click="removeOrder(r)" style="margin-left:6px">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="!loading" class="empty">
            <i class="fas fa-receipt"></i>
            <p>No orders{{ filters.q ? ' matching that search' : '' }} yet.</p>
          </div>
          <div v-if="rows.length < total" class="more-row">
            <button class="btn-sm" @click="loadMore">Load more ({{ total - rows.length }} left)</button>
          </div>
        </section>
      </div>
    </div>

    <!-- ═══ ORDER MODAL ═══ -->
    <div v-if="modalOpen" class="modal-bg" @click.self="closeModal">
      <div class="modal">
        <h3>{{ editingId ? 'Edit Order' : 'New Order' }}</h3>

        <div class="fg">
          <label>Link to an existing lead (optional)</label>
          <input v-model="leadSearch" @input="onLeadSearch" placeholder="Search leads by name or email…" class="finp" style="width:100%" />
          <ul v-if="leadResults.length" class="lead-results">
            <li v-for="l in leadResults" :key="l.id" @click="pickLead(l)">{{ l.client_name || '—' }} <span class="muted">{{ l.contact_email }}</span></li>
          </ul>
          <div v-if="form.leadId" class="linked-lead">Linked to lead #{{ form.leadId }} <button type="button" class="btn-icon" @click="form.leadId = null">✕</button></div>
        </div>

        <div class="modal-grid">
          <div class="fg"><label>Client Name *</label><input v-model="form.clientName" class="finp" style="width:100%" /></div>
          <div class="fg"><label>Client Email</label><input v-model="form.clientEmail" class="finp" style="width:100%" /></div>
        </div>
        <div class="fg"><label>Description</label><input v-model="form.description" placeholder="e.g. 3D Acrylic Front-lit, 36x24in" class="finp" style="width:100%" /></div>

        <div class="modal-grid">
          <div class="fg">
            <label>Amount Charged * <span v-if="suggestedAmount" class="suggest-hint">(suggested ${{ suggestedAmount }} from their proposal — verify before saving)</span></label>
            <input v-model.number="form.amountCharged" type="number" step="0.01" class="finp" style="width:100%" />
          </div>
          <div class="fg"><label>Sales Tax</label><input v-model.number="form.salesTax" type="number" step="0.01" class="finp" style="width:100%" /></div>
        </div>
        <div class="modal-grid">
          <div class="fg"><label>Status</label>
            <select v-model="form.status" class="finp" style="width:100%">
              <option value="paid">Paid</option><option value="pending">Pending</option>
              <option value="partial">Partial</option><option value="refunded">Refunded</option>
            </select>
          </div>
          <div class="fg"><label>Payment Method</label><input v-model="form.paymentMethod" placeholder="e.g. card, wire, cash" class="finp" style="width:100%" /></div>
        </div>
        <div class="modal-grid">
          <div class="fg"><label>Order Date</label><input v-model="form.orderDate" type="date" class="finp" style="width:100%" /></div>
          <div class="fg"><label>Notes</label><input v-model="form.notes" class="finp" style="width:100%" /></div>
        </div>

        <p v-if="formError" class="err-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn-sm primary" @click="saveOrder">{{ editingId ? 'Save Changes' : 'Create Order' }}</button>
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
  adminAuth.authedFetch(`/api/crm/orders${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...employeeNameHeader(), ...(opts.headers || {}) }
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
    return j
  })

const rows = ref([])
const total = ref(0)
const summary = ref({ revenue: 0, tax: 0, total: 0, count: 0 })
const LIMIT = 50
let offset = 0

const filters = reactive({ from: '', to: '', status: '', q: '' })
const rangeLabel = computed(() => (filters.from || filters.to) ? `${filters.from || 'start'} – ${filters.to || 'now'}` : 'all time')

function money(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—' }

function qs() {
  const p = new URLSearchParams()
  if (filters.from) p.set('from', filters.from)
  if (filters.to) p.set('to', filters.to)
  if (filters.status) p.set('status', filters.status)
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
  } catch (e) { console.error('[crm-orders] load', e) } finally { loading.value = false }
}
function loadMore() { loadRows(false) }
let searchTimer = null
function onSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadRows(true), 300) }

async function loadSummary() {
  try { summary.value = await api(`/summary?${qs()}`) } catch (e) { console.error(e) }
}
async function loadAll() { await Promise.all([loadSummary(), loadRows(true)]) }

async function exportFile(kind) {
  try {
    const res = await adminAuth.authedFetch(`/api/crm/orders/export/${kind}?${qs()}&theme=${crmTheme.theme === 'pro' ? 'dark' : 'light'}`)
    if (!res.ok) throw new Error('Export failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const cd = res.headers.get('Content-Disposition') || ''
    const m = cd.match(/filename="([^"]+)"/)
    a.href = url
    a.download = m ? m[1] : `orders.${kind === 'excel' ? 'xlsx' : 'pdf'}`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  } catch (e) { alert(e.message || 'Export failed') }
}

// ── modal / form ──
const modalOpen = ref(false)
const editingId = ref(null)
const formError = ref('')
const suggestedAmount = ref(null)
const leadSearch = ref('')
const leadResults = ref([])
let leadTimer = null
const form = reactive({ leadId: null, clientName: '', clientEmail: '', description: '', amountCharged: null, salesTax: 0, status: 'paid', paymentMethod: '', orderDate: new Date().toISOString().slice(0, 10), notes: '' })

function resetForm() {
  Object.assign(form, { leadId: null, clientName: '', clientEmail: '', description: '', amountCharged: null, salesTax: 0, status: 'paid', paymentMethod: '', orderDate: new Date().toISOString().slice(0, 10), notes: '' })
  leadSearch.value = ''; leadResults.value = []; suggestedAmount.value = null; formError.value = ''
}
function openNew() { resetForm(); editingId.value = null; modalOpen.value = true }
function openEdit(r) {
  resetForm()
  editingId.value = r.id
  Object.assign(form, {
    leadId: r.lead_id, clientName: r.client_name, clientEmail: r.client_email || '', description: r.description || '',
    amountCharged: Number(r.amount_charged), salesTax: Number(r.sales_tax), status: r.status,
    paymentMethod: r.payment_method || '', orderDate: r.order_date, notes: r.notes || ''
  })
  modalOpen.value = true
}
function closeModal() { modalOpen.value = false }

// /api/crm/leads is employee-tier (requireBypassAuth), not admin-tier — reached
// with the same bypass token every other CRM view already has in sessionStorage
// (the user had to pass that gate just to open the CRM at all), not the
// stronger owner_admin_token this page's own lock screen uses.
function onLeadSearch() {
  clearTimeout(leadTimer)
  const q = leadSearch.value.trim()
  if (q.length < 2) { leadResults.value = []; return }
  leadTimer = setTimeout(async () => {
    try {
      const bypassToken = sessionStorage.getItem('admin_bypass_token') || ''
      const res = await fetch(`/api/crm/leads?q=${encodeURIComponent(q)}&limit=8`, {
        headers: { Authorization: `Bearer ${bypassToken}` }
      })
      const j = await res.json().catch(() => ({}))
      leadResults.value = j.leads || []
    } catch (e) { console.error(e) }
  }, 300)
}
async function pickLead(l) {
  form.leadId = l.id
  form.clientName = l.client_name || form.clientName
  form.clientEmail = l.contact_email || form.clientEmail
  leadResults.value = []; leadSearch.value = ''
  try {
    const s = await api(`/suggest-amount?leadId=${l.id}`)
    suggestedAmount.value = s.suggestedAmount
    if (s.suggestedAmount && !form.amountCharged) form.amountCharged = s.suggestedAmount
    if (s.signType && !form.description) form.description = s.signType
  } catch (e) { console.error(e) }
}

async function saveOrder() {
  formError.value = ''
  if (!form.clientName.trim()) { formError.value = 'Client name is required.'; return }
  if (!(Number(form.amountCharged) >= 0)) { formError.value = 'A valid amount charged is required.'; return }
  try {
    const body = JSON.stringify(form)
    if (editingId.value) await api(`/${editingId.value}`, { method: 'PATCH', body })
    else await api('/', { method: 'POST', body })
    modalOpen.value = false
    await loadAll()
  } catch (e) { formError.value = e.message || 'Could not save order' }
}

async function removeOrder(r) {
  if (!confirm(`Delete the order for ${r.client_name}? This can't be undone.`)) return
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
.crm-counts { display: flex; gap: 14px; font-size: 12.5px; color: var(--crm-text-muted); margin-left: auto; }
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
.stat-box .sub2 { font-size: 10.5px; color: var(--crm-text-dim); margin-top: 4px; }

.card { background: var(--crm-panel-bg); border: 1px solid var(--crm-border); border-radius: 12px; padding: 18px 20px; }
.filter-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.finp { background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 7px; padding: 7px 10px; font: inherit; font-size: 12.5px; }
.fto { font-size: 11.5px; color: var(--crm-text-dim); }
.btn-sm { display: inline-block; background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); border-radius: 6px; font-size: 11.5px; font-weight: 600; padding: 7px 12px; cursor: pointer; text-decoration: none; }
.btn-sm:hover { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
.btn-sm.primary { background: var(--crm-accent); color: var(--crm-accent-contrast); border-color: var(--crm-accent); }
.btn-sm.primary:hover { background: var(--crm-accent-hover); }
.btn-sm.warn { border-color: var(--crm-warn-border); color: var(--crm-warn); }
.btn-sm.warn:hover { background: var(--crm-warn-bg); }

.tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tbl thead th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; padding: 7px 8px; border-bottom: 1px solid var(--crm-border); }
.tbl tbody td { padding: 10px 8px; border-bottom: 1px solid var(--crm-row-border); vertical-align: top; }
.tbl .muted { color: var(--crm-text-muted); }
.tbl .small { font-size: 11.5px; }
.tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
.tbl .right { text-align: right; white-space: nowrap; }
.sub-email { font-size: 11px; color: var(--crm-text-dim); margin-top: 2px; }
.status-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 8px; border-radius: 4px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); }
.status-badge.st-paid { background: var(--crm-success-bg); color: var(--crm-success); }
.status-badge.st-pending { background: var(--crm-warn-bg); color: var(--crm-warn); }
.status-badge.st-partial { background: var(--crm-badge-bg); color: var(--crm-info); }
.status-badge.st-refunded { background: var(--crm-danger-bg); color: var(--crm-danger); }

.empty { padding: 30px 10px; text-align: center; color: var(--crm-text-faint); }
.empty i { font-size: 22px; opacity: .5; }
.empty p { margin: 8px 0 0; font-size: 12.5px; color: var(--crm-text-muted); }
.more-row { text-align: center; padding-top: 12px; }

.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.modal { background: var(--crm-header-bg); border: 1px solid var(--crm-border-header); border-radius: 14px; padding: 26px 28px; width: 520px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
.modal h3 { font-family: 'Syne', sans-serif; font-size: 18px; margin-bottom: 18px; }
.modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fg { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.fg label { font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--crm-text-muted); }
.suggest-hint { text-transform: none; font-weight: 500; color: var(--crm-warn); font-size: 10.5px; letter-spacing: 0; }
.lead-results { list-style: none; margin: 6px 0 0; padding: 0; border: 1px solid var(--crm-border); border-radius: 8px; max-height: 140px; overflow-y: auto; }
.lead-results li { padding: 7px 10px; font-size: 12px; cursor: pointer; border-bottom: 1px solid var(--crm-border); }
.lead-results li:last-child { border-bottom: none; }
.lead-results li:hover { background: var(--crm-hover-bg); }
.linked-lead { margin-top: 6px; font-size: 11.5px; color: var(--crm-success); display: flex; align-items: center; gap: 8px; }
.btn-icon { background: none; border: none; color: var(--crm-text-muted); cursor: pointer; font-size: 12px; }
.modal-actions { display: flex; gap: 10px; margin-top: 16px; }
</style>
