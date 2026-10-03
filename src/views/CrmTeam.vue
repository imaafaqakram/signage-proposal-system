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
        <span>{{ activeCount }} active {{ activeCount === 1 ? 'person' : 'people' }}</span>
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
          <h2>Team</h2>
          <template v-if="isEmployeeOnly">
            <p>Accounts and activity history are limited to admins. Ask an admin if you need something changed.</p>
          </template>
          <template v-else>
            <p>Accounts, sign-in settings and the full activity history — admin password required.</p>
            <form class="gate-form" @submit.prevent="unlockAdmin">
              <input v-model="adminPassword" :type="showAdminPassword ? 'text' : 'password'" placeholder="Admin password" />
              <button type="button" class="pw-toggle" @click="showAdminPassword = !showAdminPassword" tabindex="-1"><i class="fas" :class="showAdminPassword ? 'fa-eye-slash' : 'fa-eye'"></i></button>
              <button type="submit" :disabled="adminAuth.loading">Unlock</button>
            </form>
            <p v-if="adminError" class="err-text">{{ adminError }}</p>
          </template>
        </div>
      </div>

      <!-- ═══ TEAM ═══ -->
      <div v-else class="wrap">
        <div v-if="migrationPending" class="banner">
          <i class="fas fa-triangle-exclamation"></i>
          <div>
            <strong>One database update is needed before accounts can be created.</strong>
            Run <code>017_crm_users.sql</code> once in the Supabase SQL editor, then reload this page.
            Everything else in the CRM keeps working in the meantime.
          </div>
        </div>

        <div class="tabs" role="tablist">
          <button role="tab" :aria-selected="tab === 'people'" :class="{ on: tab === 'people' }" @click="tab = 'people'"><i class="fas fa-users"></i> People</button>
          <button role="tab" :aria-selected="tab === 'activity'" :class="{ on: tab === 'activity' }" @click="switchToActivity"><i class="fas fa-clock-rotate-left"></i> Activity history</button>
        </div>

        <!-- PEOPLE -->
        <template v-if="tab === 'people'">
          <section class="card">
            <div class="card-head">
              <h2><i class="fas fa-id-badge"></i> Accounts</h2>
              <button class="btn-sm primary" style="margin-left:auto" :disabled="migrationPending" @click="openAdd">+ Add person</button>
            </div>
            <p class="sub">Everyone signs in with their own username and password, and every change they make is stamped with their name.
              <strong>Admins</strong> can see money pages (Finance, Orders, Materials, Vendors) and this page; <strong>employees</strong> use everything else.</p>

            <table class="tbl" v-if="users.length">
              <thead><tr><th>Person</th><th>Username</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
              <tbody>
                <tr v-for="u in users" :key="u.id" :class="{ off: !u.active }">
                  <td><span class="p-avatar">{{ initials(u.display_name) }}</span> <strong>{{ u.display_name }}</strong><span v-if="isMe(u)" class="me-tag">you</span></td>
                  <td class="muted">@{{ u.username }}</td>
                  <td><span class="role-badge" :class="u.role">{{ u.role === 'admin' ? 'Admin' : 'Employee' }}</span></td>
                  <td><span class="status-dot" :class="u.active ? 'on' : 'off'"></span>{{ u.active ? 'Active' : 'Disabled' }}</td>
                  <td class="muted small">{{ u.last_login_at ? relTime(u.last_login_at) : 'Never' }}</td>
                  <td class="right">
                    <button class="btn-sm" @click="openEdit(u)">Edit</button>
                    <button class="btn-sm" style="margin-left:6px" @click="openReset(u)">Reset password</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else-if="!loading" class="empty">
              <i class="fas fa-user-plus"></i>
              <p v-if="migrationPending">Accounts will appear here once the database update has been run.</p>
              <p v-else>No personal accounts yet. Add yourself first as an <strong>Admin</strong>, then add the rest of the team.</p>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2><i class="fas fa-shield-halved"></i> Sign-in method</h2>
              <span class="pill" :class="sharedDisabled ? 'ok' : 'warn'" style="margin-left:auto">{{ sharedDisabled ? 'Personal accounts only' : 'Shared passwords still allowed' }}</span>
            </div>
            <p class="sub" v-if="!sharedDisabled">
              The old shared passwords still work, and anyone using them can only be identified by a name they type themselves.
              Once everyone has an account, switch this on so that <strong>only personal logins</strong> are accepted in the CRM
              and every entry in the history is tied to a real, verified person.
            </p>
            <p class="sub" v-else>
              The shared passwords no longer work in the CRM — everyone must sign in with their own account.
              (The Proposal System is not affected by this setting.)
            </p>
            <div class="filter-bar" style="margin-bottom:0">
              <button v-if="!sharedDisabled" class="btn-sm primary" :disabled="!canSwitch || secBusy" @click="setSharedDisabled(true)">Require personal logins</button>
              <button v-else class="btn-sm" :disabled="secBusy" @click="setSharedDisabled(false)">Allow shared passwords again</button>
              <span v-if="!sharedDisabled && !canSwitch" class="hint">{{ switchHint }}</span>
            </div>
            <p v-if="secError" class="err-text">{{ secError }}</p>
          </section>
        </template>

        <!-- ACTIVITY -->
        <section v-else class="card">
          <div class="card-head"><h2><i class="fas fa-clock-rotate-left"></i> Activity history</h2></div>
          <p class="sub">Every change made in the CRM — who did it, what it was, and the before → after values. Entries from someone on the shared login are marked <span class="tag-inline">unverified name</span>.</p>
          <div class="filter-bar">
            <select v-model.number="days" class="finp" @change="loadActivity">
              <option :value="7">Last 7 days</option><option :value="30">Last 30 days</option><option :value="90">Last 90 days</option>
            </select>
            <select v-model="fUser" class="finp">
              <option value="">Everyone</option>
              <option v-for="n in feedPeople" :key="n" :value="n">{{ n }}</option>
            </select>
            <select v-model="fType" class="finp">
              <option value="">All record types</option>
              <option v-for="t in feedTypes" :key="t" :value="t">{{ typeLabel(t) }}</option>
            </select>
            <input v-model="fText" class="finp" placeholder="Search names and details…" style="flex:1;min-width:160px" />
          </div>

          <div v-if="actLoading" class="empty"><i class="fas fa-circle-notch fa-spin"></i><p>Loading activity…</p></div>
          <div v-else-if="actPending" class="empty"><i class="fas fa-database"></i><p>The activity log isn't set up yet.</p></div>
          <div v-else-if="!visibleFeed.length" class="empty"><i class="fas fa-clock-rotate-left"></i><p>No activity {{ (fUser || fType || fText) ? 'matching those filters' : 'in this period' }}.</p></div>
          <ol v-else class="feed">
            <li v-for="(e, i) in visibleFeed" :key="i" class="feed-item">
              <div class="p-avatar big" :class="{ shared: e.via !== 'personal' }">{{ initials(e.employee_name) }}</div>
              <div class="feed-body">
                <div class="feed-line">
                  <strong>{{ e.employee_name || 'Unknown user' }}</strong>
                  <span class="verb">{{ describeAction(e) }}</span>
                  <span v-if="e.label" class="target">{{ e.label }}</span>
                  <span v-if="e.via !== 'personal' && e.employee_name" class="tag-inline" title="Signed in with the shared password — this name is whatever they typed at sign-in">unverified name</span>
                </div>
                <div class="feed-time" :title="fullTime(e.created_at)">{{ relTime(e.created_at) }} · {{ fullTime(e.created_at) }}</div>
                <div v-if="e.detail" class="feed-detail">{{ e.detail }}</div>
                <ul v-if="e.changes.length" class="changes">
                  <li v-for="c in e.changes" :key="c.label"><span class="fld">{{ c.label }}</span><span class="from">{{ c.from }}</span><i class="fas fa-arrow-right-long"></i><span class="to">{{ c.to }}</span></li>
                </ul>
              </div>
            </li>
          </ol>
          <p v-if="feed.length >= 500" class="sub" style="margin:12px 0 0">Showing the most recent 500 events — narrow the date range to see older ones.</p>
        </section>
      </div>
    </div>

    <!-- ═══ ADD / EDIT PERSON ═══ -->
    <div v-if="personOpen" class="modal-bg" @click.self="closePerson">
      <div class="modal" role="dialog" aria-modal="true">
        <template v-if="!created">
          <h3>{{ editing ? 'Edit person' : 'Add a person' }}</h3>
          <div class="fg"><label>Full name *</label>
            <input v-model="pf.displayName" class="finp" style="width:100%" placeholder="e.g. Jordan Smith" maxlength="80" @input="suggestUsername" />
            <span class="fhint">This is the name that appears in the history.</span>
          </div>
          <div class="fg" v-if="!editing"><label>Username *</label>
            <input v-model="pf.username" class="finp" style="width:100%" placeholder="e.g. jordan.smith" autocapitalize="off" autocomplete="off" @input="usernameTouched = true" />
            <span class="fhint">Lowercase letters, numbers and . _ - @ +</span>
          </div>
          <div class="fg"><label>Role</label>
            <div class="role-pick">
              <label :class="{ on: pf.role === 'employee' }"><input type="radio" value="employee" v-model="pf.role" /><strong>Employee</strong><span>Inbox, leads, pipeline, projects, templates, automation</span></label>
              <label :class="{ on: pf.role === 'admin' }"><input type="radio" value="admin" v-model="pf.role" /><strong>Admin</strong><span>Everything above plus Finance, Orders, Materials, Vendors and Team</span></label>
            </div>
          </div>
          <div class="fg" v-if="!editing"><label>Temporary password *</label>
            <div class="pw-row">
              <input v-model="pf.password" class="finp" style="flex:1" type="text" autocomplete="off" />
              <button type="button" class="btn-sm" @click="pf.password = generatePassword()">Generate</button>
            </div>
            <span class="fhint">At least 8 characters. They can change it themselves from the account menu after signing in.</span>
          </div>
          <label v-if="editing" class="check"><input type="checkbox" v-model="pf.active" /> Account is active <span class="fhint" style="margin-left:6px">(untick to block sign-in without deleting their history)</span></label>
          <p v-if="personError" class="err-text">{{ personError }}</p>
          <div class="modal-actions">
            <button class="btn-sm primary" :disabled="personBusy" @click="savePerson">{{ personBusy ? 'Saving…' : (editing ? 'Save changes' : 'Create account') }}</button>
            <button class="btn-sm" @click="closePerson">Cancel</button>
          </div>
        </template>
        <template v-else>
          <h3><i class="fas fa-circle-check" style="color:var(--crm-success)"></i> Account ready</h3>
          <p class="sub">Give {{ created.name }} these details. <strong>The password is shown only now</strong> — it can't be looked up later (an admin can reset it).</p>
          <div class="cred">
            <div><span>Sign in at</span><b>{{ origin }}</b></div>
            <div><span>Username</span><b>{{ created.username }}</b></div>
            <div><span>Password</span><b>{{ created.password }}</b></div>
          </div>
          <div class="modal-actions">
            <button class="btn-sm primary" @click="copyCreds">{{ copied ? 'Copied ✓' : 'Copy details' }}</button>
            <button class="btn-sm" @click="closePerson">Done</button>
          </div>
        </template>
      </div>
    </div>

    <!-- ═══ RESET PASSWORD ═══ -->
    <div v-if="resetFor" class="modal-bg" @click.self="resetFor = null">
      <div class="modal" role="dialog" aria-modal="true">
        <template v-if="!resetDone">
          <h3>Reset password</h3>
          <p class="sub">Set a new temporary password for <strong>{{ resetFor.display_name }}</strong>. They'll be signed out everywhere and must use the new one.</p>
          <div class="fg"><label>New password</label>
            <div class="pw-row">
              <input v-model="resetPw" class="finp" style="flex:1" type="text" autocomplete="off" />
              <button type="button" class="btn-sm" @click="resetPw = generatePassword()">Generate</button>
            </div>
          </div>
          <p v-if="resetError" class="err-text">{{ resetError }}</p>
          <div class="modal-actions">
            <button class="btn-sm primary" :disabled="resetBusy" @click="doReset">{{ resetBusy ? 'Saving…' : 'Reset password' }}</button>
            <button class="btn-sm" @click="resetFor = null">Cancel</button>
          </div>
        </template>
        <template v-else>
          <h3><i class="fas fa-circle-check" style="color:var(--crm-success)"></i> Password reset</h3>
          <p class="sub">New password for <strong>{{ resetFor.display_name }}</strong> (shown only now):</p>
          <div class="cred"><div><span>Password</span><b>{{ resetPw }}</b></div></div>
          <div class="modal-actions"><button class="btn-sm primary" @click="resetFor = null">Done</button></div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useCrmThemeStore } from '@/stores/crmThemeStore'
import { useInboxUnread } from '@/composables/useInboxUnread'
import { useAdminAuthStore } from '@/stores/adminAuthStore'
import { useCrmUser, initials } from '@/composables/useCrmUser'
import { crmJson } from '@/services/crmApi'
import { describeAction, entityName, summarizeMeta, relTime, fullTime } from '@/services/crmHistory'
import CrmUserChip from '@/components/crm/CrmUserChip.vue'
import CrmTeamLink from '@/components/crm/CrmTeamLink.vue'
import CrmBroadcastLink from '@/components/crm/CrmBroadcastLink.vue'

const crmTheme = useCrmThemeStore()
const { unreadCount } = useInboxUnread()
const adminAuth = useAdminAuthStore()
const { user: me, isPersonal, isEmployeeOnly } = useCrmUser()

const adminPassword = ref('')
const showAdminPassword = ref(false)
const adminError = ref('')
const loading = ref(false)
const tab = ref('people')
const origin = typeof location !== 'undefined' ? location.origin : ''

const api = (path, opts = {}) => crmJson(path, { admin: true, ...opts })

// ── people ──────────────────────────────────────────────
const users = ref([])
const migrationPending = ref(false)
const activeCount = computed(() => users.value.filter((u) => u.active).length)
const isMe = (u) => !!me.value && me.value.id === u.id

async function loadUsers() {
  try {
    const r = await api('/users')
    users.value = r.rows || []
    migrationPending.value = false
  } catch (e) {
    if (e.status === 503 || e.data?.migrationPending) { migrationPending.value = true; users.value = [] }
    else console.error('[crm-team] users', e)
  }
}

// ── sign-in method switch ──
const sharedDisabled = ref(false)
const activeAdmins = ref(0)
const secBusy = ref(false)
const secError = ref('')
const canSwitch = computed(() => isPersonal.value && me.value?.role === 'admin' && activeAdmins.value > 0)
const switchHint = computed(() => {
  if (!isPersonal.value) return 'Sign in with your own admin account first (sign out, then sign in with your username) — otherwise this could lock you out.'
  if (activeAdmins.value === 0) return 'Create at least one active admin account first.'
  return ''
})
async function loadSecurity() {
  try {
    const s = await api('/users/security/status')
    sharedDisabled.value = !!s.sharedLoginDisabled
    activeAdmins.value = s.activeAdmins || 0
  } catch (e) { if (e.status !== 503) console.error('[crm-team] security', e) }
}
async function setSharedDisabled(disabled) {
  secError.value = ''
  const msg = disabled
    ? 'Require personal logins?\n\nThe shared passwords will stop working in the CRM. Everyone who should keep access needs their own account first — anyone without one is locked out until an admin adds them.'
    : 'Allow the shared passwords in the CRM again?'
  if (!confirm(msg)) return
  secBusy.value = true
  try {
    const r = await api('/users/security/shared-login', { method: 'POST', body: { disabled } })
    sharedDisabled.value = !!r.sharedLoginDisabled
  } catch (e) { secError.value = e.message || 'Could not change the setting.' } finally { secBusy.value = false }
}

// ── add / edit person ──
const personOpen = ref(false)
const editing = ref(null)
const personBusy = ref(false)
const personError = ref('')
const created = ref(null)
const copied = ref(false)
const usernameTouched = ref(false)
const pf = reactive({ displayName: '', username: '', role: 'employee', password: '', active: true })

function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint32Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (n) => chars[n % chars.length]).join('')
}
function suggestUsername() {
  if (editing.value || usernameTouched.value) return
  pf.username = pf.displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')
}
function openAdd() {
  Object.assign(pf, { displayName: '', username: '', role: users.value.length ? 'employee' : 'admin', password: generatePassword(), active: true })
  editing.value = null; usernameTouched.value = false; personError.value = ''; created.value = null; copied.value = false
  personOpen.value = true
}
function openEdit(u) {
  Object.assign(pf, { displayName: u.display_name, username: u.username, role: u.role, password: '', active: u.active })
  editing.value = u; personError.value = ''; created.value = null
  personOpen.value = true
}
function closePerson() { personOpen.value = false; created.value = null }
async function savePerson() {
  personError.value = ''
  if (!pf.displayName.trim()) { personError.value = 'Enter the person\'s full name.'; return }
  personBusy.value = true
  try {
    if (editing.value) {
      await api(`/users/${editing.value.id}`, { method: 'PATCH', body: { displayName: pf.displayName, role: pf.role, active: pf.active } })
      personOpen.value = false
    } else {
      await api('/users', { method: 'POST', body: { displayName: pf.displayName, username: pf.username, role: pf.role, password: pf.password } })
      created.value = { name: pf.displayName.trim(), username: pf.username.trim().toLowerCase(), password: pf.password }
    }
    await Promise.all([loadUsers(), loadSecurity()])
  } catch (e) { personError.value = e.message || 'Could not save.' } finally { personBusy.value = false }
}
async function copyCreds() {
  const c = created.value
  const text = `Luminus CRM sign-in\n${origin}\nUsername: ${c.username}\nPassword: ${c.password}`
  try { await navigator.clipboard.writeText(text); copied.value = true; setTimeout(() => { copied.value = false }, 2500) } catch { /* clipboard blocked */ }
}

// ── reset password ──
const resetFor = ref(null)
const resetPw = ref('')
const resetBusy = ref(false)
const resetError = ref('')
const resetDone = ref(false)
function openReset(u) { resetFor.value = u; resetPw.value = generatePassword(); resetError.value = ''; resetDone.value = false }
async function doReset() {
  resetError.value = ''; resetBusy.value = true
  try {
    await api(`/users/${resetFor.value.id}/reset-password`, { method: 'POST', body: { password: resetPw.value } })
    resetDone.value = true
  } catch (e) { resetError.value = e.message || 'Could not reset the password.' } finally { resetBusy.value = false }
}

// ── activity feed ──
const days = ref(30)
const feed = ref([])
const actLoading = ref(false)
const actPending = ref(false)
const fUser = ref('')
const fType = ref('')
const fText = ref('')

const TYPE_LABELS = { expense: 'Expenses', order: 'Orders', material: 'Materials', vendor: 'Vendors', purchase_order: 'Purchase orders', lead: 'Leads', thread: 'Inbox', template: 'Reply templates', user: 'Accounts', settings: 'Security settings', broadcast: 'Announcements' }
const typeLabel = (t) => TYPE_LABELS[t] || entityName(t)

async function loadActivity() {
  actLoading.value = true
  try {
    const r = await api(`/history/activity?days=${days.value}&limit=500`)
    actPending.value = !!r.migrationPending
    feed.value = (r.rows || []).map((row) => {
      const m = summarizeMeta(row)
      return { ...row, ...m }
    })
  } catch (e) { console.error('[crm-team] activity', e) } finally { actLoading.value = false }
}
function switchToActivity() { tab.value = 'activity'; if (!feed.value.length) loadActivity() }

const feedPeople = computed(() => [...new Set(feed.value.map((e) => e.employee_name).filter(Boolean))].sort())
const feedTypes = computed(() => [...new Set(feed.value.map((e) => e.entity_type).filter(Boolean))].sort())
const visibleFeed = computed(() => {
  const q = fText.value.trim().toLowerCase()
  return feed.value.filter((e) => {
    if (fUser.value && e.employee_name !== fUser.value) return false
    if (fType.value && e.entity_type !== fType.value) return false
    if (!q) return true
    const hay = [e.employee_name, e.label, e.detail, e.action, ...e.changes.flatMap((c) => [c.label, c.from, c.to])].join(' ').toLowerCase()
    return hay.includes(q)
  })
})

async function loadAll() {
  loading.value = true
  await Promise.all([loadUsers(), loadSecurity(), tab.value === 'activity' ? loadActivity() : Promise.resolve()])
  loading.value = false
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
.crm-nav a.router-link-exact-active { color: var(--crm-accent); background: var(--crm-accent-soft-bg); }
.crm-theme-toggle { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; flex: none; }
.crm-theme-toggle:hover { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
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
.err-text { color: var(--crm-danger); font-size: 11.5px; margin-top: 8px; }

.wrap { max-width: 1080px; margin: 0 auto; padding: 22px 18px 60px; display: flex; flex-direction: column; gap: 18px; width: 100%; box-sizing: border-box; }
.banner { display: flex; gap: 12px; align-items: flex-start; background: var(--crm-warn-bg); border: 1px solid var(--crm-warn-border); color: var(--crm-text-secondary); border-radius: 10px; padding: 12px 16px; font-size: 12.5px; line-height: 1.55; }
.banner i { color: var(--crm-warn); margin-top: 2px; }
.banner code { background: var(--crm-badge-bg); padding: 1px 6px; border-radius: 4px; font-size: 11.5px; }

.tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--crm-border); }
.tabs button { background: none; border: 0; border-bottom: 2px solid transparent; color: var(--crm-text-muted); font: inherit; font-size: 13px; font-weight: 600; padding: 9px 14px; cursor: pointer; margin-bottom: -1px; }
.tabs button i { margin-right: 6px; font-size: 12px; }
.tabs button:hover { color: var(--crm-text); }
.tabs button.on { color: var(--crm-accent); border-bottom-color: var(--crm-accent); }

.card { background: var(--crm-panel-bg); border: 1px solid var(--crm-border); border-radius: 12px; padding: 18px 20px; }
.card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.card-head h2 { margin: 0; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.card-head h2 i { color: var(--crm-accent); font-size: 13px; }
.sub { font-size: 12px; color: var(--crm-text-muted); margin: 4px 0 14px; line-height: 1.6; }
.sub strong { color: var(--crm-text-secondary); }
.filter-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.finp { background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 7px; padding: 7px 10px; font: inherit; font-size: 12.5px; }
.finp:focus { outline: none; border-color: var(--crm-accent); }
.btn-sm { display: inline-block; background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); border-radius: 6px; font-size: 11.5px; font-weight: 600; padding: 7px 12px; cursor: pointer; text-decoration: none; }
.btn-sm:hover:not(:disabled) { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
.btn-sm:disabled { opacity: .5; cursor: default; }
.btn-sm.primary { background: var(--crm-accent); color: var(--crm-accent-contrast); border-color: var(--crm-accent); }
.btn-sm.primary:hover:not(:disabled) { background: var(--crm-accent-hover); }
.hint { font-size: 11.5px; color: var(--crm-text-muted); max-width: 520px; line-height: 1.5; }

.pill { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; }
.pill.ok { background: var(--crm-success-bg, rgba(34, 197, 94, .14)); color: var(--crm-success); }
.pill.warn { background: var(--crm-warn-bg); color: var(--crm-warn); }

.tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tbl thead th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; padding: 7px 8px; border-bottom: 1px solid var(--crm-border); }
.tbl tbody td { padding: 11px 8px; border-bottom: 1px solid var(--crm-row-border); vertical-align: middle; }
.tbl tr.off td { opacity: .55; }
.tbl .muted { color: var(--crm-text-muted); }
.tbl .small { font-size: 11.5px; }
.tbl .right { text-align: right; white-space: nowrap; }
.p-avatar { display: inline-flex; width: 26px; height: 26px; border-radius: 50%; background: var(--crm-accent-soft-bg); color: var(--crm-accent); border: 1px solid var(--crm-accent); font-size: 10px; font-weight: 800; align-items: center; justify-content: center; margin-right: 8px; vertical-align: middle; flex: none; }
.p-avatar.big { width: 32px; height: 32px; font-size: 11px; margin: 0; }
.p-avatar.shared { background: var(--crm-hover-bg); color: var(--crm-text-muted); border-color: var(--crm-border-strong); }
.me-tag { margin-left: 8px; font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--crm-accent); }
.role-badge { font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); }
.role-badge.admin { background: var(--crm-accent-soft-bg); color: var(--crm-accent); }
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 7px; }
.status-dot.on { background: var(--crm-success); }
.status-dot.off { background: var(--crm-text-dim); }

.empty { padding: 30px 10px; text-align: center; color: var(--crm-text-faint); }
.empty i { font-size: 22px; opacity: .5; }
.empty p { margin: 8px 0 0; font-size: 12.5px; color: var(--crm-text-muted); }

.tag-inline { font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; background: var(--crm-warn-bg); color: var(--crm-warn); cursor: help; }
.feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.feed-item { display: flex; gap: 12px; padding: 13px 0; border-bottom: 1px solid var(--crm-row-border); }
.feed-item:last-child { border-bottom: 0; }
.feed-body { min-width: 0; flex: 1; }
.feed-line { font-size: 13px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.verb { color: var(--crm-text-secondary); }
.target { color: var(--crm-text); font-weight: 600; overflow-wrap: anywhere; }
.feed-time { font-size: 11px; color: var(--crm-text-dim); margin-top: 2px; }
.feed-detail { font-size: 12.5px; color: var(--crm-text-secondary); margin-top: 6px; }
.changes { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.changes li { font-size: 12px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; font-variant-numeric: tabular-nums; }
.changes i { font-size: 10px; color: var(--crm-text-dim); }
.fld { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--crm-text-muted); min-width: 92px; display: inline-block; }
.from { color: var(--crm-text-muted); text-decoration: line-through; text-decoration-color: var(--crm-border-strong); overflow-wrap: anywhere; }
.to { color: var(--crm-text); font-weight: 600; overflow-wrap: anywhere; }

.modal-bg { position: fixed; inset: 0; background: rgba(0, 0, 0, .6); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.modal { background: var(--crm-header-bg); border: 1px solid var(--crm-border-header); border-radius: 14px; padding: 26px 28px; width: 500px; max-width: 100%; max-height: 90vh; overflow-y: auto; }
.modal h3 { font-family: 'Syne', sans-serif; font-size: 18px; margin: 0 0 16px; display: flex; align-items: center; gap: 8px; }
.fg { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
.fg > label { font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--crm-text-muted); }
.fhint { font-size: 11px; color: var(--crm-text-dim); line-height: 1.45; }
.pw-row { display: flex; gap: 8px; }
.check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--crm-text-secondary); margin-bottom: 8px; }
.role-pick { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.role-pick label { display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--crm-border-strong); border-radius: 9px; padding: 10px 12px; cursor: pointer; font-size: 12.5px; text-transform: none; letter-spacing: 0; color: var(--crm-text); }
.role-pick label span { font-size: 11px; font-weight: 400; color: var(--crm-text-muted); line-height: 1.4; }
.role-pick label input { position: absolute; opacity: 0; pointer-events: none; }
.role-pick label.on { border-color: var(--crm-accent); background: var(--crm-accent-soft-bg); }
.role-pick label:focus-within { outline: 2px solid var(--crm-accent); outline-offset: 1px; }
.modal-actions { display: flex; gap: 10px; margin-top: 16px; }
.cred { display: flex; flex-direction: column; gap: 8px; background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); border-radius: 9px; padding: 12px 14px; margin: 4px 0 4px; }
.cred div { display: flex; justify-content: space-between; gap: 14px; font-size: 13px; }
.cred span { color: var(--crm-text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; font-weight: 700; }
.cred b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; overflow-wrap: anywhere; text-align: right; }

@media (max-width: 720px) { .role-pick { grid-template-columns: 1fr; } }
</style>
