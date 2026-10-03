// Safety net for the live inbound email feed.
//
// The n8n workflow only ever sees NEW, UNREAD mail, and only at the instant it arrives. Anything it
// misses is gone for good: an email opened in webmail or on a phone before n8n got to it, a dropped
// IMAP connection, or a message too big to save in time (on 2026-10-01 a 6.6 MB inline photo took
// five client replies down — see crm-mail-utils.js). This looks at the mailbox itself instead:
// every few minutes it lists the INBOX headers for the last few days and imports anything the CRM
// does not have, read OR unread.
//
// How it stays safe:
//   • Read-only on the mailbox (EXAMINE + BODY.PEEK) — never marks, moves or deletes anything.
//   • Dedupes on the canonical Message-ID, so it also recognises the older rows the n8n feed saved
//     with a raw "Message-ID: <x>" header (see crm-mail-utils.js).
//   • Ignores messages younger than --min-age (default 6 min) so it never races the live feed.
//   • Never resurrects a conversation someone deleted in the CRM (crm-deleted-message-ids.json).
//   • Imports messages that are already read in the mailbox as READ (no unread badge), and messages
//     that are still unread as unread. Lead status/"Gone Quiet" dates only ever move forward.
//   • Capped per run, and a message that keeps failing is retried at most 3 times per server run.
//
// server.js runs it every 5 minutes when CRM_INBOX_RECONCILE=true (production only — staging
// shares the database, so two of them would race). By hand:
//   node crm-inbox-reconcile.js --dry-run                 # list what it would import, change nothing
//   node crm-inbox-reconcile.js --days 30 --min-age 0 --max 100   # one-time catch-up
import 'dotenv/config'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { ingestInboundEmail, loadDeletedMessageKeys, _crmSupabase as supabase } from './crm-db.js'
import { idKey } from './crm-mail-utils.js'

const SMTP_USER = process.env.SMTP_USER
const SMTP_PASS = process.env.SMTP_PASS
const IMAP_HOST = process.env.IMAP_HOST || 'imap.hostinger.com'
const ACCOUNT = (SMTP_USER || '').toLowerCase()
const MAX_MESSAGE_BYTES = 40 * 1024 * 1024 // anything bigger is reported, never downloaded
const MAX_ATTEMPTS = 3

const firstAddr = (a) => (a?.value?.[0]?.address || '').toLowerCase()
const nameOf = (a) => a?.value?.[0]?.name || ''
const joinAddrs = (a) => (a?.value || []).map((x) => x.address).filter(Boolean).join(', ')

async function knownKeys() {
  const keys = new Set()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('crm_messages')
      .select('message_id')
      .not('message_id', 'is', null)
      .range(from, from + 999)
    if (error) throw error
    for (const r of data) {
      const k = idKey(r.message_id)
      if (k) keys.add(k)
    }
    if (data.length < 1000) break
  }
  return keys
}

const failures = new Map() // idKey -> failed attempts since this process started
let running = false

/**
 * @param {object}  [o]
 * @param {number}  [o.days=3]            how far back to look
 * @param {number}  [o.minAgeMinutes=6]   leave newer messages to the live feed
 * @param {number}  [o.maxPerRun=12]      cap per run (the rest wait for the next run)
 * @param {boolean} [o.dryRun=false]      list + parse, write nothing
 */
export async function reconcileInbox({ days = 3, minAgeMinutes = 6, maxPerRun = 12, dryRun = false } = {}) {
  if (!SMTP_USER || !SMTP_PASS) return { skipped: 'no mailbox credentials' }
  if (running) return { skipped: 'already running' }
  running = true

  const result = { scanned: 0, alreadyHad: 0, tooNew: 0, deletedInCrm: 0, noId: 0, missing: 0, imported: 0, failed: 0, tooBig: 0, items: [] }
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    logger: false
  })
  client.on('error', () => {}) // a dropped socket must never crash the app — the next run just retries
  // Watchdog: a stalled connection must not leave `running` stuck on forever. Closing the socket makes
  // every pending call reject, so the finally blocks below run and the next scheduled run starts clean.
  const watchdog = setTimeout(() => client.close(), 5 * 60 * 1000)

  try {
    const known = await knownKeys()
    const deleted = loadDeletedMessageKeys()
    await client.connect()
    const lock = await client.getMailboxLock('INBOX', { readOnly: true })
    try {
      const since = new Date(Date.now() - days * 86400000)
      const rows = []
      for await (const m of client.fetch({ since }, { uid: true, flags: true, envelope: true, internalDate: true, size: true })) {
        rows.push({
          uid: m.uid,
          seen: !!m.flags?.has('\\Seen'),
          id: m.envelope?.messageId || '',
          date: m.envelope?.date || m.internalDate,
          size: m.size || 0,
          subject: m.envelope?.subject || '',
          from: m.envelope?.from?.[0]?.address || ''
        })
      }
      result.scanned = rows.length

      const youngerThan = Date.now() - minAgeMinutes * 60000
      const todo = []
      for (const r of rows.sort((a, b) => new Date(a.date) - new Date(b.date))) {
        const key = idKey(r.id)
        if (!key) { result.noId++; continue }
        if (known.has(key)) { result.alreadyHad++; continue }
        if (deleted.has(key)) { result.deletedInCrm++; continue }
        if (new Date(r.date).getTime() > youngerThan) { result.tooNew++; continue }
        if ((failures.get(key) || 0) >= MAX_ATTEMPTS) continue
        result.missing++
        todo.push({ ...r, key })
      }

      for (const r of todo.slice(0, maxPerRun)) {
        if (r.size > MAX_MESSAGE_BYTES) {
          result.tooBig++
          console.warn(`[inbox-reconcile] skipped ${(r.size / 1048576).toFixed(0)} MB message "${r.subject}" from ${r.from} — too big to import`)
          failures.set(r.key, MAX_ATTEMPTS)
          continue
        }
        try {
          const msg = await client.fetchOne(String(r.uid), { source: true }, { uid: true })
          if (!msg?.source) throw new Error('message is no longer in the mailbox')
          // skipImageLinks: keep inline pictures as cid: references instead of pasting them into
          // the HTML as megabytes of base64 (the original cause of the failures).
          const parsed = await simpleParser(msg.source, { skipImageLinks: true })
          const payload = {
            messageId: parsed.messageId || r.id,
            inReplyTo: parsed.inReplyTo || null,
            fromAddr: firstAddr(parsed.from),
            fromName: nameOf(parsed.from),
            toAddrs: joinAddrs(parsed.to),
            ccAddrs: joinAddrs(parsed.cc),
            subject: parsed.subject || '',
            bodyText: parsed.text || '',
            bodyHtml: parsed.html || '',
            sentAt: parsed.date ? parsed.date.toISOString() : new Date(r.date).toISOString(),
            accountAddress: ACCOUNT,
            attachments: (parsed.attachments || []).map((a) => ({
              filename: a.filename || 'attachment',
              contentType: a.contentType || null,
              size: a.size || null
            })),
            backfill: r.seen // already read in the mailbox -> stored as read, no unread badge
          }
          if (!payload.fromAddr) throw new Error('no from address')

          if (dryRun) {
            result.items.push({
              date: payload.sentAt,
              from: payload.fromAddr,
              subject: payload.subject,
              read: r.seen,
              rawMB: +(r.size / 1048576).toFixed(2),
              htmlKB: +((payload.bodyHtml || '').length / 1024).toFixed(1),
              textKB: +((payload.bodyText || '').length / 1024).toFixed(1),
              attachments: payload.attachments.length
            })
            continue
          }
          const res = await ingestInboundEmail(payload)
          if (res.status === 'duplicate') result.alreadyHad++
          else result.imported++
        } catch (e) {
          result.failed++
          failures.set(r.key, (failures.get(r.key) || 0) + 1)
          console.warn(`[inbox-reconcile] could not import "${r.subject}" from ${r.from}: ${e.message}`)
        }
      }
    } finally {
      lock.release()
    }
    if (result.imported || result.failed || result.tooBig) {
      console.log(
        `[inbox-reconcile] INBOX last ${days}d: scanned ${result.scanned} · missing ${result.missing} · imported ${result.imported} · failed ${result.failed}`
      )
    }
    return result
  } finally {
    clearTimeout(watchdog)
    await client.logout().catch(() => {})
    running = false
  }
}

// Direct CLI run
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (f, d) => {
    const i = process.argv.indexOf(f)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
  }
  const dryRun = process.argv.includes('--dry-run')
  console.log(dryRun ? 'DRY RUN — nothing is written\n' : '')
  reconcileInbox({
    days: parseInt(arg('--days', '3'), 10),
    minAgeMinutes: parseInt(arg('--min-age', '6'), 10),
    maxPerRun: parseInt(arg('--max', '12'), 10),
    dryRun
  })
    .then((r) => {
      const { items, ...summary } = r
      console.log(summary)
      for (const it of items || []) {
        console.log(`  ${it.date.slice(0, 16).replace('T', ' ')}  ${it.read ? 'read  ' : 'UNREAD'} ${it.from.slice(0, 30).padEnd(30)} ${it.subject.slice(0, 44).padEnd(44)} raw ${String(it.rawMB).padStart(5)} MB → html ${String(it.htmlKB).padStart(6)} KB, text ${it.textKB} KB, ${it.attachments} attachment(s)`)
      }
      process.exit(0)
    })
    .catch((e) => {
      console.error('[inbox-reconcile] failed:', e.message)
      process.exit(1)
    })
}
