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
        <CrmBroadcastLink />
        <CrmTeamLink />
      </nav>
      <button class="crm-theme-toggle" @click="crmTheme.toggle()" :title="crmTheme.theme === 'pro' ? 'Switch to Light theme' : 'Switch to Pro theme'">
        <i class="fas" :class="crmTheme.theme === 'pro' ? 'fa-sun' : 'fa-moon'"></i>
      </button>
      <CrmUserChip />
      <div class="crm-counts" v-if="adminAuth.isAuthenticated">
        <span>{{ rows.length }} vendors</span>
        <span>{{ money(totalPaid) }} total paid</span>
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
          <h2>Vendors</h2>
          <p v-if="isEmployeeOnly">Your account is an employee account, so this page is limited to admins. Ask an admin if you need access.</p>
          <template v-else>
          <p>Vendor payments and purchase orders — admin password required.</p>
          <form class="gate-form" @submit.prevent="unlockAdmin">
            <input v-model="adminPassword" :type="showAdminPassword ? 'text' : 'password'" placeholder="Admin password" />
            <button type="button" class="pw-toggle" @click="showAdminPassword = !showAdminPassword" tabindex="-1"><i class="fas" :class="showAdminPassword ? 'fa-eye-slash' : 'fa-eye'"></i></button>
            <button type="submit" :disabled="adminAuth.loading">Unlock</button>
          </form>
          <p v-if="adminError" class="err-text">{{ adminError }}</p>
          </template>
        </div>
      </div>

      <!-- ═══ VENDORS ═══ -->
      <div v-else class="wrap">
        <div class="stat-row">
          <div class="stat-box"><div class="lbl">Vendors</div><div class="val" style="color:var(--crm-accent)">{{ rows.length }}</div></div>
          <div class="stat-box"><div class="lbl">Total Paid</div><div class="val" style="color:var(--crm-danger)">{{ money(totalPaid) }}</div></div>
          <div class="stat-box"><div class="lbl">Open POs</div><div class="val" style="color:var(--crm-warn)">{{ openPOs }}</div></div>
        </div>

        <section class="card">
          <div class="filter-bar">
            <input v-model="q" placeholder="Search vendors…" class="finp" style="flex:1;min-width:160px" />
            <button class="btn-sm" @click="exportFile('pdf')">⬇ PDF</button>
            <button class="btn-sm" @click="exportFile('excel')">⬇ Excel</button>
            <button class="btn-sm" @click="openNewPO">+ New PO</button>
            <button class="btn-sm primary" @click="openNewVendor">+ New Vendor</button>
          </div>

          <table class="tbl" v-if="filteredRows.length">
            <thead><tr><th></th><th>Vendor</th><th>Contact</th><th class="num">Total Paid</th><th class="num">Open POs</th><th></th></tr></thead>
            <tbody>
              <template v-for="v in filteredRows" :key="v.id">
                <tr class="clickable" @click="toggleExpand(v)">
                  <td><i class="fas" :class="expanded === v.id ? 'fa-chevron-down' : 'fa-chevron-right'" style="font-size:10px;color:var(--crm-text-dim)"></i></td>
                  <td>{{ v.name }}<div v-if="who(v.id)" class="who">{{ who(v.id) }}</div></td>
                  <td class="muted">{{ v.contact_email || v.contact_phone || '—' }}</td>
                  <td class="num" style="font-weight:700">{{ money(v.totalPaid) }}</td>
                  <td class="num" :style="v.openPOs ? 'color:var(--crm-warn)' : ''">{{ v.openPOs }}</td>
                  <td class="right" @click.stop>
                    <button class="btn-sm btn-hist" title="History — who changed this" aria-label="History" @click="openHistory('vendor', v.id, v.name)"><i class="fas fa-clock-rotate-left"></i></button>
                    <button class="btn-sm" @click="openEditVendor(v)">Edit</button>
                    <button class="btn-sm warn" @click="removeVendor(v)" style="margin-left:6px">Delete</button>
                  </td>
                </tr>
                <tr v-if="expanded === v.id">
                  <td colspan="6" class="detail-cell">
                    <div v-if="detailLoading" class="muted small">Loading…</div>
                    <div v-else-if="detail">
                      <div class="detail-section">
                        <div class="detail-hd">Purchase Orders</div>
                        <div v-if="detail.purchaseOrders.length" class="detail-list">
                          <div v-for="po in detail.purchaseOrders" :key="po.id" class="detail-row">
                            <span>{{ fmtDate(po.order_date) }}</span>
                            <span class="muted">{{ po.description || '—' }}</span>
                            <span class="num">{{ money(po.amount) }}<span v-if="po.fx && po.fx.original" class="orig" style="display:block">{{ formatOriginal(po.fx.currency, po.fx.original.amount) }}</span></span>
                            <span class="status-badge" :class="'st-' + po.status">{{ po.status }}</span>
                          </div>
                        </div>
                        <div v-else class="muted small">No purchase orders yet.</div>
                      </div>
                      <div class="detail-section">
                        <div class="detail-hd">Matched Expenses</div>
                        <div v-if="detail.expenses.length" class="detail-list">
                          <div v-for="e in detail.expenses" :key="e.id" class="detail-row">
                            <span>{{ fmtDate(e.expense_date) }}</span>
                            <span class="muted">{{ e.description || '—' }}</span>
                            <span class="num">{{ money(e.amount) }}</span>
                            <span></span>
                          </div>
                        </div>
                        <div v-else class="muted small">No matching expense rows (matched by vendor name).</div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <div v-else-if="!loading" class="empty">
            <i class="fas fa-truck-field"></i>
            <p>No vendors{{ q ? ' matching that search' : '' }} yet.</p>
          </div>
        </section>
      </div>
    </div>

    <!-- ═══ VENDOR MODAL ═══ -->
    <div v-if="vendorModalOpen" class="modal-bg" @click.self="vendorModalOpen = false">
      <div class="modal" style="width:440px">
        <h3>{{ editingVendorId ? 'Edit Vendor' : 'New Vendor' }}</h3>
        <div class="fg"><label>Name *</label><input v-model="vendorForm.name" class="finp" style="width:100%" /></div>
        <div class="modal-grid">
          <div class="fg"><label>Contact Email</label><input v-model="vendorForm.contactEmail" class="finp" style="width:100%" /></div>
          <div class="fg"><label>Contact Phone</label><input v-model="vendorForm.contactPhone" class="finp" style="width:100%" /></div>
        </div>
        <div class="fg"><label>Notes</label><input v-model="vendorForm.notes" class="finp" style="width:100%" /></div>
        <p v-if="vendorFormError" class="err-text">{{ vendorFormError }}</p>
        <div class="modal-actions">
          <button class="btn-sm primary" @click="saveVendor">{{ editingVendorId ? 'Save Changes' : 'Create Vendor' }}</button>
          <button class="btn-sm" @click="vendorModalOpen = false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ═══ PO MODAL ═══ -->
    <div v-if="poModalOpen" class="modal-bg" @click.self="poModalOpen = false">
      <div class="modal" style="width:480px">
        <h3>New Purchase Order</h3>
        <div class="fg"><label>Vendor *</label>
          <select v-model="poForm.vendorId" class="finp" style="width:100%">
            <option value="" disabled>Select a vendor…</option>
            <option v-for="v in rows" :key="v.id" :value="v.id">{{ v.name }}</option>
          </select>
        </div>
        <div class="fg"><label>Description</label><input v-model="poForm.description" class="finp" style="width:100%" /></div>
        <div class="fg"><label>Amount *</label><MoneyInput v-model="poForm.amount" v-model:currency="poForm.currency" v-model:fxRate="poForm.fxRate" v-model:fxManual="poForm.fxManual" /></div>
        <div class="fg"><label>Status</label>
          <select v-model="poForm.status" class="finp" style="width:100%">
            <option value="ordered">Ordered</option><option value="received">Received</option>
            <option value="partial">Partial</option><option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div class="modal-grid">
          <div class="fg"><label>Order Date</label><input v-model="poForm.orderDate" type="date" class="finp" style="width:100%" /></div>
          <div class="fg"><label>Expected Date</label><input v-model="poForm.expectedDate" type="date" class="finp" style="width:100%" /></div>
        </div>
        <p v-if="poFormError" class="err-text">{{ poFormError }}</p>
        <div class="modal-actions">
          <button class="btn-sm primary" @click="savePO">Create PO</button>
          <button class="btn-sm" @click="poModalOpen = false">Cancel</button>
        </div>
      </div>
    </div>
    <HistoryModal v-if="historyFor" :entity-type="historyFor.type" :entity-id="historyFor.id" :title="historyFor.title" admin @close="historyFor = null" />
  </div>
</template>

<script setup>
import { useCrmThemeStore } from '@/stores/crmThemeStore'
import { useInboxUnread } from '@/composables/useInboxUnread'
import CrmUserChip from '@/components/crm/CrmUserChip.vue'
import CrmTeamLink from '@/components/crm/CrmTeamLink.vue'
import CrmBroadcastLink from '@/components/crm/CrmBroadcastLink.vue'

const crmTheme = useCrmThemeStore()
const { unreadCount } = useInboxUnread()
import { ref, reactive, computed, onMounted } from 'vue'
import { useAdminAuthStore } from '@/stores/adminAuthStore'
import { employeeNameHeader } from '@/services/crmActivity'
import MoneyInput from '@/components/crm/MoneyInput.vue'
import HistoryModal from '@/components/crm/HistoryModal.vue'
import { formatOriginal } from '@/composables/useFx'
import { useCrmUser } from '@/composables/useCrmUser'
import { useAttribution } from '@/composables/useAttribution'

const { isEmployeeOnly } = useCrmUser()
const historyFor = ref(null)
const attribution = useAttribution('vendor')
const who = attribution.text
function openHistory(type, id, title) { historyFor.value = { type, id, title } }

const adminAuth = useAdminAuthStore()
const adminPassword = ref('')
const showAdminPassword = ref(false)
const adminError = ref('')
const loading = ref(false)

const api = (path, opts = {}) =>
  adminAuth.authedFetch(`/api/crm/vendors${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...employeeNameHeader(), ...(opts.headers || {}) }
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
    return j
  })

const rows = ref([])
const q = ref('')
const totalPaid = computed(() => rows.value.reduce((a, r) => a + r.totalPaid, 0))
const openPOs = computed(() => rows.value.reduce((a, r) => a + r.openPOs, 0))
const filteredRows = computed(() => {
  if (!q.value.trim()) return rows.value
  const t = q.value.trim().toLowerCase()
  return rows.value.filter((r) => r.name.toLowerCase().includes(t))
})

function money(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—' }

async function loadAll() {
  loading.value = true
  try { const { rows: r } = await api('/'); rows.value = r; attribution.load(r.map((x) => x.id)) } catch (e) { console.error('[crm-vendors] load', e) } finally { loading.value = false }
}

async function exportFile(kind) {
  try {
    const res = await adminAuth.authedFetch(`/api/crm/vendors/export/${kind}?theme=${crmTheme.theme === 'pro' ? 'dark' : 'light'}`)
    if (!res.ok) throw new Error('Export failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const cd = res.headers.get('Content-Disposition') || ''
    const m = cd.match(/filename="([^"]+)"/)
    a.href = url
    a.download = m ? m[1] : `vendors.${kind === 'excel' ? 'xlsx' : 'pdf'}`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  } catch (e) { alert(e.message || 'Export failed') }
}

// ── expand/detail ──
const expanded = ref(null)
const detail = ref(null)
const detailLoading = ref(false)
async function toggleExpand(v) {
  if (expanded.value === v.id) { expanded.value = null; return }
  expanded.value = v.id
  detail.value = null
  detailLoading.value = true
  try { detail.value = await api(`/${v.id}`) } catch (e) { console.error(e) } finally { detailLoading.value = false }
}

// ── vendor modal ──
const vendorModalOpen = ref(false)
const editingVendorId = ref(null)
const vendorFormError = ref('')
const vendorForm = reactive({ name: '', contactEmail: '', contactPhone: '', notes: '' })
function openNewVendor() {
  Object.assign(vendorForm, { name: '', contactEmail: '', contactPhone: '', notes: '' })
  editingVendorId.value = null; vendorFormError.value = ''; vendorModalOpen.value = true
}
function openEditVendor(v) {
  Object.assign(vendorForm, { name: v.name, contactEmail: v.contact_email || '', contactPhone: v.contact_phone || '', notes: v.notes || '' })
  editingVendorId.value = v.id; vendorFormError.value = ''; vendorModalOpen.value = true
}
async function saveVendor() {
  vendorFormError.value = ''
  if (!vendorForm.name.trim()) { vendorFormError.value = 'Vendor name is required.'; return }
  try {
    const body = JSON.stringify(vendorForm)
    if (editingVendorId.value) await api(`/${editingVendorId.value}`, { method: 'PATCH', body })
    else await api('/', { method: 'POST', body })
    vendorModalOpen.value = false
    await loadAll()
  } catch (e) { vendorFormError.value = e.message || 'Could not save vendor' }
}
async function removeVendor(v) {
  if (!confirm(`Delete "${v.name}"? This can't be undone.`)) return
  try { await api(`/${v.id}`, { method: 'DELETE' }); await loadAll() } catch (e) { alert(e.message || 'Could not delete') }
}

// ── PO modal ──
const poModalOpen = ref(false)
const poFormError = ref('')
const poForm = reactive({ vendorId: '', description: '', amount: null, status: 'ordered', orderDate: new Date().toISOString().slice(0, 10), expectedDate: '', currency: 'USD', fxRate: null, fxManual: false })
function openNewPO() {
  Object.assign(poForm, { vendorId: '', description: '', amount: null, status: 'ordered', orderDate: new Date().toISOString().slice(0, 10), expectedDate: '', currency: 'USD', fxRate: null, fxManual: false })
  poFormError.value = ''; poModalOpen.value = true
}
async function savePO() {
  poFormError.value = ''
  if (!poForm.vendorId) { poFormError.value = 'A vendor is required.'; return }
  if (!(Number(poForm.amount) >= 0)) { poFormError.value = 'A valid amount is required.'; return }
  try {
    await api('/purchase-orders', { method: 'POST', body: JSON.stringify(poForm) })
    poModalOpen.value = false
    await loadAll()
    if (expanded.value === poForm.vendorId) await toggleExpand({ id: poForm.vendorId })
  } catch (e) { poFormError.value = e.message || 'Could not save purchase order' }
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
.crm-nav { display: flex; gap: 4px; flex-wrap: wrap; }
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

.card { background: var(--crm-panel-bg); border: 1px solid var(--crm-border); border-radius: 12px; padding: 18px 20px; }
.filter-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.finp { background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 7px; padding: 7px 10px; font: inherit; font-size: 12.5px; }
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
.tbl tr.clickable { cursor: pointer; }
.tbl tr.clickable:hover { background: #101014; }
.status-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 8px; border-radius: 4px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); }
.status-badge.st-ordered { background: var(--crm-badge-bg); color: var(--crm-info); }
.status-badge.st-received { background: var(--crm-success-bg); color: var(--crm-success); }
.status-badge.st-partial { background: var(--crm-warn-bg); color: var(--crm-warn); }
.status-badge.st-cancelled { background: var(--crm-danger-bg); color: var(--crm-danger); }

.detail-cell { background: var(--crm-bg-deep); padding: 14px 18px; }
.detail-section { margin-bottom: 12px; }
.detail-section:last-child { margin-bottom: 0; }
.detail-hd { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--crm-text-dim); font-weight: 700; margin-bottom: 6px; }
.detail-list { display: flex; flex-direction: column; gap: 4px; }
.detail-row { display: grid; grid-template-columns: 90px 1fr 90px 90px; gap: 8px; font-size: 12px; padding: 4px 0; align-items: center; }
.detail-row .num { text-align: right; }

.empty { padding: 30px 10px; text-align: center; color: var(--crm-text-faint); }
.empty i { font-size: 22px; opacity: .5; }
.empty p { margin: 8px 0 0; font-size: 12.5px; color: var(--crm-text-muted); }

.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.modal { background: var(--crm-header-bg); border: 1px solid var(--crm-border-header); border-radius: 14px; padding: 26px 28px; width: 480px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
.modal h3 { font-family: 'Syne', sans-serif; font-size: 18px; margin-bottom: 18px; }
.modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fg { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.fg label { font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--crm-text-muted); }
.modal-actions { display: flex; gap: 10px; margin-top: 16px; }
.orig { font-size: 10.5px; font-weight: 500; color: var(--crm-text-muted); margin-top: 2px; }
.who { font-size: 10.5px; color: var(--crm-text-dim); margin-top: 3px; font-weight: 500; }
.btn-hist { padding: 7px 9px; margin-right: 6px; }
</style>
