import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Create Supabase client (only if credentials are configured and valid)
export const supabase = (
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('placeholder') && 
  !supabaseAnonKey.includes('placeholder')
) ? createClient(supabaseUrl, supabaseAnonKey) : null

// Check if Supabase is configured
export const isSupabaseConfigured = () => {
  return supabase !== null
}

// Admin bypass mode (for when auth is disabled)
export const isAdminBypassMode = () => {
  return import.meta.env.VITE_ADMIN_BYPASS_MODE === 'true'
}

// Verified server-side now (see /api/auth/verify) — the real password never ships in
// this bundle. Returns the session token on success, throws on a wrong password.
export const verifyAdminPassword = async (password) => {
  const response = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Invalid bypass password')
  return result.token
}

export const checkAdminSession = async (token) => {
  if (!token) return false
  try {
    const response = await fetch('/api/auth/check', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const result = await response.json().catch(() => ({}))
    return response.ok && result.ok === true
  } catch {
    return false
  }
}
