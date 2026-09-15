// Incremental "Sent folder -> CRM" sync.
//
// The n8n IMAP trigger only watches INBOX, so any email sent straight from
// Hostinger webmail (or Outlook, phone, etc.) never reaches the CRM. This walks
// the mailbox's Sent folder for anything new and logs it as an OUTBOUND message,
// threaded onto the client's conversation — so "who we've replied to" is complete
// no matter where the reply was written.
//
// server.js calls pollSentFolder() on a timer; it can also be run by hand:
//   node crm-sent-poll.js            # last 3 days of Sent, dedup by Message-ID
//   node crm-sent-poll.js --days 7
//
// Safe + idempotent: BODY.PEEK (never marks anything read), dedupes on RFC
// Message-ID against crm_messages, so re-running it costs nothing. CRM replies
// that land in Sent (see crm-routes.js appendToSentFolder) are already logged by
// the reply route and get skipped here by the same Message-ID check.
import 'dotenv/config'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { logOutboundEmail, findLeadByEmail, _crmSupabase as supabase } from './crm-db.js'

const SMTP_USER = process.env.SMTP_USER
const SMTP_PASS = process.env.SMTP_PASS
const IMAP_HOST = process.env.IMAP_HOST || 'imap.hostinger.com'
const ACCOUNT = (SMTP_USER || '').toLowerCase()

const firstAddr = (a) => (a?.value?.[0]?.address || '').toLowerCase()
const nameOf = (a) => a?.value?.[0]?.name || ''
const joinAddrs = (a) => (a?.value || []).map((x) => x.address).filter(Boolean).join(', ')

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

let _polling = false

/**
 * Walk the Sent folder for anything not already in crm_messages and log it as
 * outbound. Guarded so overlapping timer ticks can't run it twice at once.
 * @param {object} [opts]
 * @param {number} [opts.days=3]  how far back to look
 */
export async function pollSentFolder({ days = 3 } = {}) {
  if (!SMTP_USER || !SMTP_PASS) return { skipped: 'no SMTP credentials' }
  if (_polling) return { skipped: 'already running' }
  _polling = true
  const since = new Date(Date.now() - days * 86400000)

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    logger: false
  })

  const seen = await knownMessageIds()
  let scanned = 0
  let imported = 0
  let duplicate = 0
  let matched = 0

  try {
    await client.connect()

    // Hostinger's sent folder is "INBOX.Sent"; fall back to \Sent special-use or "Sent".
    const boxes = await client.list()
    const sentPath =
      boxes.find((b) => /\\Sent/i.test(b.specialUse || ''))?.path ||
      boxes.find((b) => /(^|[./])sent$/i.test(b.path))?.path ||
      'INBOX.Sent'

    const lock = await client.getMailboxLock(sentPath)
    try {
      for await (const msg of client.fetch({ since }, { envelope: true, source: true }, { uid: true })) {
        scanned++
        let parsed
        try {
          parsed = await simpleParser(msg.source)
        } catch {
          continue
        }
        const messageId = parsed.messageId || null
        if (messageId && seen.has(messageId)) {
          duplicate++
          continue
        }

        const toAddr = firstAddr(parsed.to)
        let lead = null
        try {
          lead = await findLeadByEmail(toAddr)
        } catch {
          /* non-fatal */
        }

        try {
          await logOutboundEmail({
            threadId: null,
            leadId: lead ? lead.id : null,
            messageId,
            inReplyTo: parsed.inReplyTo || null,
            fromAddr: firstAddr(parsed.from) || ACCOUNT,
            fromName: nameOf(parsed.from),
            toAddr,
            ccAddrs: joinAddrs(parsed.cc),
            subject: parsed.subject || '',
            bodyText: (parsed.text || '').slice(0, 180000),
            bodyHtml: (parsed.html || '').slice(0, 180000),
            sentAt: parsed.date ? parsed.date.toISOString() : new Date().toISOString()
          })
          imported++
          if (lead) matched++
          if (messageId) seen.add(messageId)
        } catch (e) {
          console.warn(`  ! ${messageId || '(no id)'}: ${e.message}`)
        }
      }
    } finally {
      lock.release()
    }

    if (imported || scanned > duplicate) {
      console.log(
        `[sent-poll] ${sentPath}: scanned ${scanned} · imported ${imported} · already had ${duplicate} · lead-matched ${matched}`
      )
    }
    return { sentPath, scanned, imported, duplicate, matched }
  } finally {
    await client.logout().catch(() => {})
    _polling = false
  }
}

// Direct CLI run: `node crm-sent-poll.js [--days N]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--days')
  const days = i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : 3
  pollSentFolder({ days })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[sent-poll] failed:', e.message)
      process.exit(1)
    })
}
