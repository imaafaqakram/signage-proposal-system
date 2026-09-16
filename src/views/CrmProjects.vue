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
      <div class="crm-counts"><span>{{ total }} projects</span></div>
      <button class="crm-refresh" @click="load(true)" :disabled="loading" title="Refresh">
        <i class="fas" :class="loading ? 'fa-circle-notch fa-spin' : 'fa-rotate'"></i>
      </button>
    </header>

    <div class="sync-bar">
      <span class="sync-src">Airtable mirror · Brown / Black / Blue / White</span>
      <span class="sync-state" :class="{ err: sync && sync.ok === false }">
        <template v-if="syncing || (sync && !sync.finished_at && sync.started_at)">
          <i class="fas fa-circle-notch fa-spin"></i> syncing…
        </template>
        <template v-else-if="sync && sync.finished_at">
          <i class="fas" :class="sync.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'"></i>
          last sync {{ fmtAgo(sync.finished_at) }}<span v-if="sync.ok"> · {{ sync.scanned }} records</span>
          <span v-else> · {{ sync.error }}</span>
        </template>
        <template v-else>not synced yet</template>
      </span>
      <button class="sync-btn" @click="runSync(false)" :disabled="syncing">Sync now</button>
      <button class="sync-btn ghost" @click="runSync(true)" :disabled="syncing" title="Pull the full table, not just recent">Full sync</button>
    </div>

    <div class="crm-filterbar">
      <div class="stage-tabs">
        <button :class="{ active: !fBase }" @click="fBase = ''; load(true)">All bases</button>
        <button v-for="b in ['Brown','Black','Blue','White']" :key="b"
                :class="{ active: fBase === b }" @click="fBase = b; load(true)">{{ b }}</button>
      </div>
      <div class="filter-right">
        <select v-model="fStatus" @change="load(true)" class="sel">
          <option value="">Any status</option>
          <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
        </select>
        <div class="search-box">
          <i class="fas fa-magnifying-glass"></i>
          <input v-model="q" @keyup.enter="load(true)" placeholder="Name, email, brief…" />
        </div>
      </div>
    </div>

    <div class="crm-body">
      <div class="wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Client</th><th>Source</th><th>Status</th><th>Sign type</th>
              <th class="num">Price</th><th>Created</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" :class="{ active: detail && detail.id === r.id }" @click="open(r.id)">
              <td class="c-client">
                <div class="cc-name">{{ r.name || '—' }}</div>
                <div class="cc-email">{{ r.email || '' }}</div>
              </td>
              <td><span class="src-badge" :class="'src-' + r.base_alias.toLowerCase()">{{ r.base_alias }}</span></td>
              <td><span class="pill" :class="statusClass(r.status)">{{ r.status || '—' }}</span></td>
              <td class="small muted">{{ r.sign_type || '—' }}</td>
              <td class="num">{{ money(r.user_preferred_price || r.quote_value) }}</td>
              <td class="small muted">{{ fmtDate(r.airtable_created_at) }}</td>
              <td class="c-chev"><i class="fas fa-chevron-right"></i></td>
            </tr>
          </tbody>
        </table>
        <div v-if="loading" class="loading-row"><i class="fas fa-circle-notch fa-spin"></i> Loading…</div>
        <div v-else-if="!rows.length" class="crm-empty">
          <i class="fas fa-table-list"></i>
          <p>No projects yet.</p>
          <small>Hit “Sync now” to pull the last 14 days from Airtable, or “Full sync” for everything.</small>
        </div>
        <div v-else-if="rows.length < total" class="loading-row">
          <button class="more-btn" @click="load(false)">Load more ({{ total - rows.length }} left)</button>
        </div>
      </div>

      <transition name="slide">
        <aside class="drawer" v-if="detail" key="d">
          <div class="dw-head">
            <div class="dw-title">
              <h2>{{ detail.name || '—' }}</h2>
              <a v-if="detail.email" class="dw-mail" :href="'mailto:' + detail.email">{{ detail.email }}</a>
            </div>
            <button class="icon-btn" @click="detail = null"><i class="fas fa-xmark"></i></button>
          </div>
          <div class="dw-scroll">
            <div class="dw-grid">
              <div><label>Source</label><span>{{ detail.base_alias }}</span></div>
              <div><label>Status</label><span>{{ detail.status || '—' }}</span></div>
              <div><label>Call status</label><span>{{ detail.call_status || '—' }}</span></div>
              <div><label>Sign type</label><span>{{ detail.sign_type || '—' }}</span></div>
              <div><label>Phone</label><span>{{ detail.phone || '—' }}</span></div>
              <div><label>Lead source</label><span>{{ detail.lead_source || '—' }}</span></div>
              <div><label>Preferred price</label><span>{{ money(detail.user_preferred_price) }}</span></div>
              <div><label>Avg quote</label><span>{{ money(detail.quote_value) }}</span></div>
              <div><label>Discounted</label><span>{{ money(detail.discounted_value) }}</span></div>
              <div><label>Proposal sent</label><span>{{ detail.proposal_sent ? 'Yes' : 'No' }}</span></div>
              <div><label>Last email stage</label><span>{{ detail.last_email_stage || '—' }}</span></div>
              <div><label>Follow-up status</label><span>{{ detail.followup_status || '—' }}</span></div>
              <div><label>Created</label><span>{{ fmtDate(detail.airtable_created_at) }}</span></div>
              <div><label>Modified</label><span>{{ fmtDate(detail.airtable_modified_at) }}</span></div>
            </div>

            <div class="dw-section" v-if="detail.details">
              <h3>Client brief</h3>
              <p class="brief">{{ detail.details }}</p>
            </div>

            <div class="dw-section" v-if="detail.proposal_link || detail.payment_link">
              <h3>Links</h3>
              <a v-if="detail.proposal_link" class="dw-applink" :href="fixUrl(detail.proposal_link)" target="_blank" rel="noopener">
                <i class="fas fa-arrow-up-right-from-square"></i> Proposal / product page
              </a>
              <a v-if="detail.payment_link" class="dw-applink" :href="fixUrl(detail.payment_link)" target="_blank" rel="noopener">
                <i class="fas fa-arrow-up-right-from-square"></i> Payment link
              </a>
            </div>

            <div class="dw-section" v-if="detail.mockup_url">
              <h3>Mockup</h3>
              <a :href="detail.mockup_url" target="_blank" rel="noopener"><img class="mockup" :src="detail.mockup_url" alt="mockup" /></a>
            </div>

            <p class="dw-foot">Airtable record <code>{{ detail.airtable_id }}</code> · synced {{ fmtAgo(detail.synced_at) }}</p>
          </div>
        </aside>
      </transition>
    </div>
  </div>
</template>

<script setup>
import { useCrmThemeStore } from '@/stores/crmThemeStore'
import { useInboxUnread } from '@/composables/useInboxUnread'

const crmTheme = useCrmThemeStore()
const { unreadCount } = useInboxUnread()
import { ref, computed, onMounted } from 'vue'

const token = () => sessionStorage.getItem('admin_bypass_token') || ''
const api = (path, opts = {}) =>
  fetch(`/api/crm/projects${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) }
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
    return j
  })

const rows = ref([])
const total = ref(0)
const loading = ref(false)
const detail = ref(null)
const sync = ref(null)
const syncing = ref(false)
const fBase = ref('')
const fStatus = ref('')
const q = ref('')
const summary = ref({ byStatus: {}, statusOrder: [] })
const LIMIT = 60
let offset = 0
let pollTimer = null

const statusOptions = computed(() => {
  const known = summary.value.statusOrder || []
  const seen = Object.keys(summary.value.byStatus || {}).filter((s) => s && s !== '—')
  return [...new Set([...known, ...seen])]
})

async function load(reset = false) {
  if (reset) { offset = 0; rows.value = [] }
  loading.value = true
  try {
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) })
    if (fBase.value) params.set('base', fBase.value)
    if (fStatus.value) params.set('status', fStatus.value)
    if (q.value.trim()) params.set('q', q.value.trim())
    const { rows: r, total: t } = await api(`/?${params}`)
    rows.value = offset === 0 ? r : [...rows.value, ...r]
    total.value = t
    offset += r.length
  } catch (e) {
    console.error('[crm-projects] load', e)
  } finally {
    loading.value = false
  }
}

async function loadSummary() {
  try {
    const s = await api('/summary')
    summary.value = s
    sync.value = s.sync
  } catch (e) {
    console.error('[crm-projects] summary', e)
  }
}

async function open(id) {
  try { detail.value = await api(`/${id}`) } catch (e) { console.error(e) }
}

async function runSync(full) {
  syncing.value = true
  try {
    await api(`/sync${full ? '?all=1' : ''}`, { method: 'POST' })
    pollSync()
  } catch (e) {
    syncing.value = false
    alert(e.message || 'Sync could not start')
  }
}

function pollSync() {
  clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    await loadSummary()
    if (sync.value && sync.value.finished_at && sync.value.started_at &&
        new Date(sync.value.finished_at) >= new Date(sync.value.started_at)) {
      clearInterval(pollTimer)
      syncing.value = false
      load(true)
    }
  }, 4000)
}

const money = (v) => (v == null || v === '' ? '—' : '$' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }))
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—')
function fmtAgo(v) {
  if (!v) return ''
  const s = (Date.now() - new Date(v).getTime()) / 1000
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 108000) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
const fixUrl = (u) => (u && /^https?:\/\//i.test(u) ? u : u ? 'https://' + u : '#')
function statusClass(s) {
  const t = (s || '').toLowerCase()
  if (t.includes('won')) return 'ok'
  if (t.includes('lost')) return 'bad'
  if (t.includes('progress') || t.includes('negotiat')) return 'warn'
  return ''
}

onMounted(() => { loadSummary(); load(true) })
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
.crm-refresh { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; }
.crm-refresh:hover { background: var(--crm-hover-bg-strong); }
.crm-refresh:disabled { opacity: .5; cursor: default; }

.sync-bar { display: flex; align-items: center; gap: 14px; padding: 8px 18px; background: var(--crm-panel-bg); border-bottom: 1px solid var(--crm-border); font-size: 12px; }
.sync-src { color: var(--crm-text-muted); }
.sync-state { color: var(--crm-text-secondary); display: flex; align-items: center; gap: 6px; }
.sync-state.err { color: var(--crm-danger); }
.sync-state .fa-circle-check { color: var(--crm-success); }
.sync-btn { margin-left: auto; background: var(--crm-accent); color: var(--crm-accent-contrast); border: 0; font-weight: 700; font-size: 12px; padding: 6px 13px; border-radius: 6px; cursor: pointer; box-shadow: 0 0 14px rgba(0, 243, 255, .2); }
.sync-btn.ghost { margin-left: 0; background: var(--crm-hover-bg); color: var(--crm-text-soft); border: 1px solid var(--crm-border-strong); box-shadow: none; }
.sync-btn:disabled { opacity: .5; cursor: default; box-shadow: none; }

.crm-filterbar { display: flex; align-items: center; gap: 14px; padding: 9px 16px; border-bottom: 1px solid var(--crm-border-header); background: var(--crm-panel-bg); flex-wrap: wrap; }
.stage-tabs { display: flex; gap: 3px; }
.stage-tabs button { background: transparent; border: 0; color: var(--crm-text-muted); font-size: 12px; font-weight: 600; padding: 6px 11px; border-radius: 6px; cursor: pointer; }
.stage-tabs button:hover { color: var(--crm-text); }
.stage-tabs button.active { background: var(--crm-accent-soft-bg); color: var(--crm-accent); }
.filter-right { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.sel { background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 8px; padding: 7px 10px; font: inherit; font-size: 12.5px; }
.sel:focus { outline: none; border-color: var(--crm-accent); }
.search-box { position: relative; display: flex; align-items: center; }
.search-box i { position: absolute; left: 10px; color: var(--crm-text-faint); font-size: 12px; }
.search-box input { background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 8px; padding: 8px 10px 8px 30px; font: inherit; font-size: 12.5px; width: 220px; }
.search-box input:focus { outline: none; border-color: var(--crm-accent); }

.crm-body { position: relative; flex: 1; display: flex; min-height: 0; overflow: hidden; }
.wrap { flex: 1; overflow: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl thead th { position: sticky; top: 0; background: var(--crm-header-bg); text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; padding: 10px 14px; border-bottom: 1px solid var(--crm-border-header); z-index: 1; }
.tbl thead th.num, .tbl td.num { text-align: right; font-variant-numeric: tabular-nums; }
.tbl tbody tr { border-bottom: 1px solid var(--crm-border); cursor: pointer; }
.tbl tbody tr:hover { background: var(--crm-hover-bg); }
.tbl tbody tr.active { background: var(--crm-accent-soft-bg); box-shadow: inset 3px 0 0 var(--crm-accent); }
.tbl td { padding: 10px 14px; vertical-align: top; }
.c-client .cc-name { font-size: 13.5px; font-weight: 600; }
.c-client .cc-email { font-size: 11.5px; color: var(--crm-text-dim); margin-top: 2px; }
.c-chev { color: var(--crm-text-faint); text-align: right; width: 26px; }
.muted { color: var(--crm-text-dim); }
.small { font-size: 11.5px; }

.src-badge { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 1px 6px; border-radius: 3px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); }
.src-brown { background: #241d16; color: var(--crm-warn); }
.src-black { background: var(--crm-hover-bg); color: var(--crm-text-secondary); }
.src-blue { background: #0c2634; color: #5fb8e0; }
.src-white { background: var(--crm-badge-bg); color: var(--crm-text-soft); }

.pill { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 1px 6px; border-radius: 3px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); }
.pill.ok { background: var(--crm-success-bg); color: var(--crm-success); }
.pill.bad { background: var(--crm-danger-bg); color: var(--crm-danger); }
.pill.warn { background: var(--crm-warn-bg); color: var(--crm-warn); }

.crm-empty { padding: 60px 24px; text-align: center; color: var(--crm-text-faint); }
.crm-empty i { font-size: 28px; opacity: .5; }
.crm-empty p { font-weight: 600; margin: 12px 0 4px; color: var(--crm-text-secondary); }
.crm-empty small { font-size: 11.5px; line-height: 1.5; display: block; }
.loading-row { padding: 18px; text-align: center; color: var(--crm-text-dim); font-size: 12.5px; }
.more-btn { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); border-radius: 7px; font-size: 12px; font-weight: 600; padding: 7px 16px; cursor: pointer; }
.more-btn:hover { border-color: var(--crm-accent); color: var(--crm-text); }

.drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 460px; max-width: 92vw; background: var(--crm-panel-bg); border-left: 1px solid var(--crm-border-header); z-index: 20; display: flex; flex-direction: column; box-shadow: -14px 0 40px rgba(0, 0, 0, .5); }
.slide-enter-active, .slide-leave-active { transition: transform .22s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
.dw-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--crm-border-header); background: var(--crm-header-bg); }
.dw-title h2 { margin: 0 0 3px; font-size: 16px; font-weight: 650; }
.dw-mail { font-size: 12px; color: var(--crm-accent); text-decoration: none; }
.dw-mail:hover { text-decoration: underline; }
.icon-btn { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 30px; height: 30px; border-radius: 6px; cursor: pointer; flex: none; }
.icon-btn:hover { background: var(--crm-hover-bg-strong); }
.dw-scroll { flex: 1; overflow-y: auto; padding: 16px 18px 28px; }
.dw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px; }
.dw-grid > div { min-width: 0; }
.dw-grid label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; margin-bottom: 3px; }
.dw-grid span { font-size: 13px; color: var(--crm-text-soft); word-break: break-word; }
.dw-section { margin-top: 20px; }
.dw-section h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; margin: 0 0 10px; }
.brief { font-size: 13px; line-height: 1.6; color: var(--crm-text-soft); white-space: pre-wrap; margin: 0; background: var(--crm-header-bg); border: 1px solid var(--crm-border); border-radius: 8px; padding: 11px 13px; }
.dw-applink { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--crm-accent); text-decoration: none; margin-bottom: 8px; }
.dw-applink:hover { text-decoration: underline; }
.mockup { width: 100%; border-radius: 8px; border: 1px solid var(--crm-border); }
.dw-foot { margin-top: 22px; font-size: 10.5px; color: var(--crm-text-faint); }
.dw-foot code { color: var(--crm-text-dim); }

@media (max-width: 720px) {
  .tbl th:nth-child(4), .tbl td:nth-child(4), .tbl th:nth-child(6), .tbl td:nth-child(6) { display: none; }
  .search-box input { width: 150px; }
}
</style>
