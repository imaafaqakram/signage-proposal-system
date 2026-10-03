// Luminus CRM — client announcements ("Broadcast").
//
// One message to many clients — a terms & policy change, planned maintenance, a holiday
// closure — queued with one click and delivered at a safe pace:
//
//   • HARD CAP: never more than PER_HOUR (30) emails in any rolling 60 minutes. The first 30
//     go out right away; the next slot opens exactly an hour after the first of them was sent,
//     and so on until everyone has it. No cron, no clicking again — the worker does it.
//   • The queue lives in the database (migration 018), so a restart or redeploy never loses
//     it, never re-sends anyone, and never resets the hourly count.
//   • Only ONE server may run the worker. Production, staging and any test copy all share the
//     same database, so the worker is OFF unless CRM_BROADCAST_WORKER=true is set in that
//     server's .env — otherwise two servers would each send "30 an hour".
//   • Each recipient is claimed with an atomic status change before sending, so even a
//     second worker could never email the same person twice.
//   • CRM_BROADCAST_DRYRUN=true swaps SMTP for a no-network stub (used for testing only).
//
// Self-contained: its own SMTP transport, its own tables. It never touches the Proposal
// System, the inbox threads, or the automated follow-up drip.
import express from 'express'
import nodemailer from 'nodemailer'
import { _crmSupabase as supabase, logCrmActivity } from './crm-db.js'
import { logEvent } from './crm-audit.js'

export const PER_HOUR = 30
const WINDOW_MS = 60 * 60 * 1000
const GAP_MS = Number(process.env.CRM_BROADCAST_GAP_MS) || 4000 // pause between emails inside a burst — gentle on the mail server (env override is for tests)
const TICK_MS = 30 * 1000
const STUCK_MS = 10 * 60 * 1000
const BACKOFF_MS = 5 * 60 * 1000
const MAX_RECIPIENTS = 2000
const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+$/
const ENGAGED_STAGES = ['responded', 'negotiating', 'won']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()
const isMissingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /crm_broadcast.*(does not exist|schema cache)/i.test(e.message || ''))
const cleanEmail = (s) => String(s || '').trim().toLowerCase()

// ───────────────────────── email composition ─────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fillName(text, name) {
  return String(text || '').replace(/\{\{\s*name\s*\}\}/gi, (name && String(name).trim()) || 'there')
}

function linkify(escaped) {
  return escaped.replace(/\bhttps?:\/\/[^\s<]+/g, (raw) => {
    const m = raw.match(/^(.*?)([.,;:!?)]*)$/)
    const url = m[1]
    return `<a href="${url}" style="color:#0284c7;">${url}</a>${m[2]}`
  })
}

function bodyToHtml(text) {
  return String(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;">${linkify(esc(p)).replace(/\n/g, '<br/>')}</p>`)
    .join('')
}

export function composeEmail({ subject, body, name, brand = 'Signage Crafting', phone = '' }) {
  const text = fillName(body, name)
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:24px 30px;">
    <h1 style="color:#38bdf8;font-size:22px;font-weight:800;margin:0;">${esc(brand)}</h1>
  </div>
  <div style="padding:30px 30px 14px;font-size:15px;line-height:1.65;color:#334155;">${bodyToHtml(text)}</div>
  <div style="padding:16px 30px 24px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#94a3b8;">
    You're receiving this because you're a ${esc(brand)} client. Questions? Just reply to this email${phone ? ` or call ${esc(phone)}` : ''}.
  </div>
</div>`
  return { subject: fillName(subject, name), text: `${text}\n\n— ${brand}`, html }
}

// ───────────────────────── SMTP ─────────────────────────
let transport = null
function getTransport() {
  if (transport) return transport
  transport = process.env.CRM_BROADCAST_DRYRUN === 'true'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.hostinger.com',
        port: parseInt(process.env.SMTP_PORT || '465'),
        secure: (process.env.SMTP_PORT || '465') === '465',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        tls: { rejectUnauthorized: false }
      })
  return transport
}

// Master on/off switch, stored the same way as every other owner-controlled setting
// (admin-settings.json via loadAdminSettings/saveAdminSettings). Defaults OFF — see
// DEFAULT_ADMIN_SETTINGS in server.js. Any read failure also means OFF: fail safe, never
// fail open into sending client email.
async function sendingEnabled(loadAdminSettings) {
  try { return !!(await loadAdminSettings()).crmBroadcastEnabled } catch { return false }
}

async function senderInfo(loadAdminSettings) {
  let settings = {}
  try { settings = (loadAdminSettings && (await loadAdminSettings())) || {} } catch { /* defaults */ }
  const brand = settings.smtpFromName || process.env.SMTP_FROM_NAME || 'Signage Crafting'
  return { brand, phone: settings.proposalPhone || '', from: `"${brand}" <${process.env.SMTP_USER}>` }
}

// Connection-level problems and 4xx replies mean "try again later", not "this address is bad".
function isTransient(err) {
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET', 'EAUTH'].includes(err?.code)) return true
  return /^4\d\d$/.test(String(err?.responseCode || ''))
}

// ───────────────────────── queue helpers ─────────────────────────
async function attemptsInWindow() {
  const since = new Date(Date.now() - WINDOW_MS).toISOString()
  const { data, error } = await supabase
    .from('crm_broadcast_recipients').select('attempted_at').gte('attempted_at', since).order('attempted_at', { ascending: true }).limit(500)
  if (error) throw error
  return data || []
}

async function countStatus(broadcastId, status) {
  const { count, error } = await supabase
    .from('crm_broadcast_recipients').select('id', { count: 'exact', head: true }).eq('broadcast_id', broadcastId).eq('status', status)
  if (error) throw error
  return count || 0
}

async function refreshCounts(broadcastId) {
  try {
    const [sent, failed, skipped] = await Promise.all([countStatus(broadcastId, 'sent'), countStatus(broadcastId, 'failed'), countStatus(broadcastId, 'skipped')])
    await supabase.from('crm_broadcasts').update({ sent_count: sent, failed_count: failed, skipped_count: skipped }).eq('id', broadcastId)
    return { sent, failed, skipped }
  } catch (e) {
    console.warn('[crm-broadcast] count refresh failed:', e.message)
    return null
  }
}

async function recoverStuck() {
  const cutoff = new Date(Date.now() - STUCK_MS).toISOString()
  const { data } = await supabase
    .from('crm_broadcast_recipients')
    .update({ status: 'failed', error: 'Interrupted before delivery was confirmed — check the Sent folder. Not retried, to avoid emailing them twice.' })
    .eq('status', 'sending').lt('attempted_at', cutoff).select('broadcast_id')
  for (const id of new Set((data || []).map((r) => r.broadcast_id))) await refreshCounts(id)
}

async function claimBatch(broadcastId, slots) {
  const { data: pending, error } = await supabase
    .from('crm_broadcast_recipients').select('id').eq('broadcast_id', broadcastId).eq('status', 'pending')
    .order('position', { ascending: true }).limit(slots)
  if (error) throw error
  if (!pending?.length) return []
  // Atomic claim: only rows still 'pending' flip to 'sending', so nobody can be emailed twice.
  const { data: claimed, error: cErr } = await supabase
    .from('crm_broadcast_recipients').update({ status: 'sending', attempted_at: nowIso() })
    .in('id', pending.map((p) => p.id)).eq('status', 'pending').select('id, email, name, lead_id, position')
  if (cErr) throw cErr
  return (claimed || []).sort((a, b) => a.position - b.position)
}

async function release(rows, toStatus = 'pending') {
  const ids = rows.map((r) => r.id)
  if (!ids.length) return
  const patch = toStatus === 'pending' ? { status: 'pending', attempted_at: null } : { status: 'skipped', error: 'Cancelled before sending', attempted_at: null }
  await supabase.from('crm_broadcast_recipients').update(patch).in('id', ids).eq('status', 'sending')
}

async function markRow(id, patch) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.from('crm_broadcast_recipients').update(patch).eq('id', id)
    if (!error) return
    await sleep(500)
  }
}

async function finishIfDone(bc) {
  const { data } = await supabase.from('crm_broadcast_recipients').select('id').eq('broadcast_id', bc.id).in('status', ['pending', 'sending']).limit(1)
  if (data?.length) return
  const counts = await refreshCounts(bc.id)
  const { data: done } = await supabase.from('crm_broadcasts').update({ status: 'completed', finished_at: nowIso() }).eq('id', bc.id).eq('status', 'sending').select('id')
  if (done?.length) {
    logCrmActivity({
      employeeName: 'System', action: 'broadcast.completed', entityType: 'broadcast', entityId: bc.id,
      meta: { label: bc.subject, detail: counts ? `${counts.sent} sent${counts.failed ? `, ${counts.failed} failed` : ''}` : 'All recipients processed', user: { via: 'system' } }
    })
  }
}

// ───────────────────────── the worker ─────────────────────────
let running = false
let backoffUntil = 0
let workerOn = false

async function deliver(bc, r, sender) {
  try {
    const mail = composeEmail({ subject: bc.subject, body: bc.body, name: r.name, brand: sender.brand, phone: sender.phone })
    const info = await getTransport().sendMail({ from: sender.from, to: r.email, subject: mail.subject, text: mail.text, html: mail.html })
    await markRow(r.id, { status: 'sent', sent_at: nowIso(), message_id: info?.messageId || null, error: null })
    return 'sent'
  } catch (err) {
    if (isTransient(err)) {
      console.warn(`[crm-broadcast] mail server problem (${err.code || err.responseCode}) — pausing sends for 5 minutes:`, err.message)
      await markRow(r.id, { status: 'pending', attempted_at: null })
      return 'transient'
    }
    await markRow(r.id, { status: 'failed', error: String(err?.message || err).slice(0, 300) })
    return 'failed'
  }
}

export async function processQueue({ loadAdminSettings } = {}) {
  if (running || Date.now() < backoffUntil) return
  if (!(await sendingEnabled(loadAdminSettings))) return // master switch is off — nothing goes out
  running = true
  try {
    const { data: active, error } = await supabase.from('crm_broadcasts').select('*').eq('status', 'sending').order('created_at', { ascending: true })
    if (error) { if (!isMissingTable(error)) console.warn('[crm-broadcast] queue read failed:', error.message); return }
    if (!active?.length) return

    await recoverStuck()
    let slots = PER_HOUR - (await attemptsInWindow()).length
    if (slots <= 0) return
    const sender = await senderInfo(loadAdminSettings)

    for (const bc of active) {
      if (slots <= 0) break
      const claimed = await claimBatch(bc.id, slots)
      if (!claimed.length) { await finishIfDone(bc); continue }

      for (let i = 0; i < claimed.length; i++) {
        // Honour pause / cancel between emails, not just between bursts.
        const { data: cur } = await supabase.from('crm_broadcasts').select('status').eq('id', bc.id).maybeSingle()
        if (!cur || cur.status !== 'sending') { await release(claimed.slice(i), cur?.status === 'cancelled' ? 'skipped' : 'pending'); break }

        const outcome = await deliver(bc, claimed[i], sender)
        if (outcome === 'transient') { backoffUntil = Date.now() + BACKOFF_MS; await release(claimed.slice(i + 1)); break }
        slots--
        if ((i + 1) % 10 === 0) await refreshCounts(bc.id)
        if (i < claimed.length - 1) await sleep(GAP_MS)
      }
      await refreshCounts(bc.id)
      await finishIfDone(bc)
    }
  } catch (e) {
    console.warn('[crm-broadcast] worker tick failed:', e.message)
  } finally {
    running = false
  }
}

/** Starts the background sender — only where CRM_BROADCAST_WORKER=true (see file header). */
export function startBroadcastWorker({ loadAdminSettings } = {}) {
  if (process.env.CRM_BROADCAST_WORKER !== 'true') {
    console.log('ℹ️  CRM announcements: sender is OFF on this server (set CRM_BROADCAST_WORKER=true to enable).')
    return
  }
  workerOn = true
  console.log(`✅ CRM announcements: sender ON — max ${PER_HOUR} emails per rolling hour${process.env.CRM_BROADCAST_DRYRUN === 'true' ? ' (DRY RUN — no real email)' : ''}.`)
  setTimeout(() => {
    processQueue({ loadAdminSettings })
    setInterval(() => processQueue({ loadAdminSettings }), TICK_MS).unref()
  }, 20 * 1000).unref()
}

// ───────────────────────── audience ─────────────────────────
async function fetchLeadsByIds(ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('leads').select('id, client_name, contact_email').in('id', ids.slice(i, i + 150))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

/**
 * "Engaged" clients = people we're actually in touch with:
 *   customers — pipeline stage Won, or they have an order recorded
 *   active    — pipeline stage Responded / Negotiating (they've replied)
 * People without a usable email are left out. The follow-up "stopped" flag is deliberately
 * NOT used as an opt-out here: the CRM sets it automatically the moment a lead replies or is
 * marked Won/Lost, so it would exclude exactly the clients this feature is for.
 */
async function buildAudience() {
  const { data: statusRows, error: sErr } = await supabase.from('crm_lead_status').select('lead_id, stage').in('stage', ENGAGED_STAGES).limit(5000)
  if (sErr) throw sErr
  const { data: orders, error: oErr } = await supabase.from('orders').select('lead_id, client_name, client_email').limit(5000)
  if (oErr) throw oErr

  const stageOf = new Map((statusRows || []).map((r) => [r.lead_id, r.stage]))
  const leadIds = [...new Set([...stageOf.keys(), ...(orders || []).map((o) => o.lead_id).filter(Boolean)])]
  const leads = new Map((await fetchLeadsByIds(leadIds)).map((l) => [l.id, l]))

  const people = new Map()
  let invalidEmail = 0
  const add = (email, name, leadId, group, stage) => {
    const e = cleanEmail(email)
    if (!EMAIL_RE.test(e)) { invalidEmail++; return }
    const p = people.get(e) || { email: e, name: name || '', leadId: leadId || null, groups: new Set(), stage: stage || null }
    if (!p.name && name) p.name = name
    if (!p.leadId && leadId) p.leadId = leadId
    if (stage && !p.stage) p.stage = stage
    p.groups.add(group)
    people.set(e, p)
  }

  for (const [leadId, stage] of stageOf) {
    const l = leads.get(leadId)
    if (!l) continue
    add(l.contact_email, l.client_name, leadId, stage === 'won' ? 'customers' : 'active', stage)
  }
  for (const o of orders || []) {
    const l = o.lead_id ? leads.get(o.lead_id) : null
    add(o.client_email || l?.contact_email, o.client_name || l?.client_name, o.lead_id, 'customers', l ? stageOf.get(l.id) : null)
  }

  const recipients = [...people.values()]
    .map((p) => ({ ...p, groups: [...p.groups] }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
  return {
    recipients,
    counts: {
      customers: recipients.filter((r) => r.groups.includes('customers')).length,
      active: recipients.filter((r) => r.groups.includes('active')).length,
      total: recipients.length
    },
    excluded: { invalidEmail }
  }
}

// ───────────────────────── routes ─────────────────────────
export function createCrmBroadcastRouter({ requireAuth, loadAdminSettings, saveAdminSettings } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())
  const jsonBody = express.json({ limit: '2mb' })
  router.use(auth)

  const pendingMsg = 'Announcements aren\'t set up yet — run database migration 018 in Supabase, then reload.'
  const fail = (res, err, label) => {
    if (isMissingTable(err)) return res.status(503).json({ error: pendingMsg, migrationPending: true })
    console.error(`[crm-broadcast] ${label}`, err)
    return res.status(500).json({ error: err.message })
  }

  // GET /status — pacing + whether this server is actually allowed to send.
  router.get('/status', async (_req, res) => {
    try {
      const attempts = await attemptsInWindow()
      const nextSlotAt = attempts.length >= PER_HOUR ? new Date(new Date(attempts[0].attempted_at).getTime() + WINDOW_MS).toISOString() : null
      res.json({
        perHour: PER_HOUR, usedLastHour: attempts.length, nextSlotAt,
        sendingEnabled: await sendingEnabled(loadAdminSettings),
        workerEnabled: workerOn, dryRun: process.env.CRM_BROADCAST_DRYRUN === 'true',
        backoffUntil: backoffUntil > Date.now() ? new Date(backoffUntil).toISOString() : null
      })
    } catch (err) { fail(res, err, 'status') }
  })

  // POST /toggle — the master on/off switch. Turning it off does not cancel or lose
  // anything already queued; those recipients just wait until it's turned back on (same
  // as a per-announcement pause, but for the whole feature at once).
  router.post('/toggle', jsonBody, async (req, res) => {
    try {
      const enabled = !!req.body?.enabled
      await saveAdminSettings({ crmBroadcastEnabled: enabled })
      logEvent(req, { action: 'broadcast.toggle', entityType: 'settings', entityId: 'crmBroadcastEnabled', meta: { detail: enabled ? 'Turned announcements sending ON' : 'Turned announcements sending OFF' } })
      res.json({ ok: true, sendingEnabled: enabled })
    } catch (err) { fail(res, err, 'toggle') }
  })

  // GET /audience — who could receive it.
  router.get('/audience', async (_req, res) => {
    try { res.json(await buildAudience()) } catch (err) { fail(res, err, 'audience') }
  })

  // POST /preview — exactly the email a client would get (rendered server-side, so what you see is what is sent).
  router.post('/preview', jsonBody, async (req, res) => {
    try {
      const b = req.body || {}
      const sender = await senderInfo(loadAdminSettings)
      const mail = composeEmail({ subject: String(b.subject || ''), body: String(b.body || ''), name: b.name || 'Alex', brand: sender.brand, phone: sender.phone })
      res.json({ subject: mail.subject, html: mail.html })
    } catch (err) { fail(res, err, 'preview') }
  })

  // POST /test — one real email to an address you type, before you send to everyone.
  const testTimes = []
  router.post('/test', jsonBody, async (req, res) => {
    try {
      const b = req.body || {}
      const to = cleanEmail(b.to)
      if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Enter a valid email address to send the test to.' })
      if (!String(b.subject || '').trim() || !String(b.body || '').trim()) return res.status(400).json({ error: 'Write a subject and message first.' })
      while (testTimes.length && Date.now() - testTimes[0] > WINDOW_MS) testTimes.shift()
      if (testTimes.length >= 5) return res.status(429).json({ error: 'That\'s 5 test emails in the last hour — wait a bit before sending more.' })
      const sender = await senderInfo(loadAdminSettings)
      const mail = composeEmail({ subject: `[TEST] ${b.subject}`, body: String(b.body), name: 'Test Client', brand: sender.brand, phone: sender.phone })
      await getTransport().sendMail({ from: sender.from, to, subject: mail.subject, text: mail.text, html: mail.html })
      testTimes.push(Date.now())
      logEvent(req, { action: 'broadcast.test', entityType: 'broadcast', entityId: null, meta: { label: String(b.subject).slice(0, 120), detail: `Sent a test to ${to}` } })
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm-broadcast] test', err)
      res.status(500).json({ error: `Couldn't send the test: ${err.message}` })
    }
  })

  // GET / — every announcement, newest first.
  router.get('/', async (_req, res) => {
    try {
      const { data, error } = await supabase.from('crm_broadcasts').select('*').order('created_at', { ascending: false }).limit(50)
      if (error) throw error
      res.json({ broadcasts: data || [] })
    } catch (err) { fail(res, err, 'list') }
  })

  // POST / — queue one. Body: { subject, body, recipients: [{ email, name, leadId }] }
  router.post('/', jsonBody, async (req, res) => {
    try {
      const b = req.body || {}
      const subject = String(b.subject || '').trim()
      const body = String(b.body || '').trim()
      if (!subject || subject.length > 200) return res.status(400).json({ error: 'Add a subject (up to 200 characters).' })
      if (body.length < 5 || body.length > 20000) return res.status(400).json({ error: 'Write the message (up to 20,000 characters).' })
      if (!Array.isArray(b.recipients) || !b.recipients.length) return res.status(400).json({ error: 'Choose at least one client to send to.' })
      if (b.recipients.length > MAX_RECIPIENTS) return res.status(400).json({ error: `That's more than ${MAX_RECIPIENTS} recipients — send it in smaller groups.` })

      // Clean and dedupe (by email, case-insensitive).
      const seen = new Set()
      const skipped = { invalid: 0, duplicate: 0 }
      const rows = []
      for (const r of b.recipients) {
        const email = cleanEmail(r?.email)
        if (!EMAIL_RE.test(email)) { skipped.invalid++; continue }
        if (seen.has(email)) { skipped.duplicate++; continue }
        seen.add(email)
        rows.push({ email, name: String(r.name || '').trim().slice(0, 120) || null, lead_id: Number.isFinite(Number(r.leadId)) && r.leadId ? Number(r.leadId) : null })
      }
      if (!rows.length) return res.status(400).json({ error: 'No valid recipients are left to send to.' })

      const actor = req.crmUser?.name || (req.headers['x-employee-name'] || '').toString().trim().slice(0, 80) || null
      const { data: bc, error } = await supabase.from('crm_broadcasts').insert({ subject, body, total: rows.length, created_by: actor }).select('*').single()
      if (error) throw error
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r, j) => ({ ...r, broadcast_id: bc.id, position: i + j }))
        const { error: rErr } = await supabase.from('crm_broadcast_recipients').insert(chunk)
        if (rErr) {
          await supabase.from('crm_broadcasts').delete().eq('id', bc.id) // don't leave a half-built queue behind
          throw rErr
        }
      }
      const hours = Math.max(0, Math.ceil(rows.length / PER_HOUR) - 1)
      logEvent(req, { action: 'broadcast.create', entityType: 'broadcast', entityId: bc.id, meta: { label: subject, detail: `Queued for ${rows.length} client${rows.length === 1 ? '' : 's'} at ${PER_HOUR} per hour` } })
      res.json({ ok: true, broadcast: bc, queued: rows.length, skipped, estimatedHours: hours, workerEnabled: workerOn })
    } catch (err) { fail(res, err, 'create') }
  })

  // GET /:id — one announcement with its per-recipient status.
  router.get('/:id', async (req, res) => {
    try {
      const { data: bc, error } = await supabase.from('crm_broadcasts').select('*').eq('id', req.params.id).maybeSingle()
      if (error) throw error
      if (!bc) return res.status(404).json({ error: 'Announcement not found' })
      const [pending, sending, sent, failed, skipped] = await Promise.all(['pending', 'sending', 'sent', 'failed', 'skipped'].map((s) => countStatus(bc.id, s)))
      let q = supabase.from('crm_broadcast_recipients').select('email, name, status, sent_at, error, position').eq('broadcast_id', bc.id).order('position', { ascending: true }).limit(1000)
      if (req.query.status) q = q.eq('status', String(req.query.status))
      const { data: recipients, error: rErr } = await q
      if (rErr) throw rErr
      res.json({ broadcast: bc, counts: { pending, sending, sent, failed, skipped, total: bc.total }, recipients: recipients || [] })
    } catch (err) { fail(res, err, 'detail') }
  })

  const setStatus = (action, from, to, verb) => async (req, res) => {
    try {
      const { data, error } = await supabase.from('crm_broadcasts').update({ status: to, ...(to === 'cancelled' ? { finished_at: nowIso() } : {}) }).eq('id', req.params.id).in('status', from).select('*')
      if (error) throw error
      if (!data?.length) return res.status(409).json({ error: `This announcement can't be ${verb} right now.` })
      if (to === 'cancelled') {
        await supabase.from('crm_broadcast_recipients').update({ status: 'skipped', error: 'Cancelled before sending' }).eq('broadcast_id', req.params.id).eq('status', 'pending')
      }
      await refreshCounts(req.params.id)
      logEvent(req, { action: `broadcast.${action}`, entityType: 'broadcast', entityId: req.params.id, meta: { label: data[0].subject } })
      res.json({ ok: true, status: to })
    } catch (err) { fail(res, err, action) }
  }
  router.post('/:id/pause', setStatus('pause', ['sending'], 'paused', 'paused'))
  router.post('/:id/resume', setStatus('resume', ['paused'], 'sending', 'resumed'))
  router.post('/:id/cancel', setStatus('cancel', ['sending', 'paused'], 'cancelled', 'cancelled'))

  return router
}
