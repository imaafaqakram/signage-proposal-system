// Small fetch helper for the CRM's own /api/crm/* routes.
//
// Two session tokens live in sessionStorage (see authStore / adminAuthStore): the regular
// one for employee-tier routes and the admin one for money/team routes. A personal admin
// account gets both at sign-in, so the same helper works for every kind of login.
import { employeeNameHeader } from '@/services/crmActivity'

export const bypassToken = () => {
  try { return sessionStorage.getItem('admin_bypass_token') || '' } catch { return '' }
}
export const adminToken = () => {
  try { return sessionStorage.getItem('owner_admin_token') || '' } catch { return '' }
}

/** JSON request to /api/crm{path}. Throws Error(message) with .status and .code on failure. */
export async function crmJson(path, { admin = false, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`/api/crm${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${admin ? adminToken() : bypassToken()}`,
      ...employeeNameHeader(),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status
    err.code = data.code
    err.data = data
    throw err
  }
  return data
}
