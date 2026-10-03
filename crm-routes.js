// CRM Phase 1 API — mounted at /api/crm in server.js.
// Self-contained: its own SMTP transporter and DB layer (crm-db.js), so a bug
// here can't reach the proposal system's send or persistence paths.
//
//   app.use('/api/crm', createCrmRouter({ requireAuth }))
//
// `requireAuth` is the app's existing bypass-session middleware. The /ingest
// route is exempt (it's called by n8n) and instead checks a shared secret in
// the X-CRM-Ingest-Key header against process.env.CRM_INGEST_KEY.
import express from 'express'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { ImapFlow } from 'imapflow'
import {
  ingestInboundEmail,
  logOutboundEmail,
  listThreads,
  getThread,
  markThreadRead,
  markAllThreadsRead,
  deleteThread,
  setThreadStatus,
  inboxCounts
} from './crm-db.js'
import { logEvent } from './crm-audit.js'

const smtp = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: (process.env.SMTP_PORT || '465') === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false }
  })

// SMTP delivers a message to the recipient but never files a copy in the
// sender's IMAP "Sent" folder — that's a mail-client job. So a CRM reply is
// invisible in Hostinger webmail. After sending, we IMAP-APPEND the same
// message to Sent so it shows up there like any normal outgoing email.
// Best-effort: a failure here is logged and ignored, the reply already went out.
let _sentFolder = null
async function imapClient() {
  const c = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.hostinger.com',
    port: 993,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    logger: false
  })
  await c.connect()
  return c
}
async function appendToSentFolder(rawBuffer) {
  const client = await imapClient()
  try {
    if (!_sentFolder) {
      const boxes = await client.list()
      _sentFolder =
        boxes.find((b) => /\\Sent/i.test((b.specialUse || '')))?.path ||
        boxes.find((b) => /(^|[./])sent$/i.test(b.path))?.path ||
        'INBOX.Sent'
    }
    await client.append(_sentFolder, rawBuffer, ['\\Seen'])
  } finally {
    await client.logout().catch(() => {})
  }
}
function buildRawMessage(mailOptions) {
  return new Promise((resolve, reject) => {
    new MailComposer(mailOptions).compile().build((err, msg) => (err ? reject(err) : resolve(msg)))
  })
}
function newMessageId() {
  const domain = (process.env.SMTP_USER || 'signagecrafting.com').split('@').pop() || 'signagecrafting.com'
  return `<crm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@${domain}>`
}

function firstAddr(v) {
  if (!v) return ''
  if (Array.isArray(v)) return firstAddr(v[0])
  if (typeof v === 'object') return (v.address || v.value?.[0]?.address || '').toLowerCase()
  const m = String(v).match(/<([^>]+)>/)
  return (m ? m[1] : String(v)).trim().toLowerCase()
}
function nameOf(v) {
  if (!v) return ''
  if (Array.isArray(v)) return nameOf(v[0])
  if (typeof v === 'object') return v.name || v.value?.[0]?.name || ''
  const m = String(v).match(/^\s*"?([^"<]+?)"?\s*</)
  return m ? m[1].trim() : ''
}
function joinAddrs(v) {
  if (!v) return ''
  if (Array.isArray(v)) return v.map(firstAddr).filter(Boolean).join(', ')
  if (typeof v === 'object' && Array.isArray(v.value)) return v.value.map((x) => x.address).join(', ')
  return String(v)
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// The composer lets a user drop links in as [label](https://…) (a "🔗 Link" button
// builds that string). Only http/https/mailto are turned into anchors — anything
// else is left as literal text so a reply can't smuggle a javascript: URI.
const SAFE_URL = /^(https?:\/\/|mailto:)/i

// Plain-text part: unwrap [label](url) → "label: url" so it still reads on a
// text-only client; bare URLs are left as-is (every mail client auto-links them).
function replyToText(body) {
  return String(body).replace(/\[([^\]]+)\]\((\S+?)\)/g, (m, label, url) =>
    SAFE_URL.test(url) ? `${label}: ${url}` : m
  )
}

// HTML part: escape everything first, THEN re-introduce anchors. Because the
// whole string is already escaped at this point, the captured URLs are already
// attribute-safe (`&` is `&amp;`) — do not escape them again.
function replyToHtml(body) {
  let html = escapeHtml(body)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi,
    (m, label, url) => `<a href="${url}" style="color:#0b7285;font-weight:600;">${label}</a>`
  )
  // bare URLs not already inside an anchor
  html = html.replace(
    /(^|[\s(])((?:https?:\/\/)[^\s<)]+)/gi,
    (m, pre, url) => `${pre}<a href="${url}" style="color:#0b7285;">${url}</a>`
  )
  html = html.replace(/\n/g, '<br>')
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2933;">${html}</div>`
}

// A reply only needs the HTML part when it actually contains a link.
const bodyHasLink = (body) => /\[[^\]]+\]\(https?:\/\/|\[[^\]]+\]\(mailto:|https?:\/\//i.test(String(body))

export function createCrmRouter({ requireAuth } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())

  // ── ingest: called by n8n on each new inbound email ──────
  router.post('/ingest', express.json({ limit: '25mb' }), async (req, res) => {
    const key = req.get('X-CRM-Ingest-Key')
    if (process.env.CRM_INGEST_KEY && key !== process.env.CRM_INGEST_KEY) {
      return res.status(401).json({ error: 'bad ingest key' })
    }
    try {
      const b = req.body || {}
      // Accept either already-flat fields or n8n's raw parsed-email shape.
      const payload = {
        messageId: b.messageId || b.message_id || b.headers?.['message-id'] || null,
        inReplyTo: b.inReplyTo || b.in_reply_to || b.headers?.['in-reply-to'] || null,
        fromAddr: firstAddr(b.fromAddr || b.from),
        fromName: b.fromName || nameOf(b.from),
        toAddrs: b.toAddrs || joinAddrs(b.to),
        ccAddrs: b.ccAddrs || joinAddrs(b.cc),
        subject: b.subject || '',
        bodyText: b.bodyText || b.text || '',
        bodyHtml: b.bodyHtml || b.html || '',
        sentAt: b.sentAt || b.date || null,
        accountAddress: b.accountAddress || firstAddr(b.to) || process.env.SMTP_USER,
        attachments: (b.attachments || []).map((a) => ({
          filename: a.filename || a.name || 'attachment',
          contentType: a.contentType || a.type || null,
          size: a.size || a.length || null
        }))
      }
      if (!payload.fromAddr) return res.status(400).json({ error: 'no from address' })

      const result = await ingestInboundEmail(payload)
      res.status(200).json(result)
    } catch (err) {
      console.error('[crm] ingest error:', err)
      res.status(500).json({ error: 'ingest failed', detail: err.message })
    }
  })

  // ── inbox ───────────────────────────────────────────────
  router.get('/counts', auth, async (req, res) => {
    try {
      res.json(await inboxCounts())
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/threads', auth, async (req, res) => {
    try {
      const threads = await listThreads({
        status: req.query.status,
        q: req.query.q,
        limit: Math.min(parseInt(req.query.limit) || 50, 200),
        offset: parseInt(req.query.offset) || 0
      })
      res.json({ threads })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/threads/:id', auth, async (req, res) => {
    try {
      const thread = await getThread(req.params.id)
      if (!thread) return res.status(404).json({ error: 'not found' })
      res.json(thread)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/threads/:id/read', auth, async (req, res) => {
    try {
      await markThreadRead(req.params.id)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // POST /threads/mark-all-read — one click clears every unread badge in the
  // inbox at once, instead of opening each thread individually.
  router.post('/threads/mark-all-read', auth, async (req, res) => {
    try {
      await markAllThreadsRead()
      logEvent(req, { action: 'inbox.mark-all-read', entityType: 'thread', entityId: null })
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm] mark-all-read', err)
      res.status(500).json({ error: err.message })
    }
  })

  // DELETE /threads/:id — permanent, not an archive (setThreadStatus('archived')
  // already covers "hide it but keep it"; this is for when someone actually wants
  // it gone). The frontend is expected to confirm with the user before calling
  // this — nothing here asks again.
  router.delete('/threads/:id', auth, async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })
      await deleteThread(id)
      logEvent(req, { action: 'thread.delete', entityType: 'thread', entityId: id })
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm] delete thread', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/threads/:id/status', auth, express.json(), async (req, res) => {
    try {
      const status = (req.body?.status || '').trim()
      if (!['open', 'responded', 'archived'].includes(status)) {
        return res.status(400).json({ error: 'bad status' })
      }
      await setThreadStatus(req.params.id, status)
      logEvent(req, { action: 'thread.status', entityType: 'thread', entityId: req.params.id, meta: { detail: `Marked the conversation ${status}` } })
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── reply from the inbox ────────────────────────────────
  router.post('/threads/:id/reply', auth, express.json({ limit: '5mb' }), async (req, res) => {
    try {
      const body = (req.body?.body || '').trim()
      if (!body) return res.status(400).json({ error: 'empty reply' })

      const thread = await getThread(req.params.id)
      if (!thread) return res.status(404).json({ error: 'thread not found' })

      const to = thread.counterparty || thread.lead?.contact_email
      if (!to) return res.status(400).json({ error: 'no recipient on this thread' })

      const lastInbound = [...thread.messages].reverse().find((m) => m.direction === 'inbound')
      const baseSubject = (thread.subject || '').replace(/^(\s*re\s*:\s*)+/i, '')
      const subject = `Re: ${baseSubject}`.trim()
      const fromName = req.body?.fromName || process.env.SMTP_FROM_NAME || 'Signage Crafting'

      // Send a multipart text+HTML message only when the body carries a link
      // (Payment link, proposal link, …); a plain note stays text-only.
      const withLink = bodyHasLink(body)
      const textPart = replyToText(body)
      const htmlPart = withLink ? replyToHtml(body) : null

      // Fix the Message-ID ourselves so the SMTP-sent copy, the Sent-folder
      // copy, and our DB row all share one id — the Sent-folder watcher then
      // dedupes cleanly instead of logging this reply a second time.
      const messageId = newMessageId()
      const mailOptions = {
        from: `"${fromName}" <${process.env.SMTP_USER}>`,
        to,
        subject,
        messageId,
        text: textPart,
        ...(htmlPart ? { html: htmlPart } : {}),
        ...(lastInbound?.message_id
          ? { inReplyTo: lastInbound.message_id, references: lastInbound.message_id }
          : {})
      }

      const info = await smtp().sendMail(mailOptions)
      const sentId = info.messageId || messageId

      // Drop a copy into the mailbox's Sent folder so it's visible in webmail.
      buildRawMessage(mailOptions)
        .then((raw) => appendToSentFolder(raw))
        .catch((err) => console.warn('[crm] Sent-folder copy failed (non-critical):', err.message))

      const logged = await logOutboundEmail({
        threadId: thread.id,
        leadId: thread.lead_id || null,
        messageId: sentId,
        inReplyTo: lastInbound?.message_id || null,
        fromAddr: process.env.SMTP_USER,
        fromName,
        toAddr: to,
        subject,
        bodyText: textPart,
        bodyHtml: htmlPart,
        sentAt: new Date().toISOString()
      })

      logEvent(req, { action: 'thread.reply', entityType: 'thread', entityId: thread.id, meta: { label: subject, detail: `Emailed ${to}` } })
      res.json({ ok: true, messageId: sentId, ...logged })
    } catch (err) {
      console.error('[crm] reply error:', err)
      res.status(500).json({ error: 'reply failed', detail: err.message })
    }
  })

  return router
}
