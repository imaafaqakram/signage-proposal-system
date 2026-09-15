<!--
  Luminus CRM — Phase 3: pipeline kanban board (view)

  Route to register (src/router/index.js):
    {
      path: '/crm/pipeline',
      name: 'crm-pipeline',
      component: () => import('@/views/CrmPipeline.vue'),
      meta: { requiresAuth: true }
    }

  Reads:  GET /api/crm/board            (columns + cards)
  Writes: PATCH /api/crm/leads/:id/status   (existing endpoint — drag-drop reuses it)

  Native HTML5 drag-and-drop, no libraries. Optimistic move with revert-on-error.
-->
<script setup>
import { useCrmThemeStore } from '@/stores/crmThemeStore'

const crmTheme = useCrmThemeStore()
import { ref, onMounted, onBeforeUnmount } from 'vue'

/* ------------------------------------------------------------------ auth + fetch */
const token = () => sessionStorage.getItem('admin_bypass_token') || ''
const api = (path, opts = {}) =>
  fetch(`/api/crm${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) } })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j })

/* ------------------------------------------------------------------ stages */
const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'responded', label: 'Responded' },
  { key: 'negotiating', label: 'Negotiating' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
]

/* ------------------------------------------------------------------ state */
const loading = ref(false)
const err = ref('')
const columns = ref([]) // always [{ key, label, count, leads: [] }] x6, in STAGES order

const dragLeadId = ref(null)
const dragFromStage = ref(null)
const dragOverStage = ref(null)

const toast = ref('')
let toastTimer = null

/* ------------------------------------------------------------------ load */
function blankColumns() {
  return STAGES.map((s) => ({ key: s.key, label: s.label, count: 0, leads: [] }))
}

function normLead(l) {
  return {
    id: l.id,
    client_name: l.client_name || '',
    contact_email: l.contact_email || '',
    source_alias: l.source_alias || '',
    owner: l.owner || '',
    last_activity_at: l.last_activity_at || null,
    has_proposal_pdf: !!l.has_proposal_pdf,
    has_thread: !!l.has_thread,
  }
}

async function load() {
  loading.value = true
  err.value = ''
  try {
    const res = await api('/board')
    const incoming = (res && res.columns) || []
    columns.value = STAGES.map((s) => {
      const c = incoming.find((x) => x.stage === s.key) || { count: 0, leads: [] }
      return {
        key: s.key,
        label: s.label,
        count: Number(c.count) || 0,
        leads: (c.leads || []).map(normLead),
      }
    })
  } catch (e) {
    err.value = e.message || String(e)
    if (!columns.value.length) columns.value = blankColumns()
  } finally {
    loading.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => clearTimeout(toastTimer))

/* ------------------------------------------------------------------ toast */
function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 4500)
}

/* ------------------------------------------------------------------ drag + drop */
function onDragStart(e, lead, fromKey) {
  dragLeadId.value = lead.id
  dragFromStage.value = fromKey
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', String(lead.id)) } catch (_) { /* IE guard */ }
  }
}

function onDragEnter(key) {
  if (dragLeadId.value != null) dragOverStage.value = key
}

function onDragOver(e, key) {
  if (dragLeadId.value == null) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverStage.value = key
}

function onDragLeave(key) {
  if (dragOverStage.value === key) dragOverStage.value = null
}

function resetDrag() {
  dragLeadId.value = null
  dragFromStage.value = null
  dragOverStage.value = null
}

async function onDrop(targetKey) {
  const id = dragLeadId.value
  const fromKey = dragFromStage.value
  resetDrag()
  if (id == null || !fromKey || fromKey === targetKey) return

  const fromCol = columns.value.find((c) => c.key === fromKey)
  const toCol = columns.value.find((c) => c.key === targetKey)
  if (!fromCol || !toCol) return

  const idx = fromCol.leads.findIndex((l) => l.id === id)
  if (idx === -1) return
  const card = fromCol.leads[idx]

  // optimistic move — take it out of the source, drop it on top of the target
  fromCol.leads.splice(idx, 1)
  toCol.leads.unshift(card)
  fromCol.count = Math.max(0, fromCol.count - 1)
  toCol.count += 1

  try {
    const row = await api(`/leads/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: targetKey }),
    })
    // keep the card fresh with whatever the server recorded
    if (row && typeof row === 'object') {
      if ('owner' in row) card.owner = row.owner || ''
      if ('last_activity_at' in row) card.last_activity_at = row.last_activity_at || card.last_activity_at
    }
  } catch (e) {
    // revert: pull it back out of the target, reinsert where it was, undo counts
    const backIdx = toCol.leads.findIndex((l) => l.id === id)
    if (backIdx !== -1) toCol.leads.splice(backIdx, 1)
    fromCol.leads.splice(Math.min(idx, fromCol.leads.length), 0, card)
    toCol.count = Math.max(0, toCol.count - 1)
    fromCol.count += 1
    showToast(`Couldn't move ${card.client_name || 'lead'} to ${labelFor(targetKey)} — ${e.message}`)
  }
}

function labelFor(key) {
  const s = STAGES.find((x) => x.key === key)
  return s ? s.label : key
}

/* ------------------------------------------------------------------ formatting */
function fmtRel(v) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 0) return 'just now'
  const min = Math.round(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  if (day < 31) return `${Math.round(day / 7)}w ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
</script>

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
      <button class="crm-refresh" @click="load" :disabled="loading" title="Refresh">↻</button>
    </header>

    <div class="crm-body">
      <div v-if="err" class="board-err">
        Couldn’t load the pipeline: {{ err }}
        <button class="link-btn" @click="load">Try again</button>
      </div>

      <div v-if="loading && !columns.length" class="board-loading">Loading pipeline…</div>

      <div v-else class="board" aria-label="Sales pipeline">
        <section
          v-for="col in columns"
          :key="col.key"
          class="col"
          :class="{ 'is-over': dragOverStage === col.key }"
          @dragenter.prevent="onDragEnter(col.key)"
          @dragover.prevent="onDragOver($event, col.key)"
          @dragleave="onDragLeave(col.key)"
          @drop.prevent="onDrop(col.key)"
        >
          <header class="col-head" :class="col.key">
            <span class="col-name">{{ col.label }}</span>
            <span class="col-count">{{ col.count }}</span>
          </header>

          <div class="col-list">
            <article
              v-for="lead in col.leads"
              :key="lead.id"
              class="card"
              :class="{ dragging: dragLeadId === lead.id }"
              draggable="true"
              @dragstart="onDragStart($event, lead, col.key)"
              @dragend="resetDrag"
            >
              <div class="card-name">{{ lead.client_name || 'Unnamed lead' }}</div>
              <div v-if="lead.contact_email" class="card-email">{{ lead.contact_email }}</div>

              <div class="card-meta" v-if="lead.source_alias || lead.has_proposal_pdf || lead.has_thread">
                <span v-if="lead.source_alias" class="badge">{{ lead.source_alias }}</span>
                <span v-if="lead.has_proposal_pdf" class="tag tag-pdf" title="Proposal PDF on file">PDF</span>
                <span v-if="lead.has_thread" class="tag tag-thread" title="Has an email thread">Thread</span>
              </div>

              <div class="card-foot">
                <span class="owner" v-if="lead.owner">{{ lead.owner }}</span>
                <span class="grow"></span>
                <span class="ago" v-if="lead.last_activity_at">{{ fmtRel(lead.last_activity_at) }}</span>
              </div>
            </article>

            <div v-if="!col.leads.length" class="col-empty">Nothing here</div>
          </div>
        </section>
      </div>
    </div>

    <transition name="toast">
      <div v-if="toast" class="toast" role="alert">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.crm {
  position: fixed;
  inset: 0;
  background: var(--crm-bg);
  color: var(--crm-text);
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* ── top bar ─────────────────────────────────────────────── */
.crm-top {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--crm-border-header);
  background: var(--crm-header-bg);
  flex: none;
}
.crm-brand { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.crm-brand .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--crm-accent); box-shadow: 0 0 8px rgba(0, 243, 255, .7), 0 0 2px var(--crm-accent); }
.crm-nav { display: flex; gap: 4px; }
.crm-nav a { font-size: 12.5px; font-weight: 600; color: var(--crm-text-muted); text-decoration: none; padding: 5px 11px; border-radius: 6px; }
.crm-nav a:hover { color: var(--crm-text); background: var(--crm-hover-bg); }
.crm-theme-toggle { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; flex: none; }
.crm-theme-toggle:hover { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
.crm-nav a.router-link-exact-active { color: var(--crm-accent); background: var(--crm-accent-soft-bg); }
.crm-refresh {
  margin-left: auto;
  background: var(--crm-hover-bg);
  border: 1px solid var(--crm-border-strong);
  color: var(--crm-text-soft);
  width: 32px;
  height: 32px;
  border-radius: 6px;
  font-size: 15px;
  cursor: pointer;
}
.crm-refresh:hover:not(:disabled) { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); }
.crm-refresh:disabled { opacity: 0.5; cursor: default; }

/* ── body ────────────────────────────────────────────────── */
.crm-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }

.board-err {
  margin: 14px 18px 0;
  background: var(--crm-danger-bg);
  border: 1px solid var(--crm-danger);
  color: var(--crm-danger);
  border-radius: 8px;
  padding: 10px 13px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.link-btn {
  background: transparent;
  border: 1px solid var(--crm-danger);
  color: var(--crm-danger);
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 12px;
  cursor: pointer;
}
.board-loading { color: var(--crm-text-muted); font-size: 14px; text-align: center; padding: 60px 0; }

/* ── the board row ───────────────────────────────────────── */
.board {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 14px 18px;
  overflow-x: auto;
  overflow-y: hidden;
  align-items: stretch;
}

.col {
  flex: 0 0 240px;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  background: var(--crm-panel-bg);
  border: 1px solid var(--crm-border-header);
  border-radius: 10px;
  min-height: 0;
}
.col.is-over { border-color: var(--crm-accent); background: var(--crm-panel-bg); box-shadow: inset 0 0 0 1px var(--crm-accent); }

.col-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--crm-border-header);
}
.col-name { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--crm-text-soft); }
.col-count {
  margin-left: auto;
  background: var(--crm-hover-bg);
  color: var(--crm-text-muted);
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 12px;
  font-weight: 600;
}
.col-head.won .col-name { color: var(--crm-success); }
.col-head.won .col-count { color: var(--crm-success); background: var(--crm-success-bg); }
.col-head.lost .col-name { color: var(--crm-danger); }
.col-head.lost .col-count { color: var(--crm-danger); background: var(--crm-danger-bg); }

.col-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── lead card ───────────────────────────────────────────── */
.card {
  background: var(--crm-header-bg);
  border: 1px solid var(--crm-border-strong);
  border-radius: 8px;
  padding: 10px 11px;
  cursor: grab;
  transition: opacity 0.12s ease, border-color 0.12s ease;
}
.card:hover { border-color: var(--crm-accent); }
.card:active { cursor: grabbing; }
.card.dragging { opacity: 0.4; }

.card-name { font-size: 13px; font-weight: 650; color: var(--crm-text); line-height: 1.3; }
.card-email {
  font-size: 11px;
  color: var(--crm-text-dim);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.badge {
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--crm-badge-bg);
  color: var(--crm-text-secondary);
}
.tag {
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 3px;
}
.tag-pdf { background: var(--crm-danger-bg); color: var(--crm-danger); }
.tag-thread { background: #0c2634; color: #5fb8e0; }

.card-foot { display: flex; align-items: center; gap: 6px; margin-top: 9px; }
.card-foot .grow { flex: 1; }
.owner {
  font-size: 11px;
  color: var(--crm-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}
.ago { font-size: 10.5px; color: var(--crm-text-dim); white-space: nowrap; flex: none; }

.col-empty {
  color: var(--crm-text-faint);
  font-size: 12px;
  text-align: center;
  padding: 18px 8px;
  border: 1px dashed var(--crm-border-header);
  border-radius: 8px;
}

/* ── toast ───────────────────────────────────────────────── */
.toast {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  background: var(--crm-danger-bg);
  border: 1px solid var(--crm-danger);
  color: var(--crm-danger);
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 13px;
  max-width: 90vw;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  z-index: 50;
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

/* ── reduced motion ──────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .card, .toast-enter-active, .toast-leave-active { transition: none !important; }
}
</style>
