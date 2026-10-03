import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase, isAdminBypassMode, verifyAdminPassword, checkAdminSession, isSupabaseConfigured } from '@/services/supabase'
import { setEmployeeName } from '@/services/crmActivity'
import { setCrmUser, clearCrmSession } from '@/composables/useCrmUser'

// The CRM host has extra session state (admin-tier token, personal-account details) that the
// Proposal System never uses — so on the proposal host a lapsed session is dropped exactly as
// it always was (the employee token only), and only the CRM host clears the extra keys.
const onCrmHost = () => typeof location !== 'undefined' && /^crm\./i.test(location.hostname)
const dropSession = () => {
  if (onCrmHost()) clearCrmSession()
  else sessionStorage.removeItem('admin_bypass_token')
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const loading = ref(false)
  const bypassMode = ref(isAdminBypassMode())

  const isAuthenticated = computed(() => {
    // If bypass mode is enabled, consider authenticated if bypass password was verified
    if (bypassMode.value) {
      return user.value?.bypassAuthenticated === true
    }
    // Otherwise, check Supabase auth
    return user.value !== null
  })

  // Initialize auth state
  const initialize = async () => {
    if (bypassMode.value) {
      // Re-validates the stored token against the server on every load, rather than
      // trusting a client-set flag — a stale/tampered sessionStorage value alone can't
      // grant access, since the server only recognizes tokens it actually issued.
      // sessionStorage (not localStorage), same as before this change — a new browser
      // session still means logging in again, that behavior isn't changing here.
      const token = sessionStorage.getItem('admin_bypass_token')
      let valid = await checkAdminSession(token)
      // On the CRM host also confirm the CRM itself still accepts this session — e.g. an
      // admin has since switched on "require personal logins", or this person's account
      // was disabled. Only a definite 401 ends the session; a network blip does not.
      if (valid && onCrmHost()) {
        try {
          const res = await fetch('/api/crm/auth/me', { headers: { Authorization: `Bearer ${token}` } })
          if (res.status === 401) valid = false
          else if (res.ok) {
            const me = await res.json().catch(() => null)
            if (me?.personal && me.user) { setCrmUser(me.user); setEmployeeName(me.user.name) }
            else setCrmUser(null)
          }
        } catch { /* keep the session; CRM calls will surface any real problem */ }
      }
      if (valid) {
        user.value = { bypassAuthenticated: true, email: 'admin@bypass' }
      } else {
        dropSession()
      }
      return
    }

    if (!isSupabaseConfigured()) {
      console.warn('Supabase not configured')
      return
    }

    loading.value = true
    try {
      const { data: { session } } = await supabase.auth.getSession()
      user.value = session?.user ?? null

      // Listen for auth changes
      supabase.auth.onAuthStateChange((_event, session) => {
        user.value = session?.user ?? null
      })
    } catch (error) {
      console.error('Auth initialization error:', error)
    } finally {
      loading.value = false
    }
  }

  // Admin bypass login. employeeName is optional — a convenience label for the Team
  // Activity view, stored client-side only, never part of the auth check itself.
  const bypassLogin = async (password, employeeName) => {
    if (!bypassMode.value) {
      throw new Error('Bypass mode is not enabled')
    }
    // Throws with the server's own message (e.g. "Invalid bypass password") on failure —
    // same behavior callers already expect, just verified server-side now.
    const token = await verifyAdminPassword(password)
    user.value = { bypassAuthenticated: true, email: 'admin@bypass' }
    sessionStorage.setItem('admin_bypass_token', token)
    setCrmUser(null) // shared password: no personal account behind this session
    if (employeeName !== undefined) setEmployeeName(employeeName)
    return true
  }

  // Personal CRM account (username + password from the Team page). The server issues one
  // token; admins also get it as their admin-tier token, so Finance/Orders/Team open
  // without a second password prompt. Every action is then stamped with this person.
  const personalLogin = async (username, password) => {
    const response = await fetch('/api/crm/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Sign-in failed')
    sessionStorage.setItem('admin_bypass_token', result.token)
    if (result.adminToken) sessionStorage.setItem('owner_admin_token', result.adminToken)
    else sessionStorage.removeItem('owner_admin_token')
    setCrmUser(result.user)
    setEmployeeName(result.user.name)
    user.value = { bypassAuthenticated: true, email: result.user.username }
    return result.user
  }

  // Regular Supabase login
  const signIn = async (email, password) => {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured')
    }

    loading.value = true
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) throw error
      user.value = data.user
      return data
    } catch (error) {
      throw error
    } finally {
      loading.value = false
    }
  }

  // Sign up
  const signUp = async (email, password, metadata = {}) => {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured')
    }

    loading.value = true
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata
        }
      })
      if (error) throw error
      return data
    } catch (error) {
      throw error
    } finally {
      loading.value = false
    }
  }

  // Sign out
  const signOut = async () => {
    if (bypassMode.value) {
      const token = sessionStorage.getItem('admin_bypass_token')
      dropSession()
      user.value = null
      if (token) {
        // Best-effort — the token is already gone client-side either way, this just
        // also revokes it server-side so it can't be replayed.
        fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
      }
      return
    }

    if (!isSupabaseConfigured()) {
      return
    }

    loading.value = true
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      user.value = null
    } catch (error) {
      throw error
    } finally {
      loading.value = false
    }
  }

  return {
    user,
    loading,
    isAuthenticated,
    bypassMode,
    initialize,
    signIn,
    signUp,
    signOut,
    bypassLogin,
    personalLogin
  }
})
