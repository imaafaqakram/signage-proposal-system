import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// A SECOND, separate session tier from useAuthStore's employee bypass — different token,
// different sessionStorage key, different server endpoints (/api/admin/auth/*, checked
// against admin-settings.json's adminPassword, never the shared employee password). This
// intentionally does not reuse useAuthStore: knowing the employee password must never be
// enough to reach anything in here.
export const useAdminAuthStore = defineStore('adminAuth', () => {
  const authenticated = ref(false)
  const loading = ref(false)

  const isAuthenticated = computed(() => authenticated.value)

  const initialize = async () => {
    const token = sessionStorage.getItem('owner_admin_token')
    if (!token) return
    try {
      const response = await fetch('/api/admin/auth/check', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const result = await response.json().catch(() => ({}))
      authenticated.value = response.ok && result.ok === true
      if (!authenticated.value) sessionStorage.removeItem('owner_admin_token')
    } catch {
      authenticated.value = false
    }
  }

  const login = async (password) => {
    loading.value = true
    try {
      const response = await fetch('/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Invalid admin password')
      sessionStorage.setItem('owner_admin_token', result.token)
      authenticated.value = true
    } finally {
      loading.value = false
    }
  }

  const logout = async () => {
    const token = sessionStorage.getItem('owner_admin_token')
    sessionStorage.removeItem('owner_admin_token')
    authenticated.value = false
    if (token) {
      fetch('/api/admin/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    }
  }

  // All /api/admin/* calls other than auth/* itself go through this, so a lapsed or wrong
  // token surfaces as a normal caught error instead of a silent 401.
  const authedFetch = async (url, options = {}) => {
    const token = sessionStorage.getItem('owner_admin_token')
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token || ''}` }
    })
    if (response.status === 401) {
      authenticated.value = false
      sessionStorage.removeItem('owner_admin_token')
    }
    return response
  }

  return { isAuthenticated, loading, initialize, login, logout, authedFetch }
})
