import { ref } from 'vue'

// Module-level (not per-component) — every CRM page that shows the nav badge shares
// this one poller instead of each page running its own fetch loop. Same sharing
// pattern as usePublicSettings.js. Backed by GET /api/crm/counts (crm-routes.js ->
// crm-db.js's inboxCounts()) — the same endpoint CrmInbox.vue's own header stat
// already uses, so the nav badge and the Inbox page's own count can never disagree.
const unreadCount = ref(0)
const POLL_MS = 30000
let started = false
let timer = null

function token() {
  return sessionStorage.getItem('admin_bypass_token') || ''
}

async function refresh() {
  try {
    const res = await fetch('/api/crm/counts', { headers: { Authorization: `Bearer ${token()}` } })
    if (!res.ok) return
    const data = await res.json()
    unreadCount.value = data.unread || 0
  } catch {
    // A failed poll must never crash or blank out the badge — just keep the last
    // known count until the next successful poll.
  }
}

export function useInboxUnread() {
  if (!started) {
    started = true
    refresh()
    timer = setInterval(refresh, POLL_MS)
  }
  return { unreadCount, refreshUnreadCount: refresh }
}
