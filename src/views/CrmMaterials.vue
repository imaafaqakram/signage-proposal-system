<template>
  <div class="crm">
    <header class="crm-top">
      <div class="crm-brand"><span class="dot"></span> Luminus CRM</div>
      <nav class="crm-nav">
        <router-link :to="{ name: 'crm' }">Inbox</router-link>
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
        <span>{{ summary.itemCount }} items</span>
        <span :style="summary.lowStockCount ? 'color:var(--crm-danger)' : ''">{{ summary.lowStockCount }} low stock</span>
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
          <h2>Materials</h2>
          <p>Inventory levels and stock value — admin password required.</p>
          <form class="gate-form" @submit.prevent="unlockAdmin">
            <input v-model="adminPassword" :type="showAdminPassword ? 'text' : 'password'" placeholder="Admin password" />
            <button type="button" class="pw-toggle" @click="showAdminPassword = !showAdminPassword" tabindex="-1"><i class="fas" :class="showAdminPassword ? 'fa-eye-slash' : 'fa-eye'"></i></button>
            <button type="submit" :disabled="adminAuth.loading">Unlock</button>
          </form>
          <p v-if="adminError" class="err-text">{{ adminError }}</p>
        </div>
      </div>

      <!-- ═══ MATERIALS ═══ -->
      <div v-else class="wrap">
        <div class="stat-row">
          <div class="stat-box"><div class="lbl">Items</div><div class="val" style="color:var(--crm-accent)">{{ summary.itemCount }}</div></div>
          <div class="stat-box"><div class="lbl">Low Stock</div><div class="val" :style="summary.lowStockCount ? 'color:var(--crm-danger)' : ''">{{ summary.lowStockCount }}</div></div>
          <div class="stat-box"><div class="lbl">Inventory Value</div><div class="val" style="color:var(--crm-success)">{{ money(summary.totalValue) }}</div></div>
        </div>

        <section class="card">
          <div class="filter-bar">
            <label class="chk"><input type="checkbox" v-model="lowStockOnly" @change="loadAll" /> Low stock only</label>
            <input v-model="q" placeholder="Search materials…" class="finp" style="flex:1;min-width:160px" />
            <button class="btn-sm" @click="exportFile('pdf')">⬇ PDF</button>
            <button class="btn-sm" @click="exportFile('excel')">⬇ Excel</button>
            <button class="btn-sm primary" @click="openNew">+ New Material</button>
          </div>

          <table class="tbl" v-if="filteredRows.length">
            <thead><tr><th>Name</th><th>Category</th><th>Unit</th><th class="num">Qty</th><th class="num">Reorder At</th><th class="num">Unit Cost</th><th class="num">Value</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in filteredRows" :key="r.id" :class="{ 'low-row': isLow(r) }">
                <td>{{ r.name }}</td>
                <td class="muted">{{ catLabel(r.category) }}</td>
                <td class="muted">{{ r.unit }}</td>
                <td class="num" :style="isLow(r) ? 'color:var(--crm-danger);font-weight:700' : ''">{{ num(r.quantity_on_hand) }}</td>
                <td class="num muted">{{ num(r.reorder_threshold) }}</td>
                <td class="num muted">{{ money(r.unit_cost) }}</td>
                <td class="num" style="font-weight:700">{{ money(r.quantity_on_hand * r.unit_cost) }}</td>
                <td class="right">
                  <button class="btn-sm" @click="openAdjust(r)">Adjust</button>
                  <button class="btn-sm" @click="openEdit(r)" style="margin-left:6px">Edit</button>
                  <button class="btn-sm warn" @click="removeMaterial(r)" style="margin-left:6px">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="!loading" class="empty">
            <i class="fas fa-boxes-stacked"></i>
            <p>No materials{{ q ? ' matching that search' : '' }} yet.</p>
          </div>
        </section>
      </div>
    </div>

    <!-- ═══ MATERIAL MODAL ═══ -->
    <div v-if="modalOpen" class="modal-bg" @click.self="closeModal">
      <div class="modal">
        <h3>{{ editingId ? 'Edit Material' : 'New Material' }}</h3>
        <div class="fg"><label>Name *</label><input v-model="form.name" class="finp" style="width:100%" /></div>
        <div class="modal-grid">
          <div class="fg"><label>Category *</label>
            <select v-model="form.category" class="finp" style="width:100%">
              <option v-for="c in CATEGORIES" :key="c" :value="c">{{ catLabel(c) }}</option>
            </select>
          </div>
          <div class="fg"><label>Unit</label><input v-model="form.unit" placeholder="sheet, roll, ft, each…" class="finp" style="width:100%" /></div>
        </div>
        <div class="modal-grid">
          <div class="fg"><label>Unit Cost</label><input v-model.number="form.unitCost" type="number" step="0.01" class="finp" style="width:100%" /></div>
          <div class="fg"><label>Reorder Threshold</label><input v-model.number="form.reorderThreshold" type="number" step="1" class="finp" style="width:100%" /></div>
        </div>
        <div v-if="!editingId" class="fg"><label>Starting Quantity</label><input v-model.number="form.quantityOnHand" type="number" step="1" class="finp" style="width:100%" /></div>
        <div class="fg"><label>Notes</label><input v-model="form.notes" class="finp" style="width:100%" /></div>
        <p v-if="formError" class="err-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn-sm primary" @click="saveMaterial">{{ editingId ? 'Save Changes' : 'Create Material' }}</button>
          <button class="btn-sm" @click="closeModal">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ═══ ADJUST STOCK MODAL ═══ -->
    <div v-if="adjustOpen" class="modal-bg" @click.self="adjustOpen = false">
      <div class="modal" style="width:400px">
        <h3>Adjust Stock — {{ adjustTarget?.name }}</h3>
        <p class="muted" style="font-size:12px;margin-bottom:14px">Currently {{ num(adjustTarget?.quantity_on_hand) }} {{ adjustTarget?.unit }} on hand.</p>
        <div class="modal-grid">
          <div class="fg"><label>Change (+/-)</label><input v-model.number="adjustForm.delta" type="number" step="1" class="finp" style="width:100%" /></div>
          <div class="fg"><label>Reason</label>
            <select v-model="adjustForm.reason" class="finp" style="width:100%">
              <option value="purchase">Purchase (stock in)</option>
              <option value="used_on_order">Used on an order</option>
              <option value="adjustment">Manual adjustment</option>
              <option value="waste">Waste / damage</option>
            </select>
          </div>
        </div>
        <div class="fg"><label>Note</label><input v-model="adjustForm.note" class="finp" style="width:100%" /></div>
        <p v-if="adjustError" class="err-text">{{ adjustError }}</p>
        <div class="modal-actions">
          <button class="btn-sm primary" @click="submitAdjust">Save Adjustment</button>
          <button class="btn-sm" @click="adjustOpen = false">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useCrmThemeStore } from '@/stores/crmThemeStore'

const crmTheme = useCrmThemeStore()
import { ref, reactive, computed, onMounted } from 'vue'
import { useAdminAuthStore } from '@/stores/adminAuthStore'
import { employeeNameHeader } from '@/services/crmActivity'

const adminAuth = useAdminAuthStore()
const adminPassword = ref('')
const showAdminPassword = ref(false)
const adminError = ref('')
const loading = ref(false)

const CATEGORIES = ['acrylic', 'led', 'vinyl', 'hardware', 'metal', 'other']
const CAT_LABELS = { acrylic: 'Acrylic', led: 'LED', vinyl: 'Vinyl', hardware: 'Hardware', metal: 'Metal', other: 'Other' }
function catLabel(c) { return CAT_LABELS[c] || c }

const api = (path, opts = {}) =>
  adminAuth.authedFetch(`/api/crm/materials${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...employeeNameHeader(), ...(opts.headers || {}) }
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
    return j
  })

const rows = ref([])
const summary = ref({ itemCount: 0, lowStockCount: 0, totalValue: 0 })
const q = ref('')
const lowStockOnly = ref(false)

const filteredRows = computed(() => {
  if (!q.value.trim()) return rows.value
  const t = q.value.trim().toLowerCase()
  return rows.value.filter((r) => r.name.toLowerCase().includes(t))
})

function money(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function num(n) { return Number(n || 0).toLocaleString() }
function isLow(r) { return Number(r.quantity_on_hand) <= Number(r.reorder_threshold) }

async function loadRows() {
  loading.value = true
  try {
    const { rows: r } = await api(`/${lowStockOnly.value ? '?lowStock=true' : ''}`)
    rows.value = r
  } catch (e) { console.error('[crm-materials] load', e) } finally { loading.value = false }
}
async function loadSummary() {
  try { summary.value = await api('/summary') } catch (e) { console.error(e) }
}
async function loadAll() { await Promise.all([loadSummary(), loadRows()]) }

async function exportFile(kind) {
  try {
    const suffix = lowStockOnly.value ? '?lowStock=true&' : '?'
    const res = await adminAuth.authedFetch(`/api/crm/materials/export/${kind}${suffix}theme=${crmTheme.theme === 'pro' ? 'dark' : 'light'}`)
    if (!res.ok) throw new Error('Export failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const cd = res.headers.get('Content-Disposition') || ''
    const m = cd.match(/filename="([^"]+)"/)
    a.href = url
    a.download = m ? m[1] : `materials.${kind === 'excel' ? 'xlsx' : 'pdf'}`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  } catch (e) { alert(e.message || 'Export failed') }
}

// ── material modal ──
const modalOpen = ref(false)
const editingId = ref(null)
const formError = ref('')
const form = reactive({ name: '', category: 'acrylic', unit: 'each', unitCost: 0, reorderThreshold: 0, quantityOnHand: 0, notes: '' })

function resetForm() {
  Object.assign(form, { name: '', category: 'acrylic', unit: 'each', unitCost: 0, reorderThreshold: 0, quantityOnHand: 0, notes: '' })
  formError.value = ''
}
function openNew() { resetForm(); editingId.value = null; modalOpen.value = true }
function openEdit(r) {
  resetForm()
  editingId.value = r.id
  Object.assign(form, { name: r.name, category: r.category, unit: r.unit, unitCost: Number(r.unit_cost), reorderThreshold: Number(r.reorder_threshold), notes: r.notes || '' })
  modalOpen.value = true
}
function closeModal() { modalOpen.value = false }

async function saveMaterial() {
  formError.value = ''
  if (!form.name.trim()) { formError.value = 'Name is required.'; return }
  try {
    const body = JSON.stringify(form)
    if (editingId.value) await api(`/${editingId.value}`, { method: 'PATCH', body })
    else await api('/', { method: 'POST', body })
    modalOpen.value = false
    await loadAll()
  } catch (e) { formError.value = e.message || 'Could not save material' }
}

async function removeMaterial(r) {
  if (!confirm(`Delete "${r.name}"? This can't be undone.`)) return
  try {
    await api(`/${r.id}`, { method: 'DELETE' })
    await loadAll()
  } catch (e) { alert(e.message || 'Could not delete') }
}

// ── adjust stock modal ──
const adjustOpen = ref(false)
const adjustTarget = ref(null)
const adjustError = ref('')
const adjustForm = reactive({ delta: 0, reason: 'purchase', note: '' })
function openAdjust(r) {
  adjustTarget.value = r
  Object.assign(adjustForm, { delta: 0, reason: 'purchase', note: '' })
  adjustError.value = ''
  adjustOpen.value = true
}
async function submitAdjust() {
  adjustError.value = ''
  if (!Number(adjustForm.delta)) { adjustError.value = 'Enter a non-zero amount.'; return }
  try {
    await api(`/${adjustTarget.value.id}/adjust`, { method: 'POST', body: JSON.stringify(adjustForm) })
    adjustOpen.value = false
    await loadAll()
  } catch (e) { adjustError.value = e.message || 'Could not save adjustment' }
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
.chk { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--crm-text-soft); }
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
.tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
.tbl .right { text-align: right; white-space: nowrap; }
.tbl tr.low-row { background: rgba(240, 115, 106, .06); }

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
</style>
