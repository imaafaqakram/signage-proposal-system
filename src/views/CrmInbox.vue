<template>
  <div class="crm">
    <header class="crm-top">
      <div class="crm-brand">
        <span class="dot"></span> Luminus CRM
      </div>
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
      <div class="crm-counts" v-if="counts">
        <span>{{ counts.unread }} unread</span>
        <span>{{ counts.open }} open</span>
        <span>{{ counts.responded }} replied</span>
      </div>
      <button class="crm-refresh" @click="loadThreads(true)" :disabled="loadingList" title="Refresh">
        <i class="fas" :class="loadingList ? 'fa-circle-notch fa-spin' : 'fa-rotate'"></i>
      </button>
    </header>

    <div class="crm-body">
      <aside class="crm-list">
        <div class="crm-filters">
          <button v-for="f in filters" :key="f.key"
                  :class="{ active: status === f.key }"
                  @click="status = f.key; loadThreads(true)">{{ f.label }}</button>
        </div>

        <div class="crm-threads" v-if="threads.length">
          <button v-for="t in threads" :key="t.id"
                  class="crm-thread" :class="{ active: t.id === activeId, unread: t.unread_count > 0 }"
                  @click="openThread(t.id)">
            <div class="ct-row1">
              <span class="ct-avatar" :style="avatarStyle(t.lead_name || t.counterparty)">{{ initials(t.lead_name || t.counterparty) }}</span>
              <span class="ct-name">{{ t.lead_name || t.counterparty || 'Unknown' }}</span>
              <span class="ct-time">{{ fmtShort(t.last_message_at) }}</span>
            </div>
            <div class="ct-subject">{{ t.subject || '(no subject)' }}</div>
            <div class="ct-snippet" v-if="t.last_snippet">
              <span v-if="t.last_direction === 'outbound'" class="ct-you">You: </span>{{ t.last_snippet }}
            </div>
            <div class="ct-row3">
              <span class="ct-badge" :class="t.status">{{ t.status }}</span>
              <span v-if="t.unread_count > 0" class="ct-unread">{{ t.unread_count }}</span>
              <span class="ct-dir" v-if="t.last_direction">
                <i class="fas" :class="t.last_direction === 'inbound' ? 'fa-arrow-down' : 'fa-arrow-up'"></i>
              </span>
            </div>
          </button>
        </div>
        <div v-else-if="!loadingList" class="crm-empty">
          <i class="fas fa-inbox"></i>
          <p>No conversations yet.</p>
          <small>Emails appear here once the mailbox is connected and a client replies, or once a proposal goes out.</small>
        </div>
      </aside>

      <section class="crm-thread-view" v-if="active">
        <div class="tv-head">
          <div class="tv-head-who">
            <span class="tv-avatar" :style="avatarStyle(active.lead?.client_name || active.counterparty)">
              {{ initials(active.lead?.client_name || active.counterparty) }}
            </span>
            <div>
              <h2>{{ active.subject || '(no subject)' }}</h2>
              <p class="tv-meta">
                <strong>{{ active.lead?.client_name || active.counterparty }}</strong>
                <span v-if="active.counterparty"> &lt;{{ active.counterparty }}&gt;</span>
              </p>
            </div>
          </div>
          <div class="tv-actions">
            <button v-if="active.status !== 'archived'" @click="setStatus('archived')" title="Archive">
              <i class="fas fa-box-archive"></i>
            </button>
            <button v-else @click="setStatus('open')" title="Reopen">
              <i class="fas fa-box-open"></i>
            </button>
          </div>
        </div>

        <div class="tv-messages" ref="msgScroll">
          <template v-for="item in messageItems" :key="item._divider ? item.key : item.id">
            <div v-if="item._divider" class="msg-divider"><span>{{ item.label }}</span></div>

            <div v-else class="msg" :class="item.direction">
              <div class="msg-head">
                <span class="msg-avatar" :style="avatarStyle(senderKey(item))">{{ initials(senderKey(item)) }}</span>
                <span class="msg-from">{{ senderLabel(item) }}</span>
                <span class="msg-time">{{ fmtLong(item.sent_at) }}</span>
                <span v-if="item.is_auto_reply" class="msg-auto">auto-reply</span>
              </div>

              <div class="msg-body msg-body-html-wrap" v-if="item.body_html">
                <iframe class="msg-html-frame" :srcdoc="buildFrameDoc(item.body_html)"
                        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                        title="email content" @load="onFrameLoad"></iframe>
              </div>
              <div class="msg-body msg-body-text" v-else-if="item.body_text">
                <div class="msg-text-visible">{{ item._visibleText }}</div>
                <template v-if="item._quotedText">
                  <button type="button" class="msg-quote-toggle" @click="toggleQuote(item.id)">
                    <i class="fas" :class="openQuotes.has(item.id) ? 'fa-angle-up' : 'fa-ellipsis'"></i>
                    {{ openQuotes.has(item.id) ? 'Hide quoted text' : 'Show quoted text' }}
                  </button>
                  <div v-if="openQuotes.has(item.id)" class="msg-text-quoted">{{ item._quotedText }}</div>
                </template>
              </div>

              <div class="msg-atts" v-if="item.attachments && item.attachments.length">
                <span v-for="a in item.attachments" :key="a.id" class="msg-att">
                  <i class="fas" :class="a.kind === 'proposal-pdf' ? 'fa-file-pdf' : 'fa-paperclip'"></i>
                  {{ a.filename }}
                </span>
              </div>
            </div>
          </template>
        </div>

        <form class="tv-reply" @submit.prevent="sendReply">
          <textarea ref="replyEl" v-model="replyBody" placeholder="Write a reply…" rows="3" :disabled="sending"></textarea>

          <div v-if="linkOpen" class="tv-linkbox">
            <input v-model="linkLabel" type="text" placeholder="Link text (e.g. Payment link)" />
            <input v-model="linkUrl" type="url" placeholder="https://…" @keyup.enter.prevent="insertLink" />
            <button type="button" class="tv-link-insert" @click="insertLink" :disabled="!linkUrlValid">Insert</button>
            <button type="button" class="tv-link-cancel" @click="linkOpen = false">✕</button>
            <p v-if="linkUrl && !linkUrlValid" class="tv-link-hint">Must start with http:// or https://</p>
          </div>

          <div class="tv-reply-bar">
            <span class="tv-reply-to" v-if="active.counterparty">to {{ active.counterparty }}</span>
            <button type="button" class="tv-tpl-btn tv-link-btn" @click="openLink" title="Insert a link">
              <i class="fas fa-link"></i> Link
            </button>
            <div class="tv-templates" v-if="templates.length">
              <button type="button" class="tv-tpl-btn" @click="templatesOpen = !templatesOpen">
                Templates <i class="fas fa-caret-down"></i>
              </button>
              <div v-if="templatesOpen" class="tv-tpl-backdrop" @click="templatesOpen = false"></div>
              <ul v-if="templatesOpen" class="tv-tpl-menu">
                <li v-for="t in templates" :key="t.id">
                  <button type="button" @click="applyTemplate(t)">{{ t.name }}</button>
                </li>
              </ul>
            </div>
            <button type="submit" :disabled="sending || !replyBody.trim()">
              <i class="fas" :class="sending ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'"></i>
              {{ sending ? 'Sending' : 'Send' }}
            </button>
          </div>
          <p v-if="replyError" class="tv-reply-err">{{ replyError }}</p>
        </form>
      </section>

      <section class="crm-thread-view crm-thread-empty" v-else>
        <i class="fas fa-envelope-open-text"></i>
        <p>Select a conversation</p>
      </section>
    </div>
  </div>
</template>

<script setup>
import { useCrmThemeStore } from '@/stores/crmThemeStore'

const crmTheme = useCrmThemeStore()
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

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

const filters = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'responded', label: 'Replied' },
  { key: 'archived', label: 'Archived' }
]
const status = ref('all')
const threads = ref([])
const counts = ref(null)
const loadingList = ref(false)
const activeId = ref(null)
const active = ref(null)
const replyBody = ref('')
const sending = ref(false)
const replyError = ref('')
const templates = ref([])
const templatesOpen = ref(false)
const msgScroll = ref(null)
const replyEl = ref(null)
const linkOpen = ref(false)
const linkLabel = ref('')
const linkUrl = ref('')
const linkUrlValid = computed(() => /^https?:\/\/\S+/i.test(linkUrl.value.trim()))
const openQuotes = ref(new Set())

// Markers that start a quoted reply chain (Gmail/Outlook/Apple Mail all use one of
// these). Whichever marker appears earliest wins; if it'd cut off almost the whole
// message (a genuine reply that happens to start with e.g. "On the phone" text),
// skip the split rather than collapse real content.
const QUOTE_MARKERS = [
  /^-{2,}\s*original message\s*-{2,}\s*$/im,
  /^on .{0,160} wrote:\s*$/im,
  /^_{8,}\s*$/m,
  /^-{8,}\s*$/m,
  /^>.*$/m
]
function splitQuoted(text) {
  let cut = -1
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text)
    if (m && (cut === -1 || m.index < cut)) cut = m.index
  }
  if (cut < 20) return { visible: text, quoted: '' }
  return { visible: text.slice(0, cut).trimEnd(), quoted: text.slice(cut).trim() }
}
function toggleQuote(id) {
  const s = new Set(openQuotes.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  openQuotes.value = s
}

// Messages plus "Today / Yesterday / Sep 9" date dividers between days, and
// (for text-only messages) the visible/quoted split pre-computed once per message
// rather than re-running the regex scan on every render.
const messageItems = computed(() => {
  if (!active.value) return []
  const items = []
  let lastDay = null
  for (const m of active.value.messages) {
    const day = m.sent_at ? new Date(m.sent_at).toDateString() : null
    if (day && day !== lastDay) {
      items.push({ _divider: true, key: `d-${day}`, label: fmtDivider(m.sent_at) })
      lastDay = day
    }
    if (m.body_text && !m.body_html) {
      const { visible, quoted } = splitQuoted(m.body_text)
      items.push({ ...m, _visibleText: visible, _quotedText: quoted })
    } else {
      items.push(m)
    }
  }
  return items
})

function senderKey(m) {
  return m.direction === 'outbound' ? (m.from_name || 'You') : (m.from_name || m.from_addr || '')
}
function senderLabel(m) {
  return m.direction === 'outbound' ? 'You' : (m.from_name || m.from_addr || 'Unknown')
}
function initials(nameOrEmail) {
  const s = (nameOrEmail || '').trim()
  if (!s) return '?'
  if (s.includes('@')) return s[0].toUpperCase()
  const parts = s.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
function avatarStyle(nameOrEmail) {
  const s = (nameOrEmail || '?').toLowerCase()
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  const hue = hash % 360
  return { background: `hsl(${hue} 55% 20%)`, color: `hsl(${hue} 85% 75%)` }
}
function fmtDivider(iso) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], {
    weekday: 'long', month: 'short', day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  })
}

async function loadThreads(reset = false) {
  loadingList.value = true
  try {
    const { threads: t } = await api(`/threads?status=${status.value}&limit=100`)
    threads.value = t
    counts.value = await api('/counts')
    if (reset && activeId.value && !t.find((x) => x.id === activeId.value)) {
      active.value = null
      activeId.value = null
    }
  } catch (e) {
    console.error('[crm] loadThreads', e)
  } finally {
    loadingList.value = false
  }
}

// Auto-refresh: re-pull the thread list + counts on a timer so a new email
// surfaces (already sorted newest-first by the API) without a manual refresh.
// Silent and non-disruptive — skips while a request or a send is in flight, and
// only refreshes the open thread if it actually gained messages.
const POLL_MS = 45000
let pollTimer = null

async function softRefresh() {
  if (loadingList.value || sending.value) return
  try {
    const { threads: t } = await api(`/threads?status=${status.value}&limit=100`)
    threads.value = t
    counts.value = await api('/counts')
    if (activeId.value && active.value) {
      const row = t.find((x) => x.id === activeId.value)
      if (row && row.message_count > (active.value.messages?.length || 0)) {
        active.value = await api(`/threads/${activeId.value}`)
        await nextTick()
        if (msgScroll.value) msgScroll.value.scrollTop = msgScroll.value.scrollHeight
        api(`/threads/${activeId.value}/read`, { method: 'POST' }).catch(() => {})
        if (counts.value) counts.value = await api('/counts')
      }
    }
  } catch (e) {
    /* transient — don't spam the console every 45s */
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') softRefresh()
  }, POLL_MS)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}
function onVisible() {
  if (document.visibilityState === 'visible') softRefresh()
}

async function openThread(id) {
  activeId.value = id
  replyBody.value = ''
  replyError.value = ''
  try {
    active.value = await api(`/threads/${id}`)
    await api(`/threads/${id}/read`, { method: 'POST' })
    const row = threads.value.find((t) => t.id === id)
    if (row) row.unread_count = 0
    if (counts.value) counts.value = await api('/counts')
    await nextTick()
    if (msgScroll.value) msgScroll.value.scrollTop = msgScroll.value.scrollHeight
  } catch (e) {
    console.error('[crm] openThread', e)
  }
}

async function setStatus(s) {
  if (!active.value) return
  await api(`/threads/${active.value.id}/status`, { method: 'POST', body: JSON.stringify({ status: s }) })
  active.value.status = s
  await loadThreads()
}

async function sendReply() {
  if (!replyBody.value.trim() || !active.value) return
  sending.value = true
  replyError.value = ''
  try {
    await api(`/threads/${active.value.id}/reply`, { method: 'POST', body: JSON.stringify({ body: replyBody.value }) })
    replyBody.value = ''
    active.value = await api(`/threads/${active.value.id}`)
    await nextTick()
    if (msgScroll.value) msgScroll.value.scrollTop = msgScroll.value.scrollHeight
    await loadThreads()
  } catch (e) {
    replyError.value = e.message || 'Could not send.'
  } finally {
    sending.value = false
  }
}

// HTML emails render in a sandboxed iframe rather than inline v-html. Two reasons:
// (1) an email's own <style> block has to survive for it to look like anything —
// stripping it (the old approach) is why HTML emails rendered as plain unstyled
// text; keeping it via v-html would instead leak that CSS into the whole CRM page,
// since a <style> tag anywhere in a *connected* document applies document-wide.
// An iframe's srcdoc is its own separate document, so the email's styling only
// ever affects itself. (2) sandbox="allow-same-origin" (no allow-scripts, ever)
// means embedded <script> tags flat-out cannot execute, independent of whatever
// the regex stripping below catches or misses. allow-popups(-to-escape-sandbox)
// is only there so a real link/button in the email can still open a new tab.
function sanitizeHtmlKeepStyle(html) {
  const d = document.createElement('div')
  d.innerHTML = html
  d.querySelectorAll('script, iframe, object, embed, link[rel="import"], meta[http-equiv]').forEach((n) => n.remove())
  d.querySelectorAll('*').forEach((n) => {
    ;[...n.attributes].forEach((a) => {
      if (/^on/i.test(a.name)) n.removeAttribute(a.name)
      if (/^(href|src|action)$/i.test(a.name) && /^javascript:/i.test(a.value)) n.removeAttribute(a.name)
    })
  })
  return d.innerHTML
}
// Finds where a quoted reply chain starts inside an HTML email — Gmail/Apple Mail
// wrap it in <blockquote> (often inside a .gmail_quote/.protonmail_quote/etc div),
// Outlook instead puts an <hr> then a "From:/Sent:/To:/Subject:" header block. Cuts
// at that point and returns the tail separately so it can be collapsed behind a
// toggle, same idea as splitQuoted() above but walking the DOM instead of text.
function splitHtmlQuoted(html) {
  const d = document.createElement('div')
  d.innerHTML = html

  let cutNode = d.querySelector(
    'blockquote, .gmail_quote, .protonmail_quote, .yahoo_quoted, .OutlookMessageHeader, [id^="divRplyFwdMsg"]'
  )
  if (!cutNode) {
    for (const el of d.querySelectorAll('hr, div, p, table')) {
      const txt = (el.textContent || '').trim()
      if (/^From:\s/i.test(txt) && /Sent:\s/i.test(txt)) { cutNode = el; break }
      if (el.tagName === 'HR') {
        let sib = el.nextElementSibling
        for (let i = 0; sib && i < 3; i++, sib = sib.nextElementSibling) {
          if (/^From:\s/i.test((sib.textContent || '').trim())) { cutNode = el; break }
        }
        if (cutNode) break
      }
    }
  }
  if (!cutNode) return { visibleHtml: sanitizeHtmlKeepStyle(html), quotedHtml: '' }

  // Cut at the top-level block that contains the marker, not the marker itself —
  // so a wrapping "On ... wrote:" div goes into the collapsed section along with it.
  let top = cutNode
  while (top.parentElement && top.parentElement !== d) top = top.parentElement
  if (!top.parentElement) return { visibleHtml: sanitizeHtmlKeepStyle(html), quotedHtml: '' }

  const quotedWrap = document.createElement('div')
  let node = top
  while (node) {
    const next = node.nextSibling
    quotedWrap.appendChild(node)
    node = next
  }

  const visibleHtml = sanitizeHtmlKeepStyle(d.innerHTML)
  const quotedHtml = sanitizeHtmlKeepStyle(quotedWrap.innerHTML)
  // A false-positive match near the very top would collapse almost the whole email —
  // bail and show everything uncollapsed rather than risk hiding real content.
  if (visibleHtml.replace(/<[^>]+>/g, '').trim().length < 20) {
    return { visibleHtml: sanitizeHtmlKeepStyle(html), quotedHtml: '' }
  }
  return { visibleHtml, quotedHtml }
}

// The iframe sandbox deliberately has no allow-scripts, so the "Show quoted text"
// toggle can't be a click handler — it's the pure-CSS checkbox/label trick instead
// (a hidden checkbox + a `:checked ~ .qc { display: block }` sibling rule).
function buildFrameDoc(html) {
  const { visibleHtml, quotedHtml } = splitHtmlQuoted(html)
  const toggle = quotedHtml
    ? `<input type="checkbox" id="qt" class="qi"><label for="qt" class="ql"><span class="ql-more">&#8942; Show quoted text</span><span class="ql-less">Hide quoted text</span></label><div class="qc">${quotedHtml}</div>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
    html,body{margin:0;padding:14px;background:#fff;color:#1f2933;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;}
    img{max-width:100%;height:auto;}
    a{color:#0b7285;}
    table{max-width:100%;}
    .qi{display:none;}
    .qc{display:none;margin-top:10px;padding-top:10px;border-top:1px dashed #d7dce1;color:#5b6672;}
    .ql{display:inline-flex;align-items:center;cursor:pointer;font-size:11.5px;color:#5b6672;background:#f1f3f5;padding:4px 12px;border-radius:20px;margin-top:10px;user-select:none;}
    .ql:hover{background:#e7eaee;}
    .ql-less{display:none;}
    .qi:checked ~ .qc{display:block;}
    .qi:checked ~ .ql .ql-more{display:none;}
    .qi:checked ~ .ql .ql-less{display:inline;}
  </style></head><body>${visibleHtml}${toggle}</body></html>`
}
function onFrameLoad(e) {
  try {
    const doc = e.target.contentDocument
    if (!doc) return
    const resize = () => { e.target.style.height = doc.documentElement.scrollHeight + 4 + 'px' }
    resize()
    // The quote toggle inside the iframe is a no-script CSS checkbox (see
    // buildFrameDoc) — the iframe's own fixed pixel height doesn't grow with it,
    // so re-measure from out here whenever it flips. Attaching a listener into the
    // iframe's DOM from the parent is fine even though scripts inside it can't run —
    // allow-scripts only blocks <script> tags authored in the email itself.
    const cb = doc.querySelector('.qi')
    if (cb) cb.addEventListener('change', () => requestAnimationFrame(resize))
  } catch (err) {
    /* cross-origin edge case — leave the default min-height */
  }
}

function fmtShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
function fmtLong(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

async function loadTemplates() {
  try {
    const { templates: rows } = await api('/templates')
    templates.value = rows || []
  } catch (e) {
    console.error('[crm] loadTemplates', e)
  }
}

function applyTemplate(t) {
  const current = replyBody.value
  replyBody.value = current.trim() ? `${current.replace(/\s*$/, '')}\n\n${t.body}` : t.body
  templatesOpen.value = false
}

function openLink() {
  linkLabel.value = ''
  linkUrl.value = ''
  linkOpen.value = true
  templatesOpen.value = false
}

// Inserts a [label](url) token at the cursor. The server turns that into a real
// <a> in the HTML email and "label: url" in the plain-text part.
function insertLink() {
  if (!linkUrlValid.value) return
  const url = linkUrl.value.trim()
  const label = (linkLabel.value.trim() || url).replace(/[[\]()]/g, '')
  const token = `[${label}](${url})`
  const el = replyEl.value
  const cur = replyBody.value
  if (el && typeof el.selectionStart === 'number') {
    const s = el.selectionStart
    const e = el.selectionEnd
    const needsSpace = s > 0 && !/\s$/.test(cur.slice(0, s))
    const ins = (needsSpace ? ' ' : '') + token
    replyBody.value = cur.slice(0, s) + ins + cur.slice(e)
    nextTick(() => {
      el.focus()
      const pos = s + ins.length
      el.setSelectionRange(pos, pos)
    })
  } else {
    replyBody.value = (cur.trim() ? cur.replace(/\s*$/, '') + ' ' : '') + token
  }
  linkOpen.value = false
}

onMounted(async () => {
  loadTemplates()
  await loadThreads(true)
  const deep = Number(route.query.thread)
  if (deep) openThread(deep)
  startPolling()
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
})

onUnmounted(() => {
  stopPolling()
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
})
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
.crm-counts { display: flex; gap: 14px; font-size: 12.5px; color: var(--crm-text-muted); margin-left: auto; }
.crm-refresh { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; }
.crm-refresh:hover { background: var(--crm-hover-bg-strong); }

.crm-body { flex: 1; display: flex; min-height: 0; }
.crm-list { width: 340px; flex: none; border-right: 1px solid var(--crm-border-header); display: flex; flex-direction: column; background: var(--crm-panel-bg); }
.crm-filters { display: flex; padding: 8px; gap: 4px; border-bottom: 1px solid var(--crm-border-header); }
.crm-filters button { flex: 1; background: transparent; border: 0; color: var(--crm-text-muted); font-size: 12px; font-weight: 600; padding: 6px 4px; border-radius: 5px; cursor: pointer; }
.crm-filters button.active { background: var(--crm-hover-bg-strong); color: var(--crm-text); }

.crm-threads { overflow-y: auto; flex: 1; }
.crm-thread { display: block; width: 100%; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--crm-border); padding: 11px 14px; cursor: pointer; color: inherit; }
.crm-thread:hover { background: var(--crm-hover-bg); }
.crm-thread.active { background: var(--crm-accent-soft-bg); box-shadow: inset 3px 0 0 var(--crm-accent), inset 0 0 30px rgba(0, 243, 255, .06); }
.crm-thread.unread .ct-name { font-weight: 700; }
.ct-row1 { display: flex; align-items: center; gap: 8px; }
.ct-avatar { flex: none; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; }
.ct-name { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ct-time { font-size: 11px; color: var(--crm-text-dim); flex: none; margin-left: auto; }
.ct-subject { font-size: 12.5px; color: var(--crm-text-secondary); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ct-snippet { font-size: 11.5px; color: var(--crm-text-dim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ct-you { color: var(--crm-text-muted); font-weight: 600; }
.ct-row3 { display: flex; align-items: center; gap: 7px; margin-top: 5px; }
.ct-badge { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 1px 6px; border-radius: 3px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); }
.ct-badge.responded { background: var(--crm-success-bg); color: var(--crm-success); }
.ct-badge.archived { background: var(--crm-warn-bg); color: var(--crm-warn); }
.ct-unread { font-size: 10px; font-weight: 700; background: var(--crm-accent); color: var(--crm-accent-contrast); padding: 0 5px; border-radius: 8px; }
.ct-dir { color: var(--crm-text-faint); font-size: 10px; margin-left: auto; }

.crm-empty { padding: 40px 24px; text-align: center; color: var(--crm-text-faint); }
.crm-empty i { font-size: 28px; opacity: .5; }
.crm-empty p { font-weight: 600; margin: 12px 0 4px; color: var(--crm-text-secondary); }
.crm-empty small { font-size: 11.5px; line-height: 1.5; display: block; }

.crm-thread-view { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.crm-thread-empty { align-items: center; justify-content: center; color: var(--crm-text-faint); gap: 10px; }
.crm-thread-empty i { font-size: 34px; opacity: .4; }

.tv-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 16px 22px; border-bottom: 1px solid var(--crm-border-header); }
.tv-head-who { display: flex; align-items: center; gap: 12px; min-width: 0; }
.tv-avatar { flex: none; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; }
.tv-head h2 { font-size: 16px; margin: 0 0 3px; font-weight: 650; }
.tv-meta { margin: 0; font-size: 12.5px; color: var(--crm-text-muted); }
.tv-actions button { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 34px; height: 34px; border-radius: 6px; cursor: pointer; }
.tv-actions button:hover { background: var(--crm-hover-bg-strong); }

.tv-messages { flex: 1; overflow-y: auto; padding: 20px 22px; display: flex; flex-direction: column; gap: 14px; }
.msg { max-width: 78%; }
.msg.inbound { align-self: flex-start; }
.msg.outbound { align-self: flex-end; }
.msg-head { display: flex; gap: 8px; align-items: center; font-size: 11px; color: var(--crm-text-dim); margin-bottom: 5px; }
.msg.outbound .msg-head { justify-content: flex-end; }
.msg-avatar { flex: none; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 8.5px; font-weight: 700; }
.msg-from { font-weight: 600; color: var(--crm-text-secondary); }
.msg-auto { background: var(--crm-warn-bg); color: var(--crm-warn); padding: 0 5px; border-radius: 3px; font-weight: 600; }
.msg-body { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-header); border-radius: 10px; padding: 11px 14px; font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.msg.outbound .msg-body { background: #07272e; border-color: #0c3b45; }

/* HTML emails render in their own sandboxed iframe — see buildFrameDoc() — so this
   wrapper is just a light card frame around it, not the dark bubble styling. */
.msg.inbound .msg-body.msg-body-html-wrap,
.msg.outbound .msg-body.msg-body-html-wrap {
  padding: 0; background: #fff; border-color: #d7dce1; overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .35);
}
.msg-html-frame { display: block; width: 100%; min-height: 48px; border: 0; background: #fff; }

.msg-quote-toggle {
  display: inline-flex; align-items: center; gap: 5px; margin-top: 8px;
  background: #101013; border: 1px solid var(--crm-border-header); color: var(--crm-text-muted);
  font-size: 10.5px; font-weight: 600; padding: 3px 9px; border-radius: 20px; cursor: pointer;
}
.msg-quote-toggle:hover { background: var(--crm-hover-bg-strong); color: var(--crm-text-secondary); }
.msg-text-quoted {
  margin-top: 7px; padding: 10px 12px; background: #101013; border: 1px dashed #26262c;
  border-radius: 8px; color: #6b6b74; font-size: 12.5px; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word;
}

.msg-divider { display: flex; align-items: center; gap: 12px; margin: 6px 0 2px; color: var(--crm-text-dim); font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.msg-divider::before, .msg-divider::after { content: ''; flex: 1; height: 1px; background: #1c1c21; }

.msg-atts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 7px; }
.msg-att { font-size: 11.5px; color: var(--crm-text-secondary); background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); border-radius: 5px; padding: 3px 8px; }

.tv-reply { border-top: 1px solid var(--crm-border-header); padding: 12px 18px 16px; background: var(--crm-panel-bg); }
.tv-reply textarea { width: 100%; background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 8px; padding: 10px 12px; font: inherit; font-size: 13.5px; resize: vertical; }
.tv-reply textarea:focus { outline: none; border-color: var(--crm-accent); box-shadow: 0 0 0 3px rgba(0, 243, 255, .12); }
.tv-reply-bar { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.tv-reply-to { font-size: 11.5px; color: var(--crm-text-dim); }
.tv-reply-bar button { margin-left: auto; background: var(--crm-accent); color: var(--crm-accent-contrast); border: 0; font-weight: 700; font-size: 13px; padding: 8px 18px; border-radius: 7px; cursor: pointer; box-shadow: 0 0 18px rgba(0, 243, 255, .22); }
.tv-reply-bar button:disabled { opacity: .5; cursor: default; box-shadow: none; }
.tv-reply-err { color: var(--crm-danger); font-size: 12px; margin: 6px 0 0; }

/* insert-link mini form */
.tv-linkbox { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; padding: 9px 10px; background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); border-radius: 8px; }
.tv-linkbox input { flex: 1 1 150px; min-width: 0; background: var(--crm-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 6px; padding: 7px 9px; font: inherit; font-size: 12.5px; }
.tv-linkbox input:focus { outline: none; border-color: var(--crm-accent); }
.tv-link-insert { background: var(--crm-accent); color: var(--crm-accent-contrast); border: 0; font-weight: 700; font-size: 12px; padding: 7px 13px; border-radius: 6px; cursor: pointer; }
.tv-link-insert:disabled { opacity: .45; cursor: default; }
.tv-link-cancel { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-secondary); font-size: 12px; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.tv-linkbox .tv-link-hint { flex: 1 1 100%; margin: 0; font-size: 11px; color: var(--crm-danger); }
.tv-reply-bar .tv-link-btn i { margin-left: 0; margin-right: 4px; }

.tv-templates { position: relative; }
.tv-reply-bar .tv-tpl-btn {
  margin-left: 0; background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft);
  font-weight: 600; font-size: 12px; padding: 7px 11px; border-radius: 7px; cursor: pointer;
}
.tv-reply-bar .tv-tpl-btn:hover { background: var(--crm-hover-bg-strong); }
.tv-reply-bar .tv-tpl-btn i { font-size: 10px; margin-left: 3px; }
.tv-tpl-backdrop { position: fixed; inset: 0; z-index: 20; }
.tv-tpl-menu {
  position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 21; margin: 0; padding: 4px;
  list-style: none; min-width: 210px; max-height: 260px; overflow-y: auto;
  background: var(--crm-header-bg); border: 1px solid var(--crm-border-strong); border-radius: 8px;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.45);
}
.tv-tpl-menu li { margin: 0; }
.tv-reply-bar .tv-tpl-menu button {
  margin-left: 0; display: block; width: 100%; text-align: left; background: transparent;
  border: 0; color: var(--crm-text-soft); font-weight: 500; font-size: 12.5px; padding: 7px 9px;
  border-radius: 5px; cursor: pointer;
}
.tv-reply-bar .tv-tpl-menu button:hover { background: var(--crm-hover-bg); color: var(--crm-text); }
</style>
