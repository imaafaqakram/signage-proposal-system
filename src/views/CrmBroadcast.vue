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
      <button
        v-if="adminAuth.isAuthenticated && pace"
        class="master-switch"
        :class="{ on: pace.sendingEnabled }"
        type="button"
        :disabled="switchBusy || migrationPending"
        :aria-pressed="pace.sendingEnabled"
        :title="pace.sendingEnabled ? 'Sending is ON — click to turn off' : 'Sending is OFF — nothing will be emailed'"
        @click="toggleSending"
      >
        <span class="ms-dot"></span>{{ pace.sendingEnabled ? 'Sending ON' : 'Sending OFF' }}
      </button>
      <div class="crm-counts" v-if="adminAuth.isAuthenticated">
        <span>{{ activeBroadcasts }} sending now</span>
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
          <h2>Announcements</h2>
          <template v-if="isEmployeeOnly">
            <p>Emailing all clients is limited to admins. Ask an admin if you need an announcement sent.</p>
          </template>
          <template v-else>
            <p>Email your clients about policy changes or maintenance — admin password required.</p>
            <form class="gate-form" @submit.prevent="unlockAdmin">
              <input v-model="adminPassword" :type="showAdminPassword ? 'text' : 'password'" placeholder="Admin password" />
              <button type="button" class="pw-toggle" @click="showAdminPassword = !showAdminPassword" tabindex="-1"><i class="fas" :class="showAdminPassword ? 'fa-eye-slash' : 'fa-eye'"></i></button>
              <button type="submit" :disabled="adminAuth.loading">Unlock</button>
            </form>
            <p v-if="adminError" class="err-text">{{ adminError }}</p>
          </template>
        </div>
      </div>

      <!-- ═══ ANNOUNCEMENTS ═══ -->
      <div v-else class="wrap">
        <div v-if="migrationPending" class="banner">
          <i class="fas fa-triangle-exclamation"></i>
          <div><strong>One database update is needed before announcements can be sent.</strong>
            Run <code>018_crm_broadcasts.sql</code> once in the Supabase SQL editor, then reload this page.</div>
        </div>
        <div v-else-if="pace && pace.dryRun" class="banner">
          <i class="fas fa-flask"></i>
          <div><strong>Test mode.</strong> No real emails are sent from this server.</div>
        </div>
        <div v-else-if="pace && !pace.workerEnabled" class="banner">
          <i class="fas fa-triangle-exclamation"></i>
          <div><strong>Automatic sending is switched off on this server.</strong>
            Announcements can be queued, but nothing is emailed until <code>CRM_BROADCAST_WORKER=true</code> is set and the server restarted.</div>
        </div>
        <div v-else-if="pace && !pace.sendingEnabled" class="banner off">
          <i class="fas fa-power-off"></i>
          <div><strong>Sending is turned OFF.</strong> Nothing will be emailed to clients — including anything already
            queued below — until you turn it on with the switch at the top of the page.</div>
        </div>

        <!-- COMPOSE -->
        <section class="card">
          <div class="card-head"><h2><i class="fas fa-pen-to-square"></i> Write your message</h2></div>
          <p class="sub">Goes out under your company name, in the same branded layout as your follow-up emails. Use <code>{{ nameTag }}</code> to greet each client by name.</p>

          <div class="chips">
            <span class="chips-l">Start from</span>
            <button v-for="t in TEMPLATES" :key="t.key" type="button" class="chip" @click="applyTemplate(t)">{{ t.label }}</button>
          </div>

          <div class="fg"><label for="bc-subject">Subject</label>
            <input id="bc-subject" v-model="subject" class="finp" style="width:100%" maxlength="200" placeholder="e.g. An update to our Terms & Policies" />
          </div>
          <div class="fg"><label for="bc-body">Message</label>
            <textarea id="bc-body" v-model="body" class="finp" rows="10" style="width:100%;resize:vertical;line-height:1.55" placeholder="Hi {{name}}, …"></textarea>
            <span class="fhint">Leave a blank line between paragraphs. Web addresses become clickable links.</span>
          </div>
          <div v-if="placeholders.length" class="warn-line"><i class="fas fa-triangle-exclamation"></i> Fill in the [bracketed] parts before sending: {{ placeholders.join(', ') }}</div>

          <div class="filter-bar" style="margin:6px 0 0">
            <button class="btn-sm" type="button" :disabled="!canPreview" @click="togglePreview">{{ showPreview ? 'Hide preview' : 'Preview the email' }}</button>
          </div>
          <div v-if="showPreview" class="preview">
            <div class="preview-subj"><span>Subject</span> {{ previewSubject }}</div>
            <iframe class="preview-frame" sandbox="" :srcdoc="previewHtml" title="Email preview"></iframe>
          </div>
        </section>

        <!-- AUDIENCE -->
        <section class="card">
          <div class="card-head"><h2><i class="fas fa-users"></i> Who gets it</h2>
            <span class="count-pill" style="margin-left:auto">{{ selectedList.length }} selected</span>
          </div>
          <p class="sub">Clients you're actively in touch with. Untick anyone who shouldn't receive it.</p>

          <div class="groups">
            <label class="group" :class="{ on: groups.customers }">
              <input type="checkbox" v-model="groups.customers" @change="applyGroups" />
              <span><strong>Customers</strong><em>Won deals or placed an order</em></span><b>{{ audience.counts.customers }}</b>
            </label>
            <label class="group" :class="{ on: groups.active }">
              <input type="checkbox" v-model="groups.active" @change="applyGroups" />
              <span><strong>In conversation</strong><em>Replied to you, or negotiating</em></span><b>{{ audience.counts.active }}</b>
            </label>
          </div>

          <div class="filter-bar">
            <input v-model="q" class="finp" placeholder="Search name or email…" style="flex:1;min-width:180px" />
            <button class="btn-sm" type="button" @click="setVisible(true)">Tick all shown</button>
            <button class="btn-sm" type="button" @click="setVisible(false)">Untick all shown</button>
          </div>

          <div v-if="audienceLoading" class="empty"><i class="fas fa-circle-notch fa-spin"></i><p>Loading clients…</p></div>
          <div v-else-if="!visible.length" class="empty"><i class="fas fa-user-slash"></i><p>{{ audience.recipients.length ? 'No one matches that.' : 'No engaged clients found yet.' }}</p></div>
          <div v-else class="tbl-scroll">
            <table class="tbl">
              <thead><tr><th style="width:32px"></th><th>Client</th><th>Email</th><th>Why they're included</th></tr></thead>
              <tbody>
                <tr v-for="r in visible" :key="r.email" :class="{ off: !selected.has(r.email) }">
                  <td><input type="checkbox" :checked="selected.has(r.email)" :aria-label="`Send to ${r.name || r.email}`" @change="toggle(r.email)" /></td>
                  <td>{{ r.name || '—' }}</td>
                  <td class="muted">{{ r.email }}</td>
                  <td><span v-for="g in r.groups" :key="g" class="tag" :class="g">{{ g === 'customers' ? 'Customer' : 'In conversation' }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- SEND -->
        <section class="card send-card">
          <div class="card-head"><h2><i class="fas fa-paper-plane"></i> Send</h2></div>
          <p class="pace">
            <i class="fas fa-gauge"></i>
            Emails go out <strong>{{ PER_HOUR }} per hour</strong>, automatically — no need to come back and click again.
            <template v-if="selectedList.length">
              <strong>{{ selectedList.length }}</strong> client{{ selectedList.length === 1 ? '' : 's' }} will take about <strong>{{ etaText }}</strong>.
            </template>
          </p>
          <p v-if="pace && pace.nextSlotAt" class="pace-note">The hourly limit is currently reached — the next emails go out at {{ timeOf(pace.nextSlotAt) }}.</p>

          <div class="test-row">
            <input v-model="testTo" type="email" class="finp" placeholder="Send a test to (your own email)" style="flex:1;min-width:200px" @keydown.enter.prevent="sendTest" />
            <button class="btn-sm" type="button" :disabled="testBusy" @click="sendTest">{{ testBusy ? 'Sending…' : 'Send test' }}</button>
          </div>
          <p v-if="testMsg" :class="testOk ? 'ok-text' : 'err-text'">{{ testMsg }}</p>

          <div class="send-row">
            <button class="btn-send" type="button" :disabled="!canSend || sending" @click="sendAnnouncement">
              <i class="fas" :class="sending ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'"></i>
              {{ sending ? 'Queuing…' : `Send to ${selectedList.length} client${selectedList.length === 1 ? '' : 's'}` }}
            </button>
            <span v-if="!canSend && !sending" class="hint">{{ sendHint }}</span>
          </div>
          <p v-if="sendError" class="err-text">{{ sendError }}</p>
          <p v-if="sendDone" class="ok-text">{{ sendDone }}</p>
        </section>

        <!-- HISTORY -->
        <section class="card">
          <div class="card-head"><h2><i class="fas fa-list-check"></i> Sent &amp; scheduled</h2>
            <span v-if="pace" class="count-pill" style="margin-left:auto" title="Emails sent in the last 60 minutes">{{ pace.usedLastHour }} / {{ pace.perHour }} this hour</span>
          </div>
          <div v-if="!broadcasts.length && !loading" class="empty"><i class="fas fa-inbox"></i><p>No announcements yet.</p></div>
          <div v-for="b in broadcasts" :key="b.id" class="bc">
            <div class="bc-top">
              <div class="bc-title">
                <strong>{{ b.subject }}</strong>
                <span class="status" :class="b.status">{{ statusLabel(b) }}</span>
              </div>
              <div class="bc-actions">
                <button v-if="b.status === 'sending'" class="btn-sm" @click="act(b, 'pause')">Pause</button>
                <button v-if="b.status === 'paused'" class="btn-sm primary" @click="act(b, 'resume')">Resume</button>
                <button v-if="b.status === 'sending' || b.status === 'paused'" class="btn-sm warn" @click="cancel(b)">Cancel the rest</button>
                <button class="btn-sm" @click="toggleDetail(b)">{{ open === b.id ? 'Hide' : 'Details' }}</button>
              </div>
            </div>
            <div class="bar" role="progressbar" :aria-valuenow="b.sent_count" :aria-valuemin="0" :aria-valuemax="b.total"><div :style="{ width: pct(b) + '%' }"></div></div>
            <div class="bc-meta">
              <span><strong>{{ b.sent_count }}</strong> of {{ b.total }} sent</span>
              <span v-if="b.failed_count" class="bad">{{ b.failed_count }} failed</span>
              <span v-if="b.skipped_count">{{ b.skipped_count }} skipped</span>
              <span v-if="b.status === 'sending'">{{ waiting(b) }} waiting · about {{ hoursLeft(b) }}</span>
              <span class="muted">By {{ b.created_by || 'Unknown' }} · {{ relTime(b.created_at) }}</span>
            </div>

            <div v-if="open === b.id" class="bc-detail">
              <div v-if="detailLoading" class="muted small">Loading…</div>
              <template v-else-if="detail">
                <div class="detail-msg"><span>Message</span><pre>{{ detail.broadcast.body }}</pre></div>
                <table class="tbl">
                  <thead><tr><th>Client</th><th>Email</th><th>Status</th><th>Time</th></tr></thead>
                  <tbody>
                    <tr v-for="r in detail.recipients" :key="r.email">
                      <td>{{ r.name || '—' }}</td>
                      <td class="muted">{{ r.email }}</td>
                      <td><span class="rstat" :class="r.status">{{ r.status === 'pending' ? 'Waiting' : r.status }}</span><div v-if="r.error" class="err-line">{{ r.error }}</div></td>
                      <td class="muted small">{{ r.sent_at ? fullTime(r.sent_at) : '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </template>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useCrmThemeStore } from '@/stores/crmThemeStore'
import { useInboxUnread } from '@/composables/useInboxUnread'
import { useAdminAuthStore } from '@/stores/adminAuthStore'
import { useCrmUser } from '@/composables/useCrmUser'
import { crmJson } from '@/services/crmApi'
import { relTime, fullTime } from '@/services/crmHistory'
import CrmUserChip from '@/components/crm/CrmUserChip.vue'
import CrmTeamLink from '@/components/crm/CrmTeamLink.vue'
import CrmBroadcastLink from '@/components/crm/CrmBroadcastLink.vue'

const crmTheme = useCrmThemeStore()
const { unreadCount } = useInboxUnread()
const adminAuth = useAdminAuthStore()
const { isEmployeeOnly } = useCrmUser()

const PER_HOUR = 30
const nameTag = '{{name}}'
const api = (path, opts = {}) => crmJson(`/broadcasts${path}`, { admin: true, ...opts })

const adminPassword = ref('')
const showAdminPassword = ref(false)
const adminError = ref('')
const loading = ref(false)
const migrationPending = ref(false)

// ── compose ──
const TEMPLATES = [
  {
    key: 'terms', label: 'Terms & policy update',
    subject: 'An update to our Terms & Policies',
    body: `Hi {{name}},

We've updated our Terms & Policies. The changes take effect on [date].

The main updates:
• [first change]
• [second change]

You can read the full details here: [link]

You don't need to do anything. If you have any questions, just reply to this email and we'll be happy to help.

Thank you for being a valued client.`
  },
  {
    key: 'maintenance', label: 'Website maintenance',
    subject: 'Scheduled maintenance on [date]',
    body: `Hi {{name}},

Our website will be undergoing scheduled maintenance on [date] from [start time] to [end time] ([timezone]).

During this window, [what will be unavailable]. Any orders or proposals already in progress are safe and will not be affected.

If you need anything urgent in the meantime, just reply to this email or call us.

Thank you for your patience.`
  },
  {
    key: 'closure', label: 'Holiday closure',
    subject: 'Our holiday hours',
    body: `Hi {{name}},

We'll be closed from [start date] to [end date] for [holiday]. We'll be back and answering emails on [return date].

If you have a project that's time-sensitive, please let us know before [cutoff date] so we can plan around it.

Thank you, and happy holidays!`
  }
]
const subject = ref('')
const body = ref('')
function applyTemplate(t) {
  if ((subject.value || body.value) && !confirm('Replace what you\'ve written with this template?')) return
  subject.value = t.subject
  body.value = t.body
  showPreview.value = false
}
const placeholders = computed(() => {
  const found = `${subject.value}\n${body.value}`.match(/\[[^\]\n]{1,60}\]/g) || []
  return [...new Set(found)]
})

// ── preview (rendered by the server, so it's exactly what gets sent) ──
const showPreview = ref(false)
const previewHtml = ref('')
const previewSubject = ref('')
const canPreview = computed(() => subject.value.trim() && body.value.trim().length >= 5)
async function togglePreview() {
  if (showPreview.value) { showPreview.value = false; return }
  try {
    const r = await api('/preview', { method: 'POST', body: { subject: subject.value, body: body.value, name: 'Alex' } })
    previewHtml.value = r.html
    previewSubject.value = r.subject
    showPreview.value = true
  } catch (e) { sendError.value = e.message }
}

// ── audience ──
const audience = reactive({ recipients: [], counts: { customers: 0, active: 0, total: 0 } })
const audienceLoading = ref(false)
const groups = reactive({ customers: true, active: true })
const selected = ref(new Set())
const q = ref('')

function applyGroups() {
  selected.value = new Set(audience.recipients.filter((r) => r.groups.some((g) => groups[g])).map((r) => r.email))
}
async function loadAudience() {
  audienceLoading.value = true
  try {
    const a = await api('/audience')
    audience.recipients = a.recipients
    audience.counts = a.counts
    applyGroups()
  } catch (e) {
    if (e.data?.migrationPending || e.status === 503) migrationPending.value = true
    else console.error('[crm-broadcast] audience', e)
  } finally { audienceLoading.value = false }
}
const visible = computed(() => {
  const t = q.value.trim().toLowerCase()
  return audience.recipients.filter((r) => r.groups.some((g) => groups[g]) && (!t || `${r.name} ${r.email}`.toLowerCase().includes(t)))
})
const selectedList = computed(() => audience.recipients.filter((r) => selected.value.has(r.email)))
function toggle(email) {
  const s = new Set(selected.value)
  s.has(email) ? s.delete(email) : s.add(email)
  selected.value = s
}
function setVisible(on) {
  const s = new Set(selected.value)
  for (const r of visible.value) on ? s.add(r.email) : s.delete(r.email)
  selected.value = s
}

// ── pacing text ──
const etaText = computed(() => {
  const n = selectedList.value.length
  const hours = Math.max(0, Math.ceil(n / PER_HOUR) - 1)
  if (n <= PER_HOUR) return 'a couple of minutes to go out'
  return `${hours + 1} hours to reach everyone (the first ${PER_HOUR} go out right away)`
})
const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

// ── test email ──
const testTo = ref('')
const testBusy = ref(false)
const testMsg = ref('')
const testOk = ref(false)
async function sendTest() {
  testMsg.value = ''
  testBusy.value = true
  try {
    await api('/test', { method: 'POST', body: { to: testTo.value, subject: subject.value, body: body.value } })
    testOk.value = true
    testMsg.value = `Test sent to ${testTo.value}. Check that inbox (and spam) to see how it looks.`
  } catch (e) { testOk.value = false; testMsg.value = e.message } finally { testBusy.value = false }
}

// ── send ──
const sending = ref(false)
const sendError = ref('')
const sendDone = ref('')
const canSend = computed(() => subject.value.trim() && body.value.trim().length >= 5 && selectedList.value.length > 0 && !placeholders.value.length && !migrationPending.value && !!pace.value?.sendingEnabled)
const sendHint = computed(() => {
  if (migrationPending.value) return 'Run the database update first.'
  if (pace.value && !pace.value.sendingEnabled) return 'Sending is off — flip the switch at the top of the page first.'
  if (!subject.value.trim() || body.value.trim().length < 5) return 'Write a subject and a message.'
  if (placeholders.value.length) return 'Replace the [bracketed] parts first.'
  if (!selectedList.value.length) return 'Tick at least one client.'
  return ''
})
async function sendAnnouncement() {
  sendError.value = ''; sendDone.value = ''
  const n = selectedList.value.length
  const msg = `Send "${subject.value.trim()}" to ${n} client${n === 1 ? '' : 's'}?\n\n` +
    (n > PER_HOUR
      ? `Emails go out ${PER_HOUR} per hour, starting now — it will take about ${Math.ceil(n / PER_HOUR)} hours to reach everyone. You can pause or cancel the rest from the list below.`
      : 'They will go out within a couple of minutes.') +
    '\n\nThis can\'t be recalled once an email has been sent.'
  if (!confirm(msg)) return
  sending.value = true
  try {
    const r = await api('/', { method: 'POST', body: { subject: subject.value, body: body.value, recipients: selectedList.value.map((x) => ({ email: x.email, name: x.name, leadId: x.leadId })) } })
    sendDone.value = `Queued for ${r.queued} client${r.queued === 1 ? '' : 's'}. ${r.queued > PER_HOUR ? `The first ${PER_HOUR} are going out now; the rest follow automatically, ${PER_HOUR} per hour.` : 'They\'re going out now.'}`
    subject.value = ''; body.value = ''; showPreview.value = false
    await loadList()
  } catch (e) { sendError.value = e.message } finally { sending.value = false }
}

// ── history / progress ──
const broadcasts = ref([])
const pace = ref(null)
const open = ref(null)
const detail = ref(null)
const detailLoading = ref(false)
const activeBroadcasts = computed(() => broadcasts.value.filter((b) => b.status === 'sending').length)
const switchBusy = ref(false)
async function toggleSending() {
  const turningOn = !pace.value?.sendingEnabled
  if (turningOn && !confirm('Turn ON announcement sending?\n\nAny announcements already queued will start going out immediately, up to 30 per hour.')) return
  switchBusy.value = true
  try {
    const r = await api('/toggle', { method: 'POST', body: { enabled: turningOn } })
    pace.value = { ...pace.value, sendingEnabled: r.sendingEnabled }
  } catch (e) { alert(e.message || 'Could not change the switch.') } finally { switchBusy.value = false }
}

const pct = (b) => (b.total ? Math.min(100, Math.round(((b.sent_count + b.failed_count + b.skipped_count) / b.total) * 100)) : 0)
const waiting = (b) => Math.max(0, b.total - b.sent_count - b.failed_count - b.skipped_count)
const hoursLeft = (b) => { const h = Math.ceil(waiting(b) / PER_HOUR); return h <= 1 ? 'an hour or less' : `${h} hours` }
const statusLabel = (b) => ({ sending: 'Sending', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled' }[b.status] || b.status)

async function loadList() {
  try {
    const [l, s] = await Promise.all([api('/'), api('/status')])
    broadcasts.value = l.broadcasts
    pace.value = s
    migrationPending.value = false
    if (open.value) refreshDetail()
  } catch (e) {
    if (e.data?.migrationPending || e.status === 503) migrationPending.value = true
    else console.error('[crm-broadcast] list', e)
  }
}
async function refreshDetail() {
  try { detail.value = await api(`/${open.value}`) } catch { /* keep what is shown */ }
}
async function toggleDetail(b) {
  if (open.value === b.id) { open.value = null; detail.value = null; return }
  open.value = b.id; detail.value = null; detailLoading.value = true
  await refreshDetail()
  detailLoading.value = false
}
async function act(b, action) {
  try { await api(`/${b.id}/${action}`, { method: 'POST' }); await loadList() } catch (e) { alert(e.message) }
}
async function cancel(b) {
  if (!confirm(`Cancel the rest of "${b.subject}"?\n\nEmails already sent can't be recalled. The ${waiting(b)} still waiting will not be sent.`)) return
  await act(b, 'cancel')
}

async function loadAll() {
  loading.value = true
  await Promise.all([loadList(), loadAudience()])
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

// Progress moves on its own while something is sending — no need to refresh by hand.
let timer = null
onMounted(async () => {
  await adminAuth.initialize()
  if (adminAuth.isAuthenticated) await loadAll()
  timer = setInterval(() => { if (adminAuth.isAuthenticated && (activeBroadcasts.value || open.value)) loadList() }, 15000)
})
onBeforeUnmount(() => clearInterval(timer))
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
.master-switch { display: flex; align-items: center; gap: 7px; background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-muted); height: 32px; padding: 0 13px; border-radius: 16px; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; flex: none; }
.master-switch:hover:not(:disabled) { border-color: var(--crm-text-muted); }
.master-switch:disabled { opacity: .6; cursor: default; }
.master-switch .ms-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--crm-text-dim); flex: none; }
.master-switch.on { background: var(--crm-success-bg, rgba(34, 197, 94, .14)); border-color: var(--crm-success); color: var(--crm-success); }
.master-switch.on .ms-dot { background: var(--crm-success); box-shadow: 0 0 6px var(--crm-success); }

.lock-wrap { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 57px); padding: 40px; }
.lock-card { background: var(--crm-panel-bg); border: 1px solid var(--crm-border); border-radius: 14px; padding: 40px 44px; text-align: center; max-width: 380px; }
.lock-icon { font-size: 28px; color: var(--crm-warn); margin-bottom: 14px; }
.lock-card h2 { font-size: 18px; margin-bottom: 6px; }
.lock-card p { font-size: 12.5px; color: var(--crm-text-muted); margin-bottom: 18px; line-height: 1.6; }
.gate-form { display: flex; gap: 8px; }
.gate-form input { flex: 1; background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 7px; padding: 9px 12px; font: inherit; font-size: 13px; }
.gate-form button { background: var(--crm-accent); color: var(--crm-accent-contrast); border: 0; font-weight: 700; font-size: 12.5px; padding: 9px 16px; border-radius: 7px; cursor: pointer; }
.pw-toggle { background: transparent !important; color: var(--crm-text-muted) !important; padding: 0 8px !important; font-weight: 400 !important; }
.err-text { color: var(--crm-danger); font-size: 12px; margin-top: 10px; }
.ok-text { color: var(--crm-success); font-size: 12px; margin-top: 10px; }

.wrap { max-width: 980px; margin: 0 auto; padding: 22px 18px 60px; display: flex; flex-direction: column; gap: 18px; width: 100%; box-sizing: border-box; }
.banner { display: flex; gap: 12px; align-items: flex-start; background: var(--crm-warn-bg); border: 1px solid var(--crm-warn-border); color: var(--crm-text-secondary); border-radius: 10px; padding: 12px 16px; font-size: 12.5px; line-height: 1.55; }
.banner i { color: var(--crm-warn); margin-top: 2px; }
.banner.off { background: var(--crm-badge-bg); border-color: var(--crm-border-strong); }
.banner.off i { color: var(--crm-text-muted); }
code { background: var(--crm-badge-bg); padding: 1px 6px; border-radius: 4px; font-size: 11.5px; }

.card { background: var(--crm-panel-bg); border: 1px solid var(--crm-border); border-radius: 12px; padding: 18px 20px; }
.card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.card-head h2 { margin: 0; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.card-head h2 i { color: var(--crm-accent); font-size: 13px; }
.sub { font-size: 12px; color: var(--crm-text-muted); margin: 4px 0 14px; line-height: 1.6; }
.count-pill { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; background: var(--crm-accent-soft-bg); color: var(--crm-accent); }
.filter-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.finp { background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 7px; padding: 8px 11px; font: inherit; font-size: 13px; box-sizing: border-box; }
.finp:focus { outline: none; border-color: var(--crm-accent); }
.btn-sm { display: inline-block; background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); border-radius: 6px; font-size: 11.5px; font-weight: 600; padding: 7px 12px; cursor: pointer; }
.btn-sm:hover:not(:disabled) { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
.btn-sm:disabled { opacity: .5; cursor: default; }
.btn-sm.primary { background: var(--crm-accent); color: var(--crm-accent-contrast); border-color: var(--crm-accent); }
.btn-sm.warn { border-color: var(--crm-warn-border); color: var(--crm-warn); }
.btn-sm.warn:hover:not(:disabled) { background: var(--crm-warn-bg); }
.muted { color: var(--crm-text-muted); }
.small { font-size: 11.5px; }

.chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.chips-l { font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--crm-text-dim); }
.chip { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); border-radius: 999px; font: inherit; font-size: 12px; font-weight: 600; padding: 5px 13px; cursor: pointer; }
.chip:hover { border-color: var(--crm-accent); color: var(--crm-text); }
.fg { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
.fg label { font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--crm-text-muted); }
.fhint { font-size: 11px; color: var(--crm-text-dim); }
.warn-line { font-size: 12px; color: var(--crm-warn); background: var(--crm-warn-bg); border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; line-height: 1.5; }
.preview { margin-top: 14px; border: 1px solid var(--crm-border); border-radius: 10px; overflow: hidden; background: #f1f5f9; }
.preview-subj { padding: 10px 14px; font-size: 12.5px; background: var(--crm-panel-bg); border-bottom: 1px solid var(--crm-border); color: var(--crm-text); }
.preview-subj span { font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--crm-text-muted); margin-right: 8px; }
.preview-frame { width: 100%; height: 580px; border: 0; display: block; background: #f1f5f9; }

.groups { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
.group { display: flex; align-items: center; gap: 12px; border: 1px solid var(--crm-border-strong); border-radius: 10px; padding: 12px 14px; cursor: pointer; }
.group.on { border-color: var(--crm-accent); background: var(--crm-accent-soft-bg); }
.group span { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.group strong { font-size: 13px; }
.group em { font-style: normal; font-size: 11px; color: var(--crm-text-muted); }
.group b { font-family: 'Syne', sans-serif; font-size: 20px; color: var(--crm-text); }
.tbl-scroll { max-height: 340px; overflow: auto; border: 1px solid var(--crm-border); border-radius: 10px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tbl thead th { position: sticky; top: 0; background: var(--crm-panel-bg); text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--crm-text-dim); font-weight: 700; padding: 8px 10px; border-bottom: 1px solid var(--crm-border); }
.tbl tbody td { padding: 9px 10px; border-bottom: 1px solid var(--crm-row-border); vertical-align: top; }
.tbl tr.off td { opacity: .5; }
.tag { font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); margin-right: 6px; }
.tag.customers { background: var(--crm-accent-soft-bg); color: var(--crm-accent); }
.empty { padding: 26px 10px; text-align: center; color: var(--crm-text-faint); }
.empty i { font-size: 22px; opacity: .5; }
.empty p { margin: 8px 0 0; font-size: 12.5px; color: var(--crm-text-muted); }

.pace { font-size: 13px; line-height: 1.6; color: var(--crm-text-secondary); margin: 6px 0 12px; }
.pace i { color: var(--crm-accent); margin-right: 6px; }
.pace strong { color: var(--crm-text); }
.pace-note { font-size: 12px; color: var(--crm-warn); margin: 0 0 12px; }
.test-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.send-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--crm-border); }
.btn-send { background: var(--crm-accent); color: var(--crm-accent-contrast); border: 0; border-radius: 9px; font: inherit; font-size: 14px; font-weight: 800; padding: 12px 24px; cursor: pointer; display: inline-flex; align-items: center; gap: 10px; }
.btn-send:hover:not(:disabled) { background: var(--crm-accent-hover); }
.btn-send:disabled { opacity: .45; cursor: default; }
.hint { font-size: 12px; color: var(--crm-text-muted); }

.bc { padding: 14px 0; border-top: 1px solid var(--crm-row-border); }
.bc:first-of-type { border-top: 0; }
.bc-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.bc-title { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 13.5px; }
.bc-title strong { overflow-wrap: anywhere; }
.bc-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.status { font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; padding: 2px 9px; border-radius: 999px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); flex: none; }
.status.sending { background: var(--crm-accent-soft-bg); color: var(--crm-accent); }
.status.paused { background: var(--crm-warn-bg); color: var(--crm-warn); }
.status.completed { color: var(--crm-success); }
.status.cancelled { color: var(--crm-text-muted); }
.bar { height: 7px; background: var(--crm-row-border); border-radius: 4px; overflow: hidden; margin: 10px 0 8px; }
.bar div { height: 100%; background: linear-gradient(90deg, var(--crm-accent), #0891b2); border-radius: 4px; transition: width .4s; }
.bc-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12px; color: var(--crm-text-secondary); }
.bad { color: var(--crm-danger); font-weight: 700; }
.bc-detail { margin-top: 12px; }
.detail-msg { margin-bottom: 12px; }
.detail-msg span { font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--crm-text-muted); }
.detail-msg pre { margin: 6px 0 0; white-space: pre-wrap; font: inherit; font-size: 12.5px; line-height: 1.55; color: var(--crm-text-secondary); background: var(--crm-input-bg); border: 1px solid var(--crm-border); border-radius: 8px; padding: 10px 12px; max-height: 200px; overflow: auto; }
.rstat { font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); }
.rstat.sent { color: var(--crm-success); }
.rstat.failed { color: var(--crm-danger); }
.err-line { font-size: 11px; color: var(--crm-danger); margin-top: 3px; max-width: 320px; overflow-wrap: anywhere; }

@media (max-width: 720px) { .groups { grid-template-columns: 1fr; } }
</style>
