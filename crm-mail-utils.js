// Pure helpers (no I/O) shared by the live inbound ingest, the inbox reconciler and the one-time
// Message-ID repair script.
//
// Why this exists. The n8n workflow that feeds the CRM has two quirks:
//   1. It passes the RAW header line ("Message-ID: <abc@host>") instead of just "<abc@host>", so
//      stored ids never matched the clean ids every other path uses (dedupe + reply threading).
//   2. Its "resolved" email format pastes every inline picture into the HTML as base64 text. One
//      tiny reply carrying a 6.6 MB photo became a ~9 MB "message body" that overran the CRM's
//      15-second database limit; the save failed and, because n8n only ever looks at UNREAD mail,
//      the email was never retried.

export const MAX_BODY = 180000

/** Message-ID / In-Reply-To in canonical "<id@host>" form (first id when several); null if none. */
export function normalizeMessageId(id) {
  if (id === null || id === undefined) return null
  const s = String(id)
    .replace(/^\s*(?:message-id|in-reply-to|references)\s*:/i, '')
    .replace(/\s+/g, '') // folded header lines, stray newlines
  if (!s) return null
  const m = s.match(/<[^<>]+>/)
  if (m) return m[0]
  return `<${s.replace(/^<+|>+$/g, '')}>`
}

/** Case-insensitive comparison key for a Message-ID ('' when there is none). */
export function idKey(id) {
  const n = normalizeMessageId(id)
  return n ? n.toLowerCase() : ''
}

/** True when a stored id is not already in canonical form. */
export function isMalformedId(id) {
  return id !== null && id !== undefined && id !== '' && normalizeMessageId(id) !== id
}

// 1x1 transparent GIF — stands in for a stripped inline picture so the layout doesn't collapse.
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const MIN_STRIP = 2000 // inline pictures shorter than this (icons, tracking pixels) are left alone

/**
 * Replaces large inline base64 pictures (src/background/poster attributes and CSS url()) with a
 * 1px stand-in. Deliberately a plain indexOf scan, NOT a regex over the value: a single regex
 * quantifier across a multi-megabyte attribute overflows V8's stack ("Maximum call stack size
 * exceeded") — exactly the messages this exists to rescue.
 */
export function stripInlineData(html) {
  if (!html) return html
  const s = String(html)
  if (s.length < MIN_STRIP || !/data:/i.test(s)) return s

  let out = ''
  let last = 0
  const attr = /(\s(?:src|background|poster)\s*=\s*)(["'])data:/gi // matches only the START of the attribute
  let m
  while ((m = attr.exec(s))) {
    const valueStart = m.index + m[1].length + 1 // just after the opening quote
    const end = s.indexOf(m[2], valueStart)
    if (end === -1) break // unterminated quote — leave the rest untouched
    attr.lastIndex = end + 1
    if (end - valueStart < MIN_STRIP) continue
    out += s.slice(last, valueStart) + PIXEL
    last = end
  }
  out += s.slice(last)

  // CSS: background:url(data:...) — base64 never contains ")", so the first ")" closes it.
  if (!/url\(\s*["']?data:/i.test(out)) return out
  let res = ''
  let from = 0
  const css = /url\(\s*["']?data:/gi
  while ((m = css.exec(out))) {
    const close = out.indexOf(')', m.index)
    if (close === -1) break
    css.lastIndex = close + 1
    if (close - m.index < MIN_STRIP) continue
    res += out.slice(from, m.index) + 'url()'
    from = close + 1
  }
  return res + out.slice(from)
}

const HTML_NOTE = '<p style="color:#888;font-size:12px">[… truncated by the CRM — the full message is still in the mailbox]</p>'
const TEXT_NOTE = '\n\n[… truncated by the CRM — the full message is still in the mailbox]'

/** HTML body safe to store: inline pictures stripped, then clipped to MAX_BODY. */
export function slimHtml(html, max = MAX_BODY) {
  if (!html) return html
  const out = stripInlineData(html)
  return out.length > max ? out.slice(0, max) + HTML_NOTE : out
}

/** Plain-text body clipped to MAX_BODY. */
export function clipText(text, max = MAX_BODY) {
  if (!text) return text
  const s = String(text)
  return s.length > max ? s.slice(0, max) + TEXT_NOTE : s
}
