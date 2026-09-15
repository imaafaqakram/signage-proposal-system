// One-time (re-runnable) importer: pulls existing mailbox history into the CRM.
//
// The n8n IMAP trigger only ever sees NEW / unseen mail from the moment it's
// activated — it will not backfill the emails already sitting (read) in the
// webmail box. This script does that: it connects once, walks INBOX + Sent for
// the last N days, and runs every message through the same threading /
// lead-matching / status logic the live ingest uses.
//
//   node crm-backfill.js                 # last 120 days, INBOX + Sent
//   node crm-backfill.js --days 365      # go back a year
//   node crm-backfill.js --inbox-only
//   node crm-backfill.js --dry-run       # parse + match, write nothing
//
// Credentials come from the SAME .env the app already uses for SMTP
// (SMTP_USER / SMTP_PASS) — Hostinger uses one login for IMAP and SMTP. IMAP
// host defaults to imap.hostinger.com, override with IMAP_HOST.
//
// Nothing is marked read (BODY.PEEK). Safe to re-run — messages are deduped by
// RFC Message-ID.
import 'dotenv/config'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { ingestInboundEmail, logOutboundEmail, findLeadByEmail, _crmSupabase as supabase } from './crm-db.js'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f, d) => {
  const i = args.indexOf(f)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}

const DAYS = parseInt(val('--days', '120'), 10)
const DRY = has('--dry-run')
const INBOX_ONLY = has('--inbox-only')
const SENT_ONLY = has('--sent-only')

const SMTP_USER = process.env.SMTP_USER
const SMTP_PASS = process.env.SMTP_PASS
const IMAP_HOST = process.env.IMAP_HOST || 'imap.hostinger.com'
const ACCOUNT = (SMTP_USER || '').toLowerCase()

if (!SMTP_USER || !SMTP_PASS) {
  console.error('SMTP_USER / SMTP_PASS not set in .env — cannot connect.')
  process.exit(1)
}

const since = new Date(Date.now() - DAYS * 86400000)
const THROTTLE_MS = parseInt(val('--throttle', '200'), 10)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A handful of historical messages (long quoted Gmail reply chains, outbound
// proposal emails with big inline HTML) carry multi-MB bodies. Inserting a row
// that large overruns crm-db's 15s Supabase abort timeout every time, no matter
// the throttle. For backfill we don't need the full raw body — clip it so the
// row still lands. Live ingest (normal-sized mail) is unaffected.
const BODY_CLIP = parseInt(val('--body-clip', '180000'), 10)
const clip = (s) =>
  s && s.length > BODY_CLIP
    ? s.slice(0, BODY_CLIP) + '\n\n[… truncated by backfill — full copy remains in the mailbox]'
    : s || ''

// The full ingest path is ~10 Supabase round-trips per message; a tight loop over
// a few hundred messages overruns the connection pool and calls start timing out.
// Retry a timed-out op a couple of times with backoff before giving up on it.
async function withRetry(fn, tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!/timeout|aborted|ETIMEDOUT|fetch failed/i.test(e.message)) throw e
      await sleep(1000 * (i + 1))
    }
  }
  throw lastErr
}

function firstAddr(a) {
  if (!a) return ''
  const v = a.value?.[0]
  return (v?.address || '').toLowerCase()
}
function nameOf(a) {
  return a?.value?.[0]?.name || ''
}
function joinAddrs(a) {
  return (a?.value || []).map((x) => x.address).filter(Boolean).join(', ')
}

async function knownMessageIds() {
  const ids = new Set()
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('crm_messages')
      .select('message_id')
      .not('message_id', 'is', null)
      .range(from, from + 999)
    if (error) throw error
    if (!data.length) break
    for (const r of data) ids.add(r.message_id)
    if (data.length < 1000) break
    from += 1000
  }
  return ids
}

async function run() {
  console.log(`\nCRM backfill — mailbox ${ACCOUNT} @ ${IMAP_HOST}`)
  console.log(`Window: since ${since.toISOString().slice(0, 10)} (${DAYS} days)`)
  console.log(DRY ? 'DRY RUN — nothing will be written\n' : '')

  const seen = await knownMessageIds()
  console.log(`Already in CRM: ${seen.size} messages\n`)

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    logger: false
  })
  await client.connect()

  const folders = []
  if (!SENT_ONLY) folders.push({ path: 'INBOX', dir: 'inbound' })
  if (!INBOX_ONLY) {
    // Hostinger's sent folder is usually "INBOX.Sent"; fall back to "Sent"
    const list = await client.list()
    const sent = list.find((f) => /(\bsent\b|\.sent$)/i.test(f.path))
    if (sent) folders.push({ path: sent.path, dir: 'outbound' })
  }

  const totals = { stored: 0, duplicate: 0, matched: 0, failed: 0, scanned: 0 }

  for (const folder of folders) {
    const lock = await client.getMailboxLock(folder.path)
    try {
      console.log(`── ${folder.path} (${folder.dir}) ──`)
      let count = 0
      for await (const msg of client.fetch(
        { since },
        { envelope: true, source: true },
        { uid: true }
      )) {
        totals.scanned++
        count++
        let parsed
        try {
          parsed = await simpleParser(msg.source)
        } catch (e) {
          totals.failed++
          continue
        }
        const messageId = parsed.messageId || null
        if (messageId && seen.has(messageId)) {
          totals.duplicate++
          continue
        }

        try {
          if (folder.dir === 'inbound') {
            const res = DRY
              ? { status: 'dry', matchedLead: await findLeadByEmail(firstAddr(parsed.from)) }
              : await withRetry(() => ingestInboundEmail({
                  messageId,
                  inReplyTo: parsed.inReplyTo || null,
                  fromAddr: firstAddr(parsed.from),
                  fromName: nameOf(parsed.from),
                  toAddrs: joinAddrs(parsed.to),
                  ccAddrs: joinAddrs(parsed.cc),
                  subject: parsed.subject || '',
                  bodyText: clip(parsed.text),
                  bodyHtml: clip(parsed.html),
                  sentAt: parsed.date ? parsed.date.toISOString() : null,
                  accountAddress: ACCOUNT,
                  attachments: (parsed.attachments || []).map((a) => ({
                    filename: a.filename || 'attachment',
                    contentType: a.contentType || null,
                    size: a.size || null
                  })),
                  backfill: true
                }))
            if (res.status === 'duplicate') totals.duplicate++
            else totals.stored++
            if (res.matchedLead) totals.matched++
          } else {
            const toAddr = firstAddr(parsed.to)
            const lead = await withRetry(() => findLeadByEmail(toAddr))
            if (!DRY) {
              await withRetry(() => logOutboundEmail({
                threadId: null,
                leadId: lead ? lead.id : null,
                messageId,
                inReplyTo: parsed.inReplyTo || null,
                fromAddr: firstAddr(parsed.from) || ACCOUNT,
                fromName: nameOf(parsed.from),
                toAddr,
                ccAddrs: joinAddrs(parsed.cc),
                subject: parsed.subject || '',
                bodyText: clip(parsed.text),
                bodyHtml: clip(parsed.html),
                sentAt: parsed.date ? parsed.date.toISOString() : null
              }))
            }
            totals.stored++
            if (lead) totals.matched++
          }
          if (messageId) seen.add(messageId)
          await sleep(THROTTLE_MS)
        } catch (e) {
          totals.failed++
          console.warn(`  ! ${messageId || '(no id)'}: ${e.message}`)
        }
        if (count % 50 === 0) process.stdout.write(`  …${count}\n`)
      }
      console.log(`  scanned ${count}`)
    } finally {
      lock.release()
    }
  }

  await client.logout()
  console.log(
    `\nDone. scanned ${totals.scanned} · imported ${totals.stored} · already had ${totals.duplicate} · lead-matched ${totals.matched} · failed ${totals.failed}\n`
  )
}

run().catch((e) => {
  console.error('backfill failed:', e)
  process.exit(1)
})
