// Team Activity name-tag — a convenience label, not a credential, so it lives in
// localStorage (persists across logins/tabs) rather than sessionStorage like the real
// auth tokens. Nothing here grants access to anything; it only labels actions an
// already-authenticated employee takes, for the admin-only Team Activity view.
const KEY = 'crm_employee_name'

export function getEmployeeName() {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

export function setEmployeeName(name) {
  try {
    const trimmed = (name || '').trim().slice(0, 80)
    if (trimmed) localStorage.setItem(KEY, trimmed)
    else localStorage.removeItem(KEY)
  } catch {
    // Private browsing / storage blocked — activity just goes unattributed, not fatal.
  }
}

/** Spread this into a fetch()'s headers object; empty object if no name is set. */
export function employeeNameHeader() {
  const name = getEmployeeName()
  return name ? { 'X-Employee-Name': name } : {}
}
