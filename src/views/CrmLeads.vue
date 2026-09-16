<template>
  <div class="crm">
    <header class="crm-top">
      <div class="crm-brand">
        <span class="dot"></span> Luminus CRM
      </div>
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
        <span>{{ total }} lead{{ total === 1 ? '' : 's' }}</span>
        <span v-if="stage !== 'all'">· {{ stage }}</span>
      </div>
      <button class="crm-refresh" @click="loadLeads" :disabled="loading" title="Refresh">
        <i class="fas" :class="loading ? 'fa-circle-notch fa-spin' : 'fa-rotate'"></i>
      </button>
    </header>

    <div class="crm-filterbar">
      <div class="stage-tabs">
        <button v-for="s in stages" :key="s.key"
                :class="{ active: stage === s.key }"
                @click="setStage(s.key)">{{ s.label }}</button>
      </div>
      <div class="filter-right">
        <div class="sort-toggle">
          <button :class="{ active: sortBy === 'recent' }" @click="setSort('recent')">Recent</button>
          <button :class="{ active: sortBy === 'activity' }" @click="setSort('activity')">Active</button>
        </div>
        <div class="search-box">
          <i class="fas fa-magnifying-glass"></i>
          <input v-model="q" @input="onSearch" placeholder="Search name or email…" />
        </div>
      </div>
    </div>

    <div class="crm-body">
      <div class="leads-wrap">
        <table class="leads-table" v-if="leads.length">
          <thead>
            <tr>
              <th>Client</th>
              <th>Source</th>
              <th>Stage</th>
              <th>Last activity</th>
              <th>Proposal</th>
              <th aria-label="open"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in leads" :key="l.id"
                :class="{ active: l.id === selectedId }"
                @click="openLead(l.id)">
              <td class="c-client">
                <div class="cc-name">{{ l.client_name || '—' }}</div>
                <div class="cc-email">{{ l.contact_email || '—' }}</div>
              </td>
              <td class="c-source">
                <span v-if="l.source_alias" class="src-badge" :class="srcClass(l.source_alias)">
                  {{ l.source_alias }}
                </span>
                <span v-else class="muted">—</span>
                <div class="c-date" v-if="l.crm_lead_date">{{ fmtDate(l.crm_lead_date) }}</div>
              </td>
              <td>
                <span class="pill" :class="stageClass(l.stage)">{{ l.stage }}</span>
              </td>
              <td class="c-activity">{{ fmtRel(l.last_activity_at) }}</td>
              <td class="c-proposal" @click.stop>
                <button v-if="l.has_proposal_pdf" class="btn-sm" @click="quickPdf(l.id)" title="Open proposal PDF">
                  <i class="fas fa-file-pdf"></i> PDF
                </button>
                <span v-else class="muted">—</span>
              </td>
              <td class="c-chev"><i class="fas fa-chevron-right"></i></td>
            </tr>
          </tbody>
        </table>

        <div v-else-if="!loading" class="crm-empty">
          <i class="fas fa-user-group"></i>
          <p>No leads found.</p>
          <small v-if="stage !== 'all' || q">Try clearing the stage filter or search.</small>
          <small v-else>Leads show up here once proposals are created in the editor.</small>
        </div>

        <div v-if="loading" class="loading-row">
          <i class="fas fa-circle-notch fa-spin"></i> Loading…
        </div>
      </div>

      <transition name="slide">
        <aside class="drawer" v-if="selectedId">
          <div class="dw-head">
            <div class="dw-title">
              <h2>{{ detail?.client_name || 'Lead' }}</h2>
              <a v-if="detail?.contact_email" class="dw-mail" :href="'mailto:' + detail.contact_email">
                {{ detail.contact_email }}
              </a>
            </div>
            <button class="icon-btn" @click="closeDrawer" title="Close"><i class="fas fa-xmark"></i></button>
          </div>

          <div class="dw-scroll" v-if="detail">
            <div class="dw-grid">
              <div><label>Phone</label><span>{{ detail.phone || '—' }}</span></div>
              <div><label>Source</label><span>{{ detail.source_alias || '—' }}</span></div>
              <div class="wide"><label>Address</label><span>{{ detail.address || '—' }}</span></div>
              <div><label>Sign type</label><span>{{ detail.sign_type || '—' }}</span></div>
              <div><label>Price</label><span>{{ fmtPrice(detail.price) }}</span></div>
              <div><label>Lead date</label><span>{{ fmtDate(detail.crm_lead_date) }}</span></div>
              <div><label>Created</label><span>{{ fmtDate(detail.created_at) }}</span></div>
              <div><label>Proposal sent</label><span>{{ detail.email_sent_at ? fmtDateTime(detail.email_sent_at) : '—' }}</span></div>
              <div v-if="detail.has_thread"><label>Conversation</label><span>Active thread</span></div>
            </div>

            <div class="dw-controls">
              <div class="ctl">
                <label>Stage <i v-if="savedStage" class="fas fa-check saved"></i></label>
                <select :value="detail.stage" @change="patchStage" :disabled="savingStage">
                  <option v-for="s in STAGE_OPTS" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>
              <div class="ctl">
                <label>Owner <i v-if="savedOwner" class="fas fa-check saved"></i></label>
                <input v-model="ownerDraft" @change="saveOwner" :disabled="savingOwner" placeholder="Unassigned" />
              </div>
            </div>

            <a v-if="detail.proposal_link" class="dw-applink" :href="detail.proposal_link" target="_blank" rel="noopener">
              <i class="fas fa-arrow-up-right-from-square"></i> Open proposal app
            </a>

            <div class="dw-section" v-if="detail.attachments && detail.attachments.length">
              <h3>Proposal PDFs</h3>
              <button v-for="a in detail.attachments" :key="a.id"
                      class="pdf-row" @click="openAttachment(a.id, a.filename)">
                <i class="fas fa-file-pdf"></i>
                <span class="pdf-name">{{ a.filename }}</span>
                <span class="pdf-meta">
                  <template v-if="a.size_bytes">{{ fmtSize(a.size_bytes) }} · </template>{{ fmtDate(a.created_at) }}
                </span>
                <i v-if="!a.on_disk" class="fas fa-cloud" title="Archived to Drive only — may take a moment"></i>
              </button>
            </div>

            <div class="dw-section">
              <h3>Timeline</h3>
              <div v-if="detail.timeline && detail.timeline.length" class="timeline">
                <div v-for="(it, i) in detail.timeline" :key="i" class="tl-item">
                  <div class="tl-icon" :class="it.type"><i class="fas" :class="tlIcon(it.type)"></i></div>
                  <div class="tl-content">
                    <div class="tl-label">{{ it.label }}</div>
                    <div class="tl-detail" v-if="it.detail">{{ it.detail }}</div>
                  </div>
                  <div class="tl-time">{{ fmtRel(it.at) }}</div>
                </div>
              </div>
              <p v-else class="muted small">Nothing recorded yet.</p>
            </div>
          </div>

          <div class="dw-scroll" v-else>
            <div class="loading-row"><i class="fas fa-circle-notch fa-spin"></i> Loading…</div>
          </div>
        </aside>
      </transition>
      <div class="scrim" v-if="selectedId" @click="closeDrawer"></div>
    </div>
  </div>
</template>

<script setup>
import { useCrmThemeStore } from '@/stores/crmThemeStore'
import { useInboxUnread } from '@/composables/useInboxUnread'

const crmTheme = useCrmThemeStore()
const { unreadCount } = useInboxUnread()
import { ref, onMounted } from 'vue'

const token = () => sessionStorage.getItem('admin_bypass_token') || ''
const api = (path, opts = {}) =>
  fetch(`/api/crm${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) }
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
    return j
  })

const stages = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'responded', label: 'Responded' },
  { key: 'negotiating', label: 'Negotiating' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' }
]
const STAGE_OPTS = ['new', 'contacted', 'responded', 'negotiating', 'won', 'lost']

const stage = ref('all')
const sortBy = ref('recent')
const q = ref('')
const leads = ref([])
const total = ref(0)
const loading = ref(false)

const selectedId = ref(null)
const detail = ref(null)
const detailLoading = ref(false)
const ownerDraft = ref('')
const savingStage = ref(false)
const savedStage = ref(false)
const savingOwner = ref(false)
const savedOwner = ref(false)

let searchTimer = null

async function loadLeads() {
  loading.value = true
  try {
    const params = new URLSearchParams({ stage: stage.value, sort: sortBy.value, limit: '150' })
    if (q.value.trim()) params.set('q', q.value.trim())
    const r = await api(`/leads?${params.toString()}`)
    leads.value = r.leads || []
    total.value = r.total || 0
    if (selectedId.value && !leads.value.some((l) => l.id === selectedId.value)) {
      // keep the drawer if still selected elsewhere; otherwise leave as-is
    }
  } catch (e) {
    console.error('[crm-leads] loadLeads', e)
  } finally {
    loading.value = false
  }
}

function setStage(k) {
  stage.value = k
  loadLeads()
}
function setSort(s) {
  sortBy.value = s
  loadLeads()
}
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadLeads, 300)
}

async function openLead(id) {
  selectedId.value = id
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = await api(`/leads/${id}`)
    ownerDraft.value = detail.value.owner || ''
  } catch (e) {
    console.error('[crm-leads] openLead', e)
  } finally {
    detailLoading.value = false
  }
}
function closeDrawer() {
  selectedId.value = null
  detail.value = null
}

function syncListRow(row) {
  const li = leads.value.find((l) => l.id === row.lead_id)
  if (li) {
    li.stage = row.stage
    li.owner = row.owner
    li.last_activity_at = row.last_activity_at
    li.first_response_at = row.first_response_at
  }
}

async function patchStage(e) {
  if (!detail.value) return
  const next = e.target.value
  const prev = detail.value.stage
  detail.value.stage = next
  savingStage.value = true
  savedStage.value = false
  try {
    const row = await api(`/leads/${detail.value.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: next })
    })
    detail.value.stage = row.stage
    detail.value.owner = row.owner
    detail.value.last_activity_at = row.last_activity_at
    detail.value.first_response_at = row.first_response_at
    syncListRow(row)
    savedStage.value = true
    setTimeout(() => (savedStage.value = false), 1600)
  } catch (err) {
    detail.value.stage = prev
    console.error('[crm-leads] patchStage', err)
  } finally {
    savingStage.value = false
  }
}

async function saveOwner() {
  if (!detail.value) return
  const val = ownerDraft.value.trim()
  if (val === (detail.value.owner || '')) return
  savingOwner.value = true
  savedOwner.value = false
  try {
    const row = await api(`/leads/${detail.value.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ owner: val })
    })
    detail.value.owner = row.owner
    detail.value.last_activity_at = row.last_activity_at
    ownerDraft.value = row.owner || ''
    syncListRow(row)
    savedOwner.value = true
    setTimeout(() => (savedOwner.value = false), 1600)
  } catch (err) {
    console.error('[crm-leads] saveOwner', err)
  } finally {
    savingOwner.value = false
  }
}

// A plain <a href> can't carry the auth header, so pull the file as a blob and hand it off.
async function openAttachment(attId, filename) {
  try {
    const r = await fetch(`/api/crm/leads/attachment/${attId}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      throw new Error(j.error || `HTTP ${r.status}`)
    }
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener'
    if (filename) a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (e) {
    alert(`Could not open attachment: ${e.message}`)
  }
}

async function quickPdf(id) {
  try {
    const d = await api(`/leads/${id}`)
    const a = (d.attachments || [])[0]
    if (a) openAttachment(a.id, a.filename)
    else alert('No PDF on file for this lead.')
  } catch (e) {
    alert(`Could not load PDF: ${e.message}`)
  }
}

// ── formatters ──
function fmtRel(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const diff = now - d
  if (diff > 0 && diff < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
function fmtDate(v) {
  if (!v) return '—'
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function fmtPrice(p) {
  if (p == null || p === '') return '—'
  const n = typeof p === 'number' ? p : parseFloat(String(p).replace(/[^0-9.\-]/g, ''))
  if (!isNaN(n) && n > 0) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return String(p)
}
function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return b + ' B'
  if (b < 1048576) return Math.round(b / 1024) + ' KB'
  return (b / 1048576).toFixed(1) + ' MB'
}
function stageClass(s) {
  if (s === 'won' || s === 'responded') return 'ok'
  if (s === 'lost') return 'bad'
  if (s === 'contacted' || s === 'negotiating') return 'warn'
  return ''
}
function srcClass(alias) {
  return 'src-' + String(alias).toLowerCase().replace(/[^a-z0-9]+/g, '')
}
function tlIcon(type) {
  return (
    {
      'proposal-sent': 'fa-paper-plane',
      'reply-received': 'fa-arrow-down',
      'reply-sent': 'fa-arrow-up',
      'follow-up': 'fa-repeat',
      responded: 'fa-star'
    }[type] || 'fa-circle'
  )
}

onMounted(loadLeads)
</script>

<style scoped>
.crm { position: fixed; inset: 0; background: var(--crm-bg); color: var(--crm-text); display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

.crm-top { display: flex; align-items: center; gap: 16px; padding: 12px 18px; border-bottom: 1px solid var(--crm-border-header); background: var(--crm-header-bg); }
.crm-brand { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.crm-brand .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--crm-accent); box-shadow: 0 0 8px rgba(0, 243, 255, .7), 0 0 2px var(--crm-accent); }
.crm-sub { color: var(--crm-text-muted); font-weight: 500; }
.crm-nav { display: flex; gap: 4px; }
.crm-nav a { font-size: 12.5px; font-weight: 600; color: var(--crm-text-muted); text-decoration: none; padding: 5px 11px; border-radius: 6px; }
.crm-nav a:hover { color: var(--crm-text); background: var(--crm-hover-bg); }
.crm-theme-toggle { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; flex: none; }
.crm-theme-toggle:hover { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
.crm-nav a.router-link-exact-active { color: var(--crm-accent); background: var(--crm-accent-soft-bg); }
.crm-counts { display: flex; gap: 8px; font-size: 12.5px; color: var(--crm-text-muted); margin-left: auto; text-transform: capitalize; }
.crm-refresh { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; }
.crm-refresh:hover { background: var(--crm-hover-bg-strong); }
.crm-refresh:disabled { opacity: .5; cursor: default; }

.crm-filterbar { display: flex; align-items: center; gap: 14px; padding: 9px 16px; border-bottom: 1px solid var(--crm-border-header); background: var(--crm-panel-bg); flex-wrap: wrap; }
.stage-tabs { display: flex; gap: 3px; }
.stage-tabs button { background: transparent; border: 0; color: var(--crm-text-muted); font-size: 12px; font-weight: 600; padding: 6px 11px; border-radius: 6px; cursor: pointer; }
.stage-tabs button:hover { color: var(--crm-text); }
.stage-tabs button.active { background: var(--crm-hover-bg-strong); color: var(--crm-text); }
.filter-right { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.sort-toggle { display: flex; border: 1px solid var(--crm-border-strong); border-radius: 7px; overflow: hidden; }
.sort-toggle button { background: var(--crm-header-bg); border: 0; color: var(--crm-text-muted); font-size: 11.5px; font-weight: 600; padding: 6px 10px; cursor: pointer; }
.sort-toggle button.active { background: var(--crm-hover-bg-strong); color: var(--crm-text); }
.search-box { position: relative; display: flex; align-items: center; }
.search-box i { position: absolute; left: 10px; color: var(--crm-text-faint); font-size: 12px; }
.search-box input { background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 8px; padding: 8px 10px 8px 30px; font: inherit; font-size: 12.5px; width: 240px; }
.search-box input:focus { outline: none; border-color: var(--crm-accent); }

.crm-body { position: relative; flex: 1; display: flex; min-height: 0; overflow: hidden; }
.leads-wrap { flex: 1; overflow: auto; }

.leads-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.leads-table thead th { position: sticky; top: 0; background: var(--crm-header-bg); text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; padding: 10px 14px; border-bottom: 1px solid var(--crm-border-header); z-index: 1; }
.leads-table tbody tr { border-bottom: 1px solid var(--crm-border); cursor: pointer; }
.leads-table tbody tr:hover { background: var(--crm-hover-bg); }
.leads-table tbody tr.active { background: var(--crm-accent-soft-bg); box-shadow: inset 3px 0 0 var(--crm-accent); }
.leads-table td { padding: 10px 14px; vertical-align: top; }

.c-client .cc-name { font-size: 13.5px; font-weight: 600; }
.c-client .cc-email { font-size: 11.5px; color: var(--crm-text-dim); margin-top: 2px; }
.c-source { white-space: nowrap; }
.c-source .c-date { font-size: 11px; color: var(--crm-text-dim); margin-top: 4px; }
.c-activity { font-size: 12px; color: var(--crm-text-secondary); white-space: nowrap; }
.c-chev { color: var(--crm-text-faint); text-align: right; width: 26px; }
.muted { color: var(--crm-text-faint); }
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

.btn-sm { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); border-radius: 6px; font-size: 11.5px; font-weight: 600; padding: 4px 9px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
.btn-sm:hover { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }

.crm-empty { padding: 60px 24px; text-align: center; color: var(--crm-text-faint); }
.crm-empty i { font-size: 28px; opacity: .5; }
.crm-empty p { font-weight: 600; margin: 12px 0 4px; color: var(--crm-text-secondary); }
.crm-empty small { font-size: 11.5px; line-height: 1.5; display: block; }
.loading-row { padding: 22px; text-align: center; color: var(--crm-text-dim); font-size: 12.5px; }
.loading-row i { margin-right: 6px; }

/* drawer */
.scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, .38); z-index: 10; }
.drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 440px; max-width: 92vw; background: var(--crm-panel-bg); border-left: 1px solid var(--crm-border-header); z-index: 20; display: flex; flex-direction: column; box-shadow: -14px 0 40px rgba(0, 0, 0, .35); }
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
.dw-grid .wide { grid-column: 1 / -1; }
.dw-grid label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; margin-bottom: 3px; }
.dw-grid span { font-size: 13px; color: var(--crm-text-soft); word-break: break-word; }

.dw-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 18px 0 14px; padding-top: 16px; border-top: 1px solid var(--crm-border-header); }
.ctl label { display: flex; align-items: center; gap: 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; margin-bottom: 5px; }
.ctl label .saved { color: var(--crm-success); font-size: 10px; }
.ctl select, .ctl input { width: 100%; background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 12.5px; text-transform: capitalize; }
.ctl input { text-transform: none; }
.ctl select:focus, .ctl input:focus { outline: none; border-color: var(--crm-accent); }

.dw-applink { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--crm-accent); text-decoration: none; margin-bottom: 8px; }
.dw-applink:hover { text-decoration: underline; }

.dw-section { margin-top: 20px; }
.dw-section h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; margin: 0 0 10px; }

.pdf-row { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; background: var(--crm-header-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); border-radius: 8px; padding: 9px 11px; cursor: pointer; margin-bottom: 7px; }
.pdf-row:hover { background: var(--crm-accent-soft-bg); border-color: var(--crm-accent); }
.pdf-row > i:first-child { color: var(--crm-danger); }
.pdf-name { font-size: 12.5px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pdf-meta { font-size: 10.5px; color: var(--crm-text-dim); flex: none; }
.pdf-row .fa-cloud { color: var(--crm-text-dim); font-size: 11px; }

.timeline { display: flex; flex-direction: column; }
.tl-item { display: flex; gap: 11px; padding: 8px 0; position: relative; }
.tl-item:not(:last-child)::before { content: ''; position: absolute; left: 12px; top: 30px; bottom: -8px; width: 1px; background: var(--crm-border-strong); }
.tl-icon { width: 25px; height: 25px; border-radius: 50%; background: var(--crm-hover-bg-strong); border: 1px solid var(--crm-border-strong); display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--crm-text-secondary); flex: none; z-index: 1; }
.tl-icon.proposal-sent { color: var(--crm-accent); border-color: #0b4651; }
.tl-icon.reply-received { color: var(--crm-success); border-color: #14513c; }
.tl-icon.reply-sent { color: var(--crm-warn); border-color: var(--crm-warn-border); }
.tl-icon.responded { color: #e6c95c; border-color: #4e451f; }
.tl-content { flex: 1; min-width: 0; }
.tl-label { font-size: 12.5px; color: var(--crm-text-soft); font-weight: 600; }
.tl-detail { font-size: 11.5px; color: var(--crm-text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-time { font-size: 11px; color: var(--crm-text-dim); flex: none; }

@media (max-width: 720px) {
  .leads-table .c-source, .leads-table th:nth-child(2) { display: none; }
  .search-box input { width: 150px; }
}
</style>
