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
      <div class="crm-counts">
        <span v-if="summary.staleCount" class="cc-warn">{{ summary.staleCount }} gone quiet</span>
        <span>{{ summary.sentCount }} follow-ups sent</span>
        <span>{{ summary.dncCount }} do-not-contact</span>
        <span>{{ summary.candidateCount }} would be contacted</span>
      </div>
      <button class="crm-refresh" @click="loadAll" :disabled="loading" title="Refresh">
        <i class="fas" :class="loading ? 'fa-circle-notch fa-spin' : 'fa-rotate'"></i>
      </button>
    </header>

    <div class="crm-body">
      <div class="wrap">
        <!-- ============ Follow-up drip settings (admin-gated) ============ -->
        <section class="card">
          <div class="card-head">
            <h2><i class="fas fa-sliders"></i> Follow-up drip settings</h2>
            <span class="pill" :class="settings.followUpEnabled ? 'ok' : ''">
              {{ adminReady ? (settings.followUpEnabled ? 'ON' : 'OFF') : 'locked' }}
            </span>
          </div>

          <div v-if="!adminAuth.isAuthenticated" class="admin-gate">
            <i class="fas fa-lock"></i>
            <div>
              <p>This is the same cadence control as Admin → Follow-Up Automation — it decides who
                gets emailed and how often, so it stays behind the admin password.</p>
              <form class="gate-form" @submit.prevent="unlockAdmin">
                <input v-model="adminPassword" :type="showAdminPassword ? 'text' : 'password'" placeholder="Admin password" />
                <button type="button" class="pw-toggle" @click="showAdminPassword = !showAdminPassword" tabindex="-1"><i class="fas" :class="showAdminPassword ? 'fa-eye-slash' : 'fa-eye'"></i></button>
                <button type="submit" :disabled="adminAuth.loading">Unlock</button>
              </form>
              <p v-if="adminError" class="err-text">{{ adminError }}</p>
            </div>
          </div>

          <div v-else class="settings-grid">
            <label class="switch-row">
              <input type="checkbox" v-model="settings.followUpEnabled" />
              <span>Automated follow-ups enabled</span>
            </label>
            <div class="fld"><label>First follow-up after</label>
              <div class="fld-input"><input type="number" min="1" v-model.number="settings.followUpFirstDelayDays" /><span>days</span></div>
            </div>
            <div class="fld"><label>Then repeat every</label>
              <div class="fld-input">
                <input type="number" min="1" v-model.number="settings.followUpIntervalMinDays" /><span>–</span>
                <input type="number" min="1" v-model.number="settings.followUpIntervalMaxDays" /><span>days</span>
              </div>
            </div>
            <div class="fld"><label>Stop after</label>
              <div class="fld-input"><input type="number" min="1" v-model.number="settings.followUpMaxCount" /><span>sends, or</span></div>
            </div>
            <div class="fld"><label>&nbsp;</label>
              <div class="fld-input"><input type="number" min="1" v-model.number="settings.followUpMaxDurationDays" /><span>days, whichever first</span></div>
            </div>
            <div class="save-row">
              <button class="btn primary" @click="saveSettings" :disabled="savingSettings">
                {{ savingSettings ? 'Saving…' : 'Save settings' }}
              </button>
              <span v-if="savedFlash" class="saved-flash"><i class="fas fa-check"></i> saved</span>
            </div>
          </div>

          <div class="note">
            <i class="fas fa-circle-info"></i>
            A lead is automatically taken off this list the moment it's dragged to <b>Won</b> or
            <b>Lost</b> on the Pipeline board — no one keeps getting nudged after the deal is decided.
          </div>
        </section>

        <!-- ============ Gone quiet — needs a human decision ============ -->
        <section class="card">
          <div class="card-head">
            <h2><i class="fas fa-comment-slash"></i> Needs a Decision — Gone Quiet</h2>
            <span class="count">{{ staleTotal }}</span>
          </div>
          <p class="sub">A lead replied, then nothing — from either side — for 3 days. Nothing here
            happens automatically; you decide per lead whether to follow up or leave it.</p>

          <div class="dnc-search">
            <input v-model="staleQuery" @input="onStaleSearch" placeholder="Filter by name or email…" />
          </div>

          <table class="tbl" v-if="staleRows.length">
            <thead><tr><th>Client</th><th>Email</th><th>Quiet for</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in staleRows" :key="r.leadId">
                <td>{{ r.clientName || '—' }}</td>
                <td class="muted">{{ r.contactEmail || '—' }}</td>
                <td class="muted small">{{ r.daysSince }} day{{ r.daysSince === 1 ? '' : 's' }}</td>
                <td class="right">
                  <router-link v-if="r.threadId" :to="{ name: 'crm', query: { thread: r.threadId } }" class="btn-sm">Open Thread</router-link>
                  <button
                    class="btn-sm"
                    style="margin-left:6px"
                    :disabled="sendingStale.has(r.leadId) || sentStale.has(r.leadId)"
                    @click="sendFollowup(r.leadId)"
                  >{{ sentStale.has(r.leadId) ? 'Sent ✓' : sendingStale.has(r.leadId) ? 'Sending…' : 'Send Follow-up' }}</button>
                  <button class="btn-sm" @click="dismissStale(r.leadId)" style="margin-left:6px">Dismiss</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="!loading" class="empty">
            <i class="fas fa-circle-check"></i>
            <p>Nobody's gone quiet{{ staleQuery ? ' matching that search' : '' }} right now.</p>
          </div>
          <div v-if="staleRows.length < staleTotal" class="more-row">
            <button class="btn-sm" @click="loadMoreStale">Load more ({{ staleTotal - staleRows.length }} left)</button>
          </div>
        </section>

        <!-- ============ Who actually got a follow-up email ============ -->
        <section class="card">
          <div class="card-head">
            <h2><i class="fas fa-paper-plane"></i> Follow-ups sent</h2>
            <span class="count">{{ sentTotal }}</span>
          </div>
          <p class="sub">Every lead that has actually received at least one follow-up email, most
            recent first. Pulled straight from <b>our leads table</b> — this can never include
            anything from the Airtable Projects mirror on the Projects tab, since that data has no
            follow-up columns at all.</p>

          <div class="dnc-search">
            <input v-model="sentQuery" @input="onSentSearch" placeholder="Filter by name or email…" />
          </div>

          <table class="tbl" v-if="sentRows.length">
            <thead><tr><th>Client</th><th>Email</th><th>Sends</th><th>Last sent</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in sentRows" :key="r.id">
                <td>{{ r.client_name || '—' }}</td>
                <td class="muted">{{ r.contact_email || '—' }}</td>
                <td>{{ r.follow_up_count }}</td>
                <td class="muted small">{{ fmtDate(r.follow_up_last_sent_at) }}</td>
                <td class="right">
                  <button v-if="r.follow_up_stopped_at" class="btn-sm" disabled>stopped</button>
                  <button v-else class="btn-sm warn" @click="stopFromSent(r.id)">Stop follow-ups</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="!loading" class="empty">
            <i class="fas fa-circle-info"></i>
            <p>No lead has been sent a follow-up email yet{{ sentQuery ? ' matching that search' : '' }}.</p>
          </div>
          <div v-if="sentRows.length < sentTotal" class="more-row">
            <button class="btn-sm" @click="loadMoreSent">Load more ({{ sentTotal - sentRows.length }} left)</button>
          </div>
        </section>

        <!-- ============ Do-not-contact list ============ -->
        <section class="card">
          <div class="card-head">
            <h2><i class="fas fa-bell-slash"></i> Do-Not-Contact list</h2>
            <span class="count">{{ dncTotal }}</span>
          </div>
          <p class="sub">Leads excluded from the follow-up drip — stopped by hand here, from the
            Proposal System's 🔕 button, or automatically on Won/Lost.</p>

          <div class="add-row">
            <div class="search-box">
              <i class="fas fa-magnifying-glass"></i>
              <input v-model="addQuery" @input="onAddSearch" placeholder="Search a name or email to add…" />
            </div>
            <ul v-if="addResults.length" class="add-results">
              <li v-for="r in addResults" :key="r.id">
                <span class="ar-name">{{ r.client_name || '—' }}</span>
                <span class="ar-email">{{ r.contact_email }}</span>
                <button v-if="r.follow_up_stopped_at" class="btn-sm" disabled>already stopped</button>
                <button v-else class="btn-sm warn" @click="stopLead(r.id)">Stop follow-ups</button>
              </li>
            </ul>
          </div>

          <div class="dnc-search">
            <input v-model="dncQuery" @input="onDncSearch" placeholder="Filter this list…" />
          </div>

          <table class="tbl" v-if="dncRows.length">
            <thead><tr><th>Client</th><th>Email</th><th>Stopped</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in dncRows" :key="r.id">
                <td>{{ r.client_name || '—' }}</td>
                <td class="muted">{{ r.contact_email || '—' }}</td>
                <td class="muted small">{{ fmtDate(r.follow_up_stopped_at) }}</td>
                <td class="right"><button class="btn-sm" @click="resumeLead(r.id)">Resume</button></td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="!loading" class="empty">
            <i class="fas fa-circle-check"></i>
            <p>Nobody is on the Do-Not-Contact list{{ dncQuery ? ' matching that search' : '' }}.</p>
          </div>
          <div v-if="dncRows.length < dncTotal" class="more-row">
            <button class="btn-sm" @click="loadMoreDnc">Load more ({{ dncTotal - dncRows.length }} left)</button>
          </div>
        </section>

        <!-- ============ Team Activity (admin-gated, name-tag only) ============ -->
        <section class="card">
          <div class="card-head">
            <h2><i class="fas fa-user-clock"></i> Team Activity</h2>
            <span class="count" v-if="adminAuth.isAuthenticated">{{ teamActivity.length }}</span>
          </div>

          <div v-if="!adminAuth.isAuthenticated" class="admin-gate">
            <i class="fas fa-lock"></i>
            <p>Unlock the drip settings card above with the admin password to see this — it's the
              same admin session for the whole page.</p>
          </div>
          <template v-else>
            <p class="sub">Actions across Orders, Expenses, Materials, Vendors, and stale-lead
              dismissals, tagged with whatever name someone entered at login (optional — an honor-system
              label, not a real account). Last {{ teamActivityDays }} days.</p>
            <table class="tbl" v-if="teamActivity.length">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                <tr v-for="(a, i) in teamActivity" :key="i">
                  <td class="muted small">{{ fmtDate(a.created_at) }}</td>
                  <td>{{ a.employee_name || '—' }}</td>
                  <td class="muted">{{ a.action }}</td>
                  <td class="muted small">{{ a.entity_type }}<span v-if="a.entity_id"> #{{ String(a.entity_id).slice(0, 8) }}</span></td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty">
              <i class="fas fa-circle-info"></i>
              <p>No tagged activity yet in the last {{ teamActivityDays }} days.</p>
            </div>
          </template>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useCrmThemeStore } from '@/stores/crmThemeStore'
import { useInboxUnread } from '@/composables/useInboxUnread'

const crmTheme = useCrmThemeStore()
const { unreadCount } = useInboxUnread()
import { ref, reactive, onMounted } from 'vue'
import { useAdminAuthStore } from '@/stores/adminAuthStore'
import { employeeNameHeader } from '@/services/crmActivity'

const adminAuth = useAdminAuthStore()
const adminPassword = ref('')
const showAdminPassword = ref(false)
const adminError = ref('')
const adminReady = ref(false)

const token = () => sessionStorage.getItem('admin_bypass_token') || ''
const api = (path, opts = {}) =>
  fetch(`/api/crm/automation${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...employeeNameHeader(), ...(opts.headers || {}) }
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
    return j
  })

const loading = ref(false)
const summary = ref({ dncCount: 0, candidateCount: 0, sentCount: 0, staleCount: 0 })
const settings = reactive({
  followUpEnabled: false, followUpFirstDelayDays: 7, followUpIntervalMinDays: 3,
  followUpIntervalMaxDays: 4, followUpMaxDurationDays: 120, followUpMaxCount: 30
})
const savingSettings = ref(false)
const savedFlash = ref(false)

const dncRows = ref([])
const dncTotal = ref(0)
const dncQuery = ref('')
let dncOffset = 0
const LIMIT = 50

const addQuery = ref('')
const addResults = ref([])
let addTimer = null

const sentRows = ref([])
const sentTotal = ref(0)
const sentQuery = ref('')
let sentOffset = 0

const staleRows = ref([])
const staleTotal = ref(0)
const staleQuery = ref('')
let staleOffset = 0

const teamActivity = ref([])
const teamActivityDays = ref(30)
async function loadTeamActivity() {
  if (!adminAuth.isAuthenticated) return
  try {
    const res = await adminAuth.authedFetch(`/api/crm/automation/team-activity?days=${teamActivityDays.value}`)
    const j = await res.json().catch(() => ({}))
    teamActivity.value = j.rows || []
  } catch (e) { console.error('[crm-automation] team-activity', e) }
}

async function loadSummary() {
  try { summary.value = await api('/summary') } catch (e) { console.error(e) }
}

async function loadSettings() {
  try {
    const { settings: s } = await adminAuth.authedFetch('/api/admin/settings').then((r) => r.json())
    Object.assign(settings, {
      followUpEnabled: !!s.followUpEnabled,
      followUpFirstDelayDays: s.followUpFirstDelayDays ?? 7,
      followUpIntervalMinDays: s.followUpIntervalMinDays ?? 3,
      followUpIntervalMaxDays: s.followUpIntervalMaxDays ?? 4,
      followUpMaxDurationDays: s.followUpMaxDurationDays ?? 120,
      followUpMaxCount: s.followUpMaxCount ?? 30
    })
    adminReady.value = true
  } catch (e) {
    console.error('[crm-automation] loadSettings', e)
  }
}

async function unlockAdmin() {
  adminError.value = ''
  try {
    await adminAuth.login(adminPassword.value)
    adminPassword.value = ''
    await loadSettings()
    await loadTeamActivity()
  } catch (e) {
    adminError.value = e.message || 'Wrong password'
  }
}

async function saveSettings() {
  savingSettings.value = true
  try {
    const body = JSON.stringify({
      followUpEnabled: settings.followUpEnabled,
      followUpFirstDelayDays: settings.followUpFirstDelayDays,
      followUpIntervalMinDays: settings.followUpIntervalMinDays,
      followUpIntervalMaxDays: settings.followUpIntervalMaxDays,
      followUpMaxDurationDays: settings.followUpMaxDurationDays,
      followUpMaxCount: settings.followUpMaxCount
    })
    const res = await adminAuth.authedFetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'save failed')
    savedFlash.value = true
    setTimeout(() => (savedFlash.value = false), 2000)
  } catch (e) {
    alert(e.message || 'Could not save settings')
  } finally {
    savingSettings.value = false
  }
}

async function loadDnc(reset = true) {
  if (reset) { dncOffset = 0; dncRows.value = [] }
  loading.value = true
  try {
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(dncOffset) })
    if (dncQuery.value.trim()) params.set('q', dncQuery.value.trim())
    const { rows, total } = await api(`/dnc?${params}`)
    dncRows.value = reset ? rows : [...dncRows.value, ...rows]
    dncTotal.value = total
    dncOffset += rows.length
  } catch (e) {
    console.error('[crm-automation] loadDnc', e)
  } finally {
    loading.value = false
  }
}
function loadMoreDnc() { loadDnc(false) }
let dncTimer = null
function onDncSearch() {
  clearTimeout(dncTimer)
  dncTimer = setTimeout(() => loadDnc(true), 300)
}

async function loadSent(reset = true) {
  if (reset) { sentOffset = 0; sentRows.value = [] }
  loading.value = true
  try {
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(sentOffset) })
    if (sentQuery.value.trim()) params.set('q', sentQuery.value.trim())
    const { rows, total } = await api(`/sent?${params}`)
    sentRows.value = reset ? rows : [...sentRows.value, ...rows]
    sentTotal.value = total
    sentOffset += rows.length
  } catch (e) {
    console.error('[crm-automation] loadSent', e)
  } finally {
    loading.value = false
  }
}
function loadMoreSent() { loadSent(false) }
let sentTimer = null
function onSentSearch() {
  clearTimeout(sentTimer)
  sentTimer = setTimeout(() => loadSent(true), 300)
}
async function stopFromSent(id) {
  try {
    await api(`/${id}/stop`, { method: 'POST' })
    sentRows.value = sentRows.value.map((r) => (r.id === id ? { ...r, follow_up_stopped_at: new Date().toISOString() } : r))
    await loadDnc(true)
    await loadSummary()
  } catch (e) {
    alert(e.message || 'Could not stop follow-ups')
  }
}

async function loadStale(reset = true) {
  if (reset) { staleOffset = 0; staleRows.value = [] }
  loading.value = true
  try {
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(staleOffset) })
    if (staleQuery.value.trim()) params.set('q', staleQuery.value.trim())
    const { rows, total } = await api(`/stale-responded?${params}`)
    staleRows.value = reset ? rows : [...staleRows.value, ...rows]
    staleTotal.value = total
    staleOffset += rows.length
  } catch (e) {
    console.error('[crm-automation] loadStale', e)
  } finally {
    loading.value = false
  }
}
function loadMoreStale() { loadStale(false) }
let staleTimer = null
function onStaleSearch() {
  clearTimeout(staleTimer)
  staleTimer = setTimeout(() => loadStale(true), 300)
}
async function dismissStale(leadId) {
  try {
    await api(`/${leadId}/dismiss-stale`, { method: 'POST' })
    staleRows.value = staleRows.value.filter((r) => r.leadId !== leadId)
    staleTotal.value = Math.max(0, staleTotal.value - 1)
    await loadSummary()
  } catch (e) {
    alert(e.message || 'Could not dismiss')
  }
}

// Sets, not plain booleans keyed by id, so re-rendering the row list (e.g. after a
// search) doesn't need per-row state threaded through staleRows itself. Reassigned
// (not mutated in place) on every change since Vue's ref() reactivity doesn't track
// in-place Set mutations.
const sendingStale = ref(new Set())
const sentStale = ref(new Set())
async function sendFollowup(leadId) {
  if (sendingStale.value.has(leadId) || sentStale.value.has(leadId)) return
  sendingStale.value = new Set(sendingStale.value).add(leadId)
  try {
    await api(`/${leadId}/send-followup`, { method: 'POST' })
    sentStale.value = new Set(sentStale.value).add(leadId)
  } catch (e) {
    alert(e.message || 'Could not send the follow-up email')
  } finally {
    const next = new Set(sendingStale.value)
    next.delete(leadId)
    sendingStale.value = next
  }
}

function onAddSearch() {
  clearTimeout(addTimer)
  const q = addQuery.value.trim()
  if (q.length < 2) { addResults.value = []; return }
  addTimer = setTimeout(async () => {
    try { const { rows } = await api(`/search?q=${encodeURIComponent(q)}`); addResults.value = rows } catch (e) { console.error(e) }
  }, 300)
}

async function stopLead(id) {
  try {
    await api(`/${id}/stop`, { method: 'POST' })
    addResults.value = addResults.value.map((r) => (r.id === id ? { ...r, follow_up_stopped_at: new Date().toISOString() } : r))
    await loadDnc(true)
    await loadSummary()
  } catch (e) {
    alert(e.message || 'Could not stop follow-ups')
  }
}

async function resumeLead(id) {
  try {
    await api(`/${id}/resume`, { method: 'POST' })
    dncRows.value = dncRows.value.filter((r) => r.id !== id)
    dncTotal.value = Math.max(0, dncTotal.value - 1)
    await loadSummary()
  } catch (e) {
    alert(e.message || 'Could not resume follow-ups')
  }
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

async function loadAll() {
  await Promise.all([loadSummary(), loadStale(true), loadSent(true), loadDnc(true)])
}

onMounted(async () => {
  await adminAuth.initialize()
  if (adminAuth.isAuthenticated) {
    await loadSettings()
    await loadTeamActivity()
  }
  await loadAll()
})
</script>

<style scoped>
.crm { position: fixed; inset: 0; background: var(--crm-bg); color: var(--crm-text); display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.crm-top { display: flex; align-items: center; gap: 16px; padding: 12px 18px; border-bottom: 1px solid var(--crm-border-header); background: var(--crm-header-bg); flex: none; }
.crm-brand { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.crm-brand .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--crm-accent); box-shadow: 0 0 8px rgba(0, 243, 255, .7), 0 0 2px var(--crm-accent); }
.crm-nav { display: flex; gap: 4px; }
.crm-nav a { font-size: 12.5px; font-weight: 600; color: var(--crm-text-muted); text-decoration: none; padding: 5px 11px; border-radius: 6px; }
.crm-nav a:hover { color: var(--crm-text); background: var(--crm-hover-bg); }
.crm-theme-toggle { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; flex: none; }
.crm-theme-toggle:hover { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
.crm-nav a.router-link-exact-active { color: var(--crm-accent); background: var(--crm-accent-soft-bg); }
.crm-counts { display: flex; gap: 14px; font-size: 12.5px; color: var(--crm-text-muted); margin-left: auto; }
.cc-warn { color: var(--crm-warn); font-weight: 700; }
.crm-refresh { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; }
.crm-refresh:hover { background: var(--crm-hover-bg-strong); }
.crm-refresh:disabled { opacity: .5; cursor: default; }

.crm-body { flex: 1; overflow-y: auto; }
.wrap { max-width: 820px; margin: 0 auto; padding: 22px 18px 60px; display: flex; flex-direction: column; gap: 18px; }

.card { background: var(--crm-panel-bg); border: 1px solid var(--crm-border); border-radius: 12px; padding: 18px 20px; }
.card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.card-head h2 { margin: 0; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.card-head h2 i { color: var(--crm-accent); font-size: 13px; }
.sub { font-size: 12px; color: var(--crm-text-muted); margin: 4px 0 14px; }
.pill { margin-left: auto; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; padding: 3px 9px; border-radius: 20px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); }
.pill.ok { background: var(--crm-success-bg); color: var(--crm-success); }
.count { margin-left: auto; background: var(--crm-hover-bg); color: var(--crm-text-secondary); border-radius: 10px; padding: 1px 9px; font-size: 12px; }

.admin-gate { display: flex; gap: 12px; padding: 12px 4px 4px; color: var(--crm-text-secondary); font-size: 12.5px; line-height: 1.5; }
.admin-gate > i { font-size: 16px; color: var(--crm-warn); margin-top: 2px; }
.gate-form { display: flex; gap: 8px; margin-top: 10px; }
.gate-form input { background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 7px; padding: 7px 10px; font: inherit; font-size: 12.5px; width: 220px; }
.gate-form input:focus { outline: none; border-color: var(--crm-accent); }
.gate-form button { background: var(--crm-accent); color: var(--crm-accent-contrast); border: 0; font-weight: 700; font-size: 12px; padding: 7px 16px; border-radius: 7px; cursor: pointer; }
.pw-toggle { background: transparent !important; color: var(--crm-text-muted) !important; padding: 0 8px !important; font-weight: 400 !important; }
.pw-toggle:hover { color: var(--crm-text) !important; }
.err-text { color: var(--crm-danger); font-size: 11.5px; margin: 6px 0 0; }

.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; padding: 12px 2px 4px; }
.switch-row { grid-column: 1 / -1; display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: var(--crm-text); }
.switch-row input { width: 16px; height: 16px; accent-color: var(--crm-accent); }
.fld label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; margin-bottom: 5px; }
.fld-input { display: flex; align-items: center; gap: 7px; }
.fld-input input { width: 64px; background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 6px; padding: 6px 8px; font: inherit; font-size: 12.5px; }
.fld-input input:focus { outline: none; border-color: var(--crm-accent); }
.fld-input span { font-size: 11.5px; color: var(--crm-text-muted); white-space: nowrap; }
.save-row { grid-column: 1 / -1; display: flex; align-items: center; gap: 12px; margin-top: 4px; }
.btn.primary { background: var(--crm-accent); color: var(--crm-accent-contrast); border: 0; font-weight: 700; font-size: 12.5px; padding: 8px 18px; border-radius: 7px; cursor: pointer; }
.btn.primary:disabled { opacity: .55; cursor: default; }
.saved-flash { color: var(--crm-success); font-size: 12px; font-weight: 600; }

.note { display: flex; gap: 9px; align-items: flex-start; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--crm-border); font-size: 11.5px; color: var(--crm-text-muted); line-height: 1.6; }
.note i { color: var(--crm-accent); margin-top: 1.5px; }

.add-row { margin-bottom: 14px; }
.search-box { position: relative; }
.search-box i { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--crm-text-faint); font-size: 12px; }
.search-box input { width: 100%; background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 8px; padding: 9px 12px 9px 30px; font: inherit; font-size: 12.5px; }
.search-box input:focus { outline: none; border-color: var(--crm-accent); }
.add-results { list-style: none; margin: 8px 0 0; padding: 0; border: 1px solid var(--crm-border); border-radius: 8px; overflow: hidden; }
.add-results li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--crm-border); }
.add-results li:last-child { border-bottom: none; }
.ar-name { font-size: 12.5px; font-weight: 600; flex: none; width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ar-email { font-size: 11.5px; color: var(--crm-text-muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dnc-search { margin-bottom: 10px; }
.dnc-search input { width: 100%; background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 8px; padding: 8px 11px; font: inherit; font-size: 12.5px; }
.dnc-search input:focus { outline: none; border-color: var(--crm-accent); }

.tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tbl thead th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; padding: 7px 8px; border-bottom: 1px solid var(--crm-border); }
.tbl tbody td { padding: 9px 8px; border-bottom: 1px solid var(--crm-row-border); }
.tbl .muted { color: var(--crm-text-muted); }
.tbl .small { font-size: 11.5px; }
.tbl .right { text-align: right; }

.btn-sm { display: inline-block; background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); border-radius: 6px; font-size: 11.5px; font-weight: 600; padding: 5px 11px; cursor: pointer; text-decoration: none; }
.btn-sm:hover:not(:disabled) { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
.btn-sm:disabled { opacity: .5; cursor: default; }
.btn-sm.warn { border-color: var(--crm-warn-border); color: var(--crm-warn); }
.btn-sm.warn:hover { background: var(--crm-warn-bg); }

.empty { padding: 30px 10px; text-align: center; color: var(--crm-text-faint); }
.empty i { font-size: 22px; color: var(--crm-success); opacity: .8; }
.empty p { margin: 8px 0 0; font-size: 12.5px; color: var(--crm-text-muted); }
.more-row { text-align: center; padding-top: 12px; }
</style>
