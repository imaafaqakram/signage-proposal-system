// CRM data layer — inbox, threads, messages, attachments, per-lead status.
// Deliberately self-contained: its own Supabase client (same config as db.js) so
// nothing here can affect the proposal system's persistence path. Schema:
// supabase/migrations/005_crm_tables.sql
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { normalizeMessageId, idKey, slimHtml, clipText } from './crm-mail-utils.js'

const fetchWithTimeout = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(15000) })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { global: { fetch: fetchWithTimeout } }
)

// ── helpers ───────────────────────────────────────────────

/** Strips Re:/Fwd:/Aw: prefixes, collapses whitespace, lowercases. */
export function normalizeSubject(subject) {
  return (subject || '')
    .replace(/^(\s*(re|fwd|fw|aw|wg)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** A short preview for the thread list. */
function makeSnippet(text) {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, 200)
}

const AUTO_REPLY_HINTS = /(out of (the )?office|auto[- ]?reply|automatic reply|on vacation|away from my|will be back|do not reply|no-reply|mailer-daemon|delivery status notification|undeliverable)/i

function looksAutoReply({ subject, from_addr }) {
  if (from_addr && /(mailer-daemon|postmaster|no-?reply)/i.test(from_addr)) return true
  return AUTO_REPLY_HINTS.test(subject || '')
}

// ── email accounts ────────────────────────────────────────

export async function getDefaultEmailAccount() {
  const { data, error } = await supabase
    .from('crm_email_accounts')
    .select('*')
    .eq('active', true)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data || null
}

export async function getEmailAccountByAddress(address) {
  if (!address) return null
  const { data, error } = await supabase
    .from('crm_email_accounts')
    .select('*')
    .ilike('address', address)
    .maybeSingle()
  if (error) throw error
  return data || null
}

// ── lead matching ─────────────────────────────────────────

/** Exact match on contact_email; then any lead on the same domain as a fallback. */
export async function findLeadByEmail(email) {
  if (!email) return null
  const addr = email.trim().toLowerCase()

  const exact = await supabase
    .from('leads')
    .select('id, client_name, contact_email')
    .ilike('contact_email', addr)
    .order('id', { ascending: false })
    .limit(1)
  if (exact.error) throw exact.error
  if (exact.data.length) return exact.data[0]

  const at = addr.indexOf('@')
  if (at > 0) {
    const domain = addr.slice(at + 1)
    if (!/(gmail|yahoo|outlook|hotmail|icloud|aol|proton)\./i.test(domain)) {
      const byDomain = await supabase
        .from('leads')
        .select('id, client_name, contact_email')
        .ilike('contact_email', `%@${domain}`)
        .order('id', { ascending: false })
        .limit(1)
      if (byDomain.error) throw byDomain.error
      if (byDomain.data.length) return { ...byDomain.data[0], _match: 'domain' }
    }
  }
  return null
}

// ── threads ───────────────────────────────────────────────

async function findThreadByInReplyTo(inReplyTo) {
  if (!inReplyTo) return null
  const { data, error } = await supabase
    .from('crm_messages')
    .select('thread_id')
    .in('message_id', idVariants(inReplyTo))
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? data.thread_id : null
}

async function findThreadBySubject(subjectNorm, counterparty) {
  if (!subjectNorm || !counterparty) return null
  const { data, error } = await supabase
    .from('crm_threads')
    .select('id')
    .eq('subject_norm', subjectNorm)
    .ilike('counterparty', counterparty)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? data.id : null
}

async function createThread({ leadId, emailAccountId, subject, counterparty }) {
  const { data, error } = await supabase
    .from('crm_threads')
    .insert({
      lead_id: leadId || null,
      email_account_id: emailAccountId || null,
      subject: subject || null,
      subject_norm: normalizeSubject(subject),
      counterparty: counterparty || null,
      status: 'open'
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

async function bumpThread(threadId, { direction, sentAt, incUnread, markResponded, snippet }) {
  const { data: t, error: readErr } = await supabase
    .from('crm_threads')
    .select('message_count, unread_count, status, last_message_at')
    .eq('id', threadId)
    .single()
  if (readErr) throw readErr

  const when = sentAt || new Date().toISOString()
  // A late-imported OLDER message (inbox reconciler / backfill) still counts, but must not
  // roll the thread's "latest message" time, direction or preview backwards.
  const isLatest = !t.last_message_at || new Date(when) >= new Date(t.last_message_at)
  const patch = {
    message_count: (t.message_count || 0) + 1,
    unread_count: (t.unread_count || 0) + (incUnread ? 1 : 0)
  }
  if (isLatest) {
    patch.last_message_at = when
    patch.last_direction = direction
    if (typeof snippet === 'string') patch.last_snippet = snippet
  }
  // "responded" means a real client wrote back — a matched lead, not an
  // auto-reply/bounce/newsletter. Everything else stays 'open' so the Inbox
  // filters and the Responses view actually mean something.
  if (markResponded && t.status !== 'archived') patch.status = 'responded'

  let { error } = await supabase.from('crm_threads').update(patch).eq('id', threadId)
  if (error && patch.last_snippet !== undefined && /last_snippet/i.test(error.message || '')) {
    // Migration 008 (crm_threads.last_snippet) hasn't been run yet — degrade instead
    // of breaking every inbound/outbound send. Self-heals with no further deploy once
    // the column exists: the next bumpThread() call will succeed on the first try.
    delete patch.last_snippet
    ;({ error } = await supabase.from('crm_threads').update(patch).eq('id', threadId))
  }
  if (error) throw error
}

// ── per-lead status ───────────────────────────────────────

async function upsertLeadStatus(leadId, patch, { historical = false } = {}) {
  if (!leadId) return
  const now = new Date().toISOString()
  const { data: existing, error: readErr } = await supabase
    .from('crm_lead_status')
    .select('*')
    .eq('lead_id', leadId)
    .maybeSingle()
  if (readErr) throw readErr

  if (!existing) {
    const { error } = await supabase
      .from('crm_lead_status')
      .insert({ lead_id: leadId, updated_at: now, last_activity_at: now, ...patch })
    if (error) throw error
    return
  }
  const merged = { updated_at: now, last_activity_at: now, ...patch }
  // The last real reply from the lead only ever moves FORWARD, and importing an old message
  // later must not make the lead look active "now" (it feeds the Gone Quiet cutoff).
  if (
    merged.last_inbound_activity_at && existing.last_inbound_activity_at &&
    new Date(existing.last_inbound_activity_at) > new Date(merged.last_inbound_activity_at)
  ) delete merged.last_inbound_activity_at
  if (historical) delete merged.last_activity_at
  // never downgrade a stage once it's past 'contacted'
  const rank = { new: 0, contacted: 1, responded: 2, negotiating: 3, won: 4, lost: 4 }
  if (merged.stage && (rank[merged.stage] ?? 0) < (rank[existing.stage] ?? 0)) {
    delete merged.stage
  }
  if (existing.first_response_at) delete merged.first_response_at
  const { error } = await supabase.from('crm_lead_status').update(merged).eq('lead_id', leadId)
  if (error) throw error
}

export async function markLeadContacted(leadId, at) {
  await upsertLeadStatus(leadId, { stage: 'contacted', last_activity_at: at || new Date().toISOString() })
}

export async function markLeadResponded(leadId, at, { historical = false } = {}) {
  const when = at || new Date().toISOString()
  // last_inbound_activity_at is deliberately separate from last_activity_at (which
  // upsertLeadStatus always bumps to "now" on every call, including our own outbound
  // sends via markLeadContacted). Only genuine inbound replies touch this field, so
  // the "Needs a Decision — Gone Quiet" cutoff (crm-automation.js) measures how long
  // the LEAD has been silent, not how recently we last emailed them.
  await upsertLeadStatus(leadId, { stage: 'responded', first_response_at: when, last_inbound_activity_at: when }, { historical })
}

/**
 * A genuine client reply means the proposal-system's follow-up drip
 * (scripts/send-followups.js) must stop chasing this lead. That drip keys off
 * leads.follow_up_stopped_at IS NULL; the CRM's own crm_lead_status table is
 * invisible to it, so we stamp the leads row here too. Guarded on IS NULL so a
 * later reply never moves the timestamp, and so a manual Admin "resume" isn't
 * silently undone by an old auto-reply arriving late.
 */
export async function stopLeadFollowUps(leadId, at) {
  const { error } = await supabase
    .from('leads')
    .update({ follow_up_stopped_at: at || new Date().toISOString() })
    .eq('id', leadId)
    .is('follow_up_stopped_at', null)
  if (error) throw error
}

// ── messages ──────────────────────────────────────────────

// Rows saved by the n8n workflow before 2026-10 carry the raw header line ("Message-ID: <x>")
// instead of "<x>" — match those too, so the same email is never stored twice.
const idVariants = (id) => [id, `Message-ID: ${id}`, `Message-Id: ${id}`]

async function messageExists(messageId) {
  if (!messageId) return false
  const { data, error } = await supabase
    .from('crm_messages')
    .select('id')
    .in('message_id', idVariants(messageId))
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return !!data
}

async function insertMessage(row) {
  const { data, error } = await supabase.from('crm_messages').insert(row).select('*').single()
  if (error) throw error
  return data
}

export async function recordAttachment({ messageId, leadId, kind, filename, contentType, sizeBytes, diskPath, drivePath }) {
  const { data, error } = await supabase
    .from('crm_attachments')
    .insert({
      message_id: messageId || null,
      lead_id: leadId || null,
      kind: kind || 'inbound-file',
      filename,
      content_type: contentType || null,
      size_bytes: sizeBytes || null,
      disk_path: diskPath || null,
      drive_path: drivePath || null
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

// ── the ingest orchestrator (called by /api/crm/ingest) ───

/**
 * @param {object} p
 * @param {string} p.messageId      RFC Message-ID
 * @param {string} p.inReplyTo      RFC In-Reply-To
 * @param {string} p.fromAddr
 * @param {string} p.fromName
 * @param {string} p.toAddrs        comma-joined
 * @param {string} p.ccAddrs
 * @param {string} p.subject
 * @param {string} p.bodyText
 * @param {string} p.bodyHtml
 * @param {string} p.sentAt         ISO
 * @param {string} p.accountAddress the mailbox that received it
 * @param {Array}  p.attachments    [{ filename, contentType, size }]
 */
export async function ingestInboundEmail(p) {
  // Canonical ids (the n8n feed sends the raw header line) and bodies that fit the database
  // limit (it also pastes multi-MB inline pictures into the HTML) — see crm-mail-utils.js.
  const messageId = normalizeMessageId(p.messageId)
  const inReplyTo = normalizeMessageId(p.inReplyTo)
  const bodyText = clipText(p.bodyText)
  const bodyHtml = slimHtml(p.bodyHtml)

  if (messageId && (await messageExists(messageId))) {
    return { status: 'duplicate', messageId }
  }

  const account =
    (await getEmailAccountByAddress(p.accountAddress)) || (await getDefaultEmailAccount())
  const lead = await findLeadByEmail(p.fromAddr)
  const isAuto = looksAutoReply({ subject: p.subject, from_addr: p.fromAddr })
  const subjectNorm = normalizeSubject(p.subject)
  const counterparty = (p.fromAddr || '').trim().toLowerCase()

  let threadId =
    (await findThreadByInReplyTo(inReplyTo)) ||
    (await findThreadBySubject(subjectNorm, counterparty))

  if (!threadId) {
    const t = await createThread({
      leadId: lead ? lead.id : null,
      emailAccountId: account ? account.id : null,
      subject: p.subject,
      counterparty
    })
    threadId = t.id
  }

  const message = await insertMessage({
    thread_id: threadId,
    lead_id: lead ? lead.id : null,
    direction: 'inbound',
    message_id: messageId || null,
    in_reply_to: inReplyTo || null,
    from_addr: p.fromAddr || null,
    from_name: p.fromName || null,
    to_addrs: p.toAddrs || null,
    cc_addrs: p.ccAddrs || null,
    subject: p.subject || null,
    body_text: bodyText || null,
    body_html: bodyHtml || null,
    snippet: makeSnippet(bodyText || bodyHtml),
    is_read: !!p.backfill,
    is_auto_reply: isAuto,
    sent_at: p.sentAt || new Date().toISOString()
  })

  for (const a of p.attachments || []) {
    await recordAttachment({
      messageId: message.id,
      leadId: lead ? lead.id : null,
      kind: 'inbound-file',
      filename: a.filename || 'attachment',
      contentType: a.contentType,
      sizeBytes: a.size
    }).catch((e) => console.warn('[crm] attachment record failed:', e.message))
  }

  await bumpThread(threadId, {
    direction: 'inbound',
    sentAt: message.sent_at,
    incUnread: !isAuto && !p.backfill,
    markResponded: !!lead && !isAuto,
    snippet: message.snippet
  })

  if (lead && !isAuto) {
    await markLeadResponded(lead.id, message.sent_at, { historical: !!p.backfill }).catch((e) =>
      console.warn('[crm] markLeadResponded failed:', e.message)
    )
    await stopLeadFollowUps(lead.id, message.sent_at).catch((e) =>
      console.warn('[crm] stopLeadFollowUps failed:', e.message)
    )
  }

  return {
    status: 'stored',
    threadId,
    messageId: message.id,
    matchedLead: lead ? { id: lead.id, name: lead.client_name, via: lead._match || 'email' } : null,
    autoReply: isAuto
  }
}

/**
 * Log an outbound email we just sent (proposal, or a reply from the inbox).
 * Non-blocking by design at the call site.
 */
export async function logOutboundEmail(p) {
  const account = (await getEmailAccountByAddress(p.fromAddr)) || (await getDefaultEmailAccount())
  const subjectNorm = normalizeSubject(p.subject)
  const counterparty = (p.toAddr || '').trim().toLowerCase()

  let threadId =
    (p.threadId && Number(p.threadId)) ||
    (await findThreadBySubject(subjectNorm, counterparty))

  if (!threadId) {
    const t = await createThread({
      leadId: p.leadId || null,
      emailAccountId: account ? account.id : null,
      subject: p.subject,
      counterparty
    })
    threadId = t.id
  }

  const message = await insertMessage({
    thread_id: threadId,
    lead_id: p.leadId || null,
    direction: 'outbound',
    message_id: p.messageId || null,
    in_reply_to: p.inReplyTo || null,
    from_addr: p.fromAddr || null,
    from_name: p.fromName || null,
    to_addrs: p.toAddr || null,
    cc_addrs: p.ccAddrs || null,
    subject: p.subject || null,
    body_text: p.bodyText || null,
    body_html: p.bodyHtml || null,
    snippet: makeSnippet(p.bodyText || p.bodyHtml),
    is_read: true,
    is_auto_reply: false,
    sent_at: p.sentAt || new Date().toISOString()
  })

  await bumpThread(threadId, {
    direction: 'outbound',
    sentAt: message.sent_at,
    incUnread: false,
    snippet: message.snippet
  })
  if (p.leadId) await markLeadContacted(p.leadId, message.sent_at).catch(() => {})

  return { threadId, messageId: message.id }
}

// ── reads for the inbox UI ────────────────────────────────

const THREAD_LIST_COLS = 'id, subject, counterparty, status, last_message_at, last_direction, last_snippet, message_count, unread_count, lead_id'
const THREAD_LIST_COLS_NO_SNIPPET = THREAD_LIST_COLS.replace(', last_snippet', '')

function buildThreadListQuery(cols, { status, limit, offset, q }) {
  let query = supabase
    .from('crm_threads')
    .select(cols)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1)
  if (status && status !== 'all') query = query.eq('status', status)
  if (q) query = query.ilike('subject', `%${q}%`)
  return query
}

export async function listThreads({ status, limit = 50, offset = 0, q } = {}) {
  const opts = { status, limit, offset, q }
  let { data: threads, error } = await buildThreadListQuery(THREAD_LIST_COLS, opts)
  if (error && /last_snippet/i.test(error.message || '')) {
    // Migration 008 hasn't been run yet — fall back to the pre-snippet column list
    // rather than breaking the whole Inbox. Self-heals once the column exists.
    ;({ data: threads, error } = await buildThreadListQuery(THREAD_LIST_COLS_NO_SNIPPET, opts))
  }
  if (error) throw error
  if (!threads.length) return []

  const leadIds = [...new Set(threads.map((t) => t.lead_id).filter(Boolean))]
  let names = new Map()
  if (leadIds.length) {
    const { data: leads, error: lErr } = await supabase
      .from('leads')
      .select('id, client_name')
      .in('id', leadIds)
    if (lErr) throw lErr
    names = new Map(leads.map((l) => [l.id, l.client_name]))
  }
  return threads.map((t) => ({ ...t, lead_name: t.lead_id ? names.get(t.lead_id) || null : null }))
}

export async function getThread(threadId) {
  const { data: thread, error } = await supabase
    .from('crm_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle()
  if (error) throw error
  if (!thread) return null

  const { data: messages, error: mErr } = await supabase
    .from('crm_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('sent_at', { ascending: true })
  if (mErr) throw mErr

  const msgIds = messages.map((m) => m.id)
  let attByMsg = new Map()
  if (msgIds.length) {
    const { data: atts, error: aErr } = await supabase
      .from('crm_attachments')
      .select('*')
      .in('message_id', msgIds)
    if (aErr) throw aErr
    for (const a of atts) {
      if (!attByMsg.has(a.message_id)) attByMsg.set(a.message_id, [])
      attByMsg.get(a.message_id).push(a)
    }
  }

  let lead = null
  if (thread.lead_id) {
    const { data: l } = await supabase
      .from('leads')
      .select('id, client_name, contact_email')
      .eq('id', thread.lead_id)
      .maybeSingle()
    lead = l || null
  }

  return {
    ...thread,
    lead,
    messages: messages.map((m) => ({ ...m, attachments: attByMsg.get(m.id) || [] }))
  }
}

export async function markThreadRead(threadId) {
  const e1 = await supabase.from('crm_messages').update({ is_read: true }).eq('thread_id', threadId)
  if (e1.error) throw e1.error
  const e2 = await supabase.from('crm_threads').update({ unread_count: 0 }).eq('id', threadId)
  if (e2.error) throw e2.error
}

// Same two writes as markThreadRead, just unscoped (every thread instead of one) —
// a single UPDATE per table rather than looping per-thread, so this is one round
// trip each regardless of inbox size, not N. The two updates are independent of
// each other (different tables, no shared filter) so they run together.
export async function markAllThreadsRead() {
  const [e1, e2] = await Promise.all([
    supabase.from('crm_messages').update({ is_read: true }).eq('is_read', false),
    supabase.from('crm_threads').update({ unread_count: 0 }).gt('unread_count', 0)
  ])
  if (e1.error) throw e1.error
  if (e2.error) throw e2.error
}

// Hard delete — the user explicitly asked to be able to delete a conversation, not
// archive one. Deletes bottom-up (attachments -> messages -> thread) rather than
// relying on an assumed ON DELETE CASCADE, since that was never confirmed for this
// schema; explicit deletes are safe either way (a cascade just makes the later
// deletes no-ops). Does NOT touch attachment files already on disk/Drive — only
// removes the database rows a deleted thread would otherwise leave behind.
// Message-IDs of conversations deleted in the CRM, so crm-inbox-reconcile.js (which re-imports
// anything in the mailbox the CRM lacks) never resurrects a thread someone removed on purpose.
const DELETED_FILE = path.join(process.cwd(), 'crm-deleted-message-ids.json')
export function loadDeletedMessageKeys() {
  try { return new Set(JSON.parse(fs.readFileSync(DELETED_FILE, 'utf8'))) } catch { return new Set() }
}
function rememberDeletedMessageIds(ids) {
  try {
    const keys = loadDeletedMessageKeys()
    for (const id of ids) { const k = idKey(id); if (k) keys.add(k) }
    fs.writeFileSync(DELETED_FILE, JSON.stringify([...keys]))
  } catch (e) {
    console.warn('[crm] could not remember deleted message ids:', e.message)
  }
}

export async function deleteThread(threadId) {
  const { data: msgs, error: mErr } = await supabase.from('crm_messages').select('id, message_id').eq('thread_id', threadId)
  if (mErr) throw mErr
  const messageIds = (msgs || []).map((m) => m.id)
  if (messageIds.length) {
    const { error: aErr } = await supabase.from('crm_attachments').delete().in('message_id', messageIds)
    if (aErr) throw aErr
  }
  const { error: msgDelErr } = await supabase.from('crm_messages').delete().eq('thread_id', threadId)
  if (msgDelErr) throw msgDelErr
  const { error: tErr } = await supabase.from('crm_threads').delete().eq('id', threadId)
  if (tErr) throw tErr
  rememberDeletedMessageIds((msgs || []).map((m) => m.message_id))
}

export async function setThreadStatus(threadId, status) {
  const { error } = await supabase.from('crm_threads').update({ status }).eq('id', threadId)
  if (error) throw error
}

export async function inboxCounts() {
  const { data, error } = await supabase.from('crm_threads').select('status, unread_count')
  if (error) throw error
  let open = 0
  let unread = 0
  let responded = 0
  for (const t of data) {
    if (t.status === 'open') open++
    if (t.status === 'responded') responded++
    unread += t.unread_count || 0
  }
  return { open, responded, unread, total: data.length }
}

// ── team activity log ────────────────────────────────────
// A clean, purpose-built log for general CRM actions (order/expense created, stale lead
// dismissed, material stock adjusted, vendor/PO created) — distinct from the older
// employee-activity.log file in server.js, which is narrowly scoped to the Airtable-fetch
// feature and was never meant to cover CRM actions generally. Fire-and-forget by design:
// callers should never let a logging failure block the actual write it's describing.
export async function logCrmActivity({ employeeName, action, entityType, entityId, meta } = {}) {
  try {
    const { error } = await supabase.from('crm_activity_log').insert({
      employee_name: employeeName || null,
      action,
      entity_type: entityType || null,
      entity_id: entityId != null ? String(entityId) : null,
      meta: meta || null
    })
    if (error && !/relation .*crm_activity_log.* does not exist/i.test(error.message || '')) {
      console.warn('[crm-activity] log insert failed:', error.message)
    }
  } catch (e) {
    console.warn('[crm-activity] log insert threw:', e.message)
  }
}

export { supabase as _crmSupabase }
