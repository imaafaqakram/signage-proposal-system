import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase, isAdminBypassMode, verifyAdminPassword, checkAdminSession, isSupabaseConfigured } from '@/services/supabase'
import { setEmployeeName } from '@/services/crmActivity'

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
      const valid = await checkAdminSession(token)
      if (valid) {
        user.value = { bypassAuthenticated: true, email: 'admin@bypass' }
      } else {
        sessionStorage.removeItem('admin_bypass_token')
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
    if (employeeName !== undefined) setEmployeeName(employeeName)
    return true
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
      sessionStorage.removeItem('admin_bypass_token')
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
    bypassLogin
  }
})
