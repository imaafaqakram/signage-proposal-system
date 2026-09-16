<!-- Author: Burhan -->
<!--
  Luminus CRM — Phase 3: saved reply templates (view)
  Route to register:
    { path: '/crm/templates', name: 'crm-templates',
      component: () => import('./views/CrmTemplates.vue'), meta: { requiresAuth: true } }

  Reads / writes /api/crm/templates:
    GET  /            → { templates: [...] }   (ordered by name)
    POST /            → { name, body }         → created row
    PATCH /:id        → { name?, body? }       → updated row
    DELETE /:id       → 204
  The inbox reply box consumes the same GET endpoint — see INBOX_TEMPLATE_SNIPPET.md.
-->
<script setup>
import { useCrmThemeStore } from '@/stores/crmThemeStore'
import { useInboxUnread } from '@/composables/useInboxUnread'

const crmTheme = useCrmThemeStore()
const { unreadCount } = useInboxUnread()
import { ref, onMounted } from 'vue'

/* ------------------------------------------------------------------ auth + fetch */
const token = () => sessionStorage.getItem('admin_bypass_token') || ''
const api = (path, opts = {}) =>
  fetch(`/api/crm${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) } })
    .then(async (r) => {
      if (r.status === 204) return null
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      return j
    })

/* ------------------------------------------------------------------ state */
const templates = ref([])
const loading = ref(true)
const err = ref('')

const draft = ref({ name: '', body: '' })
const adding = ref(false)

const editingId = ref(null)
const editDraft = ref({ name: '', body: '' })
const savingEdit = ref(false)

const busyId = ref(null)

const byName = (a, b) => String(a.name).localeCompare(String(b.name))

/* ------------------------------------------------------------------ load */
async function load() {
  loading.value = true
  err.value = ''
  try {
    const { templates: rows } = await api('/templates')
    templates.value = (rows || []).slice().sort(byName)
  } catch (e) {
    err.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

/* ------------------------------------------------------------------ create */
async function addTemplate() {
  const name = draft.value.name.trim()
  const body = draft.value.body.trim()
  if (!name || !body || adding.value) return
  adding.value = true
  err.value = ''
  try {
    const row = await api('/templates', { method: 'POST', body: JSON.stringify({ name, body }) })
    templates.value.push(row)
    templates.value.sort(byName)
    draft.value = { name: '', body: '' }
  } catch (e) {
    err.value = e.message || String(e)
  } finally {
    adding.value = false
  }
}

/* ------------------------------------------------------------------ inline edit */
function startEdit(t) {
  editingId.value = t.id
  editDraft.value = { name: t.name, body: t.body }
  err.value = ''
}
function cancelEdit() {
  editingId.value = null
  editDraft.value = { name: '', body: '' }
}
async function saveEdit() {
  const name = editDraft.value.name.trim()
  const body = editDraft.value.body.trim()
  if (!name || !body || savingEdit.value) return
  savingEdit.value = true
  err.value = ''
  try {
    const row = await api(`/templates/${editingId.value}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, body })
    })
    const i = templates.value.findIndex((t) => t.id === row.id)
    if (i !== -1) templates.value[i] = row
    templates.value.sort(byName)
    cancelEdit()
  } catch (e) {
    err.value = e.message || String(e)
  } finally {
    savingEdit.value = false
  }
}

/* ------------------------------------------------------------------ delete */
async function removeTemplate(t) {
  if (busyId.value) return
  if (!window.confirm(`Delete template “${t.name}”?`)) return
  busyId.value = t.id
  err.value = ''
  try {
    await api(`/templates/${t.id}`, { method: 'DELETE' })
    templates.value = templates.value.filter((x) => x.id !== t.id)
    if (editingId.value === t.id) cancelEdit()
  } catch (e) {
    err.value = e.message || String(e)
  } finally {
    busyId.value = null
  }
}

/* ------------------------------------------------------------------ formatting */
function preview(body) {
  const s = (body || '').replace(/\s+/g, ' ').trim()
  return s.length > 180 ? s.slice(0, 180) + '…' : s
}
</script>

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
      <div class="spacer"></div>
      <button class="btn" :disabled="loading" @click="load">{{ loading ? 'Loading…' : 'Refresh' }}</button>
    </header>

    <div class="crm-body">
      <div v-if="err" class="err">{{ err }}</div>

      <!-- add -->
      <div class="card">
        <div class="card-title">New template</div>
        <input
          v-model="draft.name"
          class="in"
          type="text"
          maxlength="120"
          placeholder="Template name (e.g. “Sending the payment link”)"
        />
        <textarea
          v-model="draft.body"
          class="in ta"
          rows="4"
          placeholder="The reply text. Written once here, reused from the inbox reply box."
        ></textarea>
        <div class="row-bar">
          <span class="hint">Name and body are both required.</span>
          <button
            class="btn primary"
            :disabled="adding || !draft.name.trim() || !draft.body.trim()"
            @click="addTemplate"
          >{{ adding ? 'Saving…' : 'Add template' }}</button>
        </div>
      </div>

      <!-- list -->
      <div v-if="loading && !templates.length" class="muted">Loading templates…</div>
      <div v-else-if="!templates.length" class="muted">No templates yet — add one above.</div>

      <div v-for="t in templates" :key="t.id" class="card tpl">
        <template v-if="editingId === t.id">
          <input v-model="editDraft.name" class="in" type="text" maxlength="120" />
          <textarea v-model="editDraft.body" class="in ta" rows="4"></textarea>
          <div class="row-bar end">
            <button class="btn" :disabled="savingEdit" @click="cancelEdit">Cancel</button>
            <button
              class="btn primary"
              :disabled="savingEdit || !editDraft.name.trim() || !editDraft.body.trim()"
              @click="saveEdit"
            >{{ savingEdit ? 'Saving…' : 'Save' }}</button>
          </div>
        </template>

        <template v-else>
          <div class="tpl-head">
            <span class="tpl-name">{{ t.name }}</span>
            <div class="tpl-actions">
              <button class="btn sm" @click="startEdit(t)">Edit</button>
              <button class="btn sm danger" :disabled="busyId === t.id" @click="removeTemplate(t)">
                {{ busyId === t.id ? '…' : 'Delete' }}
              </button>
            </div>
          </div>
          <p class="tpl-preview">{{ preview(t.body) }}</p>
        </template>
      </div>
    </div>
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

/* top bar */
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
.spacer { flex: 1; }

/* buttons */
.btn {
  background: var(--crm-hover-bg);
  border: 1px solid var(--crm-border-strong);
  color: var(--crm-text-soft);
  border-radius: 6px;
  padding: 6px 13px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover:not(:disabled) { border-color: var(--crm-accent); }
.btn:disabled { opacity: 0.55; cursor: default; }
.btn.sm { padding: 4px 10px; font-size: 12px; }
.btn.primary { background: var(--crm-accent); border-color: var(--crm-accent); color: var(--crm-accent-contrast); }
.btn.primary:hover:not(:disabled) { background: var(--crm-accent); }
.btn.danger { color: var(--crm-danger); }
.btn.danger:hover:not(:disabled) { border-color: var(--crm-danger); }

/* body */
.crm-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 760px;
  box-sizing: border-box;
}
.err {
  background: var(--crm-danger-bg);
  border: 1px solid var(--crm-danger);
  color: var(--crm-danger);
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 13px;
}
.muted { color: var(--crm-text-muted); font-size: 13px; text-align: center; padding: 30px 0; }

/* cards */
.card { background: var(--crm-header-bg); border: 1px solid var(--crm-border-header); border-radius: 8px; padding: 14px 16px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--crm-text-soft); margin-bottom: 10px; }

.in {
  width: 100%;
  background: var(--crm-input-bg);
  border: 1px solid var(--crm-border-strong);
  color: var(--crm-text);
  border-radius: 7px;
  padding: 9px 11px;
  font: inherit;
  font-size: 13px;
  margin-bottom: 8px;
  box-sizing: border-box;
}
.in:focus { outline: none; border-color: var(--crm-accent); }
.ta { resize: vertical; line-height: 1.5; }

.row-bar { display: flex; align-items: center; gap: 10px; }
.row-bar .hint { font-size: 11.5px; color: var(--crm-text-dim); }
.row-bar .btn { margin-left: auto; }
.row-bar.end { justify-content: flex-end; }
.row-bar.end .btn { margin-left: 0; }

/* template rows */
.tpl-head { display: flex; align-items: center; gap: 10px; }
.tpl-name { font-size: 13.5px; font-weight: 700; color: var(--crm-text); }
.tpl-actions { margin-left: auto; display: flex; gap: 6px; }
.tpl-preview {
  margin: 8px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--crm-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
