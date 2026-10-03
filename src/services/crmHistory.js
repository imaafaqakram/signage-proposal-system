// Turns raw crm_activity_log rows into plain-English history lines. Shared by the
// per-record History modal and the Team page's activity feed so both read the same.

const ENTITY = {
  expense: 'expense', order: 'order', material: 'material', vendor: 'vendor',
  purchase_order: 'purchase order', lead: 'lead', thread: 'conversation',
  template: 'reply template', user: 'account', settings: 'setting', broadcast: 'announcement'
}

const VERB = {
  create: 'added', update: 'edited', delete: 'deleted'
}

// Special actions that don't follow <entity>.<create|update|delete>.
const SPECIAL = {
  'auth.login': 'signed in',
  'auth.logout': 'signed out',
  'auth.login-failed': 'had a failed sign-in attempt',
  'user.create': 'created the account',
  'user.update': 'changed the account',
  'user.password-reset': 'reset the password for',
  'user.password-change': 'changed their password',
  'security.shared-login': 'changed the shared-password setting',
  'inbox.mark-all-read': 'marked every conversation as read',
  'thread.delete': 'deleted the conversation',
  'thread.status': 'changed the status of',
  'thread.reply': 'sent an email reply on',
  'stale.dismiss': 'dismissed the "gone quiet" flag on',
  'stale.send-followup': 'sent a follow-up to',
  'lead.follow-up-stop': 'stopped follow-ups for',
  'lead.follow-up-resume': 'resumed follow-ups for',
  'lead.update': 'updated',
  'material.adjust': 'adjusted stock for',
  'broadcast.create': 'queued the announcement',
  'broadcast.pause': 'paused the announcement',
  'broadcast.resume': 'resumed the announcement',
  'broadcast.cancel': 'cancelled the announcement',
  'broadcast.completed': 'finished sending the announcement',
  'broadcast.test': 'sent a test of the announcement'
}

export function entityName(type) { return ENTITY[type] || type || 'record' }

/** "edited the expense", "signed in", … — the verb phrase for one log row. */
export function describeAction(row) {
  const action = row.action || ''
  if (SPECIAL[action]) return SPECIAL[action]
  const [prefix, verb] = action.split('.')
  if (VERB[verb]) return `${VERB[verb]} the ${entityName(row.entity_type || prefix)}`
  return action.replace(/[._-]/g, ' ')
}

/** 'unit_cost' -> 'Unit cost' */
export function fieldLabel(key) {
  const s = String(key).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const MONEY_FIELDS = new Set(['amount', 'amount_charged', 'sales_tax', 'unit_cost', 'total_amount'])

export function formatValue(key, v) {
  if (v === null || v === undefined || v === '') return '—'
  if (MONEY_FIELDS.has(key) && Number.isFinite(Number(v))) {
    return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v)
  return s.length > 90 ? s.slice(0, 87) + '…' : s
}

export function relTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  const diff = Math.max(0, Date.now() - t)
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fullTime(iso) {
  return iso ? new Date(iso).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
}

/**
 * Bullet list of what changed / what the record looked like, from a row's meta:
 *   changes  -> [{ label, from, to }]
 *   snapshot -> [{ label, value }]
 *   detail   -> plain sentence
 */
export function summarizeMeta(row) {
  const meta = row.meta || {}
  return {
    label: meta.label || null,
    detail: meta.detail || null,
    changes: meta.changes ? Object.entries(meta.changes).map(([k, c]) => ({ label: fieldLabel(k), from: formatValue(k, c?.from), to: formatValue(k, c?.to) })) : [],
    snapshot: meta.snapshot ? Object.entries(meta.snapshot).map(([k, v]) => ({ label: fieldLabel(k), value: formatValue(k, v) })) : [],
    via: meta.user?.via || null
  }
}
