import { ref, computed } from 'vue'
import { getEmployeeName, setEmployeeName } from '@/services/crmActivity'
import { bypassToken } from '@/services/crmApi'

// Who is signed in to the CRM. Two kinds of session exist:
//   • personal — a named account from the Team page ({ id, name, username, role }); every
//     action is stamped with that person server-side.
//   • shared   — the older shared-password login; there is no account, only the free-text
//     name typed at sign-in, and the history marks those entries as unverified.
// The personal user is kept in sessionStorage next to the token (same lifetime); the server
// re-checks the token on every request, so this is display state, never a credential.
const KEY = 'crm_user'

function read() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { return null }
}

const current = ref(read())

export function setCrmUser(user) {
  current.value = user || null
  try {
    if (user) sessionStorage.setItem(KEY, JSON.stringify(user))
    else sessionStorage.removeItem(KEY)
  } catch { /* storage blocked — the name just won't persist across a reload */ }
}

export function clearCrmSession() {
  setCrmUser(null)
  try {
    sessionStorage.removeItem('admin_bypass_token')
    sessionStorage.removeItem('owner_admin_token')
  } catch { /* ignore */ }
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function useCrmUser() {
  const user = computed(() => current.value)
  const isPersonal = computed(() => !!current.value)
  // A personal account is admin only if its role says so; on the shared login, an admin is
  // whoever has already unlocked the admin tier this session.
  const isAdmin = computed(() => (current.value ? current.value.role === 'admin' : !!sessionStorage.getItem('owner_admin_token')))
  const isEmployeeOnly = computed(() => !!current.value && current.value.role !== 'admin')
  const displayName = computed(() => current.value?.name || getEmployeeName() || '')

  /** Ends the session server-side and locally. Callers then send the user to /login. */
  async function logout() {
    const token = bypassToken()
    if (token) {
      const endpoint = current.value ? '/api/crm/auth/logout' : '/api/auth/logout'
      await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    }
    clearCrmSession()
  }

  return { user, isPersonal, isAdmin, isEmployeeOnly, displayName, logout, setEmployeeName }
}
