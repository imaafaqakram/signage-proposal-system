// Luminus CRM — personal user accounts.
//
// Until now the CRM had two SHARED passwords (employee + admin) and an optional
// honor-system name box, so nothing could truthfully say WHO did something. This adds real
// per-person logins on top, without touching the shared-password flow the Proposal System
// still uses:
//
//   • crm_users (migration 017): username, display name, role, scrypt password hash.
//   • Logging in as a person issues a normal session token and drops it into the SAME
//     in-memory session sets the old flow uses (`bypassSessions`, and `adminSessions` for the
//     admin role) — so every existing route/guard keeps working untouched — plus a
//     token -> user map so the server always knows who a request is really from.
//   • requireCrmAuth / requireCrmAdmin replace requireBypassAuth / requireAdmin ONLY on the
//     /api/crm/* routes. They additionally set req.crmUser (the audit trail reads it).
//   • Roles mirror the existing two tiers 1:1 — 'admin' = today's admin password holders
//     (money pages, settings, user management), 'employee' = everyone else.
//   • The shared passwords keep working until an admin flips "require personal logins"
//     (Team page). That switch refuses to turn on unless a personal admin exists, so it
//     can't lock everyone out. It only affects /api/crm/* — the Proposal System's own
//     login is a separate thing and is never changed here.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import express from 'express'
import { _crmSupabase as supabase, logCrmActivity } from './crm-db.js'
import { getActor, logEvent } from './crm-audit.js'

const scrypt = promisify(crypto.scrypt)
const SESSION_FILE = path.join(process.cwd(), 'crm-user-sessions.json')
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
const USER_COLS = 'id, username, display_name, role, active, created_at, last_login_at'
const ROLES = ['admin', 'employee']
const USERNAME_RE = /^[a-z0-9._@+-]{3,64}$/
const MIN_PASSWORD = 8

const tokenOf = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
const normUsername = (s) => String(s || '').trim().toLowerCase()
const isMissingTable = (error) => !!error && (error.code === '42P01' || /relation .*crm_users.* does not exist|crm_users.*schema cache/i.test(error.message || ''))

async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, 64)
  return `scrypt$16384$${salt.toString('hex')}$${hash.toString('hex')}`
}
async function verifyPassword(password, stored) {
  try {
    const [scheme, , saltHex, hashHex] = String(stored || '').split('$')
    if (scheme !== 'scrypt') return false
    const expected = Buffer.from(hashHex, 'hex')
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
    return crypto.timingSafeEqual(actual, expected)
  } catch { return false }
}

export function createCrmAuth({ bypassSessions, adminSessions, loadAdminSettings, saveAdminSettings }) {
  // ── token -> user, persisted so a server restart doesn't make everyone anonymous ──
  let sessionUsers = new Map()
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))
    const now = Date.now()
    for (const [t, s] of Object.entries(raw)) if (s && s.exp > now) sessionUsers.set(t, s)
  } catch { /* first run */ }
  let persistTimer = null
  const persist = () => {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      try { fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessionUsers)), { mode: 0o600 }) } catch { /* non-fatal */ }
    }, 400)
  }
  const revokeToken = (t) => { bypassSessions.delete(t); adminSessions.delete(t); if (sessionUsers.delete(t)) persist() }
  const revokeUserSessions = (userId) => {
    for (const [t, s] of [...sessionUsers.entries()]) if (s.userId === userId) revokeToken(t)
  }
  setInterval(() => {
    const now = Date.now()
    for (const [t, s] of [...sessionUsers.entries()]) if (s.exp <= now) revokeToken(t)
  }, 3600 * 1000).unref()

  // ── login throttling (in memory; resets on restart, which is fine for a brute-force guard) ──
  const failures = new Map() // key -> { count, first }
  const WINDOW_MS = 15 * 60 * 1000
  const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown'
  const throttleKeys = (req, username) => [`u:${username}`, `ip:${clientIp(req)}`]
  const limits = { u: 8, ip: 30 }
  const isLocked = (keys) => keys.some((k) => {
    const f = failures.get(k)
    if (!f) return false
    if (Date.now() - f.first > WINDOW_MS) { failures.delete(k); return false }
    return f.count >= limits[k.split(':')[0]]
  })
  const noteFailure = (keys) => keys.forEach((k) => {
    const f = failures.get(k)
    if (!f || Date.now() - f.first > WINDOW_MS) failures.set(k, { count: 1, first: Date.now() })
    else f.count += 1
  })

  // ── "shared passwords still allowed?" ──
  const sharedDisabled = async () => !!(await loadAdminSettings()).disableSharedLogin

  // ── middleware ──
  async function requireCrmAuth(req, res, next) {
    try {
      const token = tokenOf(req)
      if (!token || !bypassSessions.has(token)) return res.status(401).json({ error: 'unauthorized' })
      const sess = sessionUsers.get(token)
      if (sess) {
        if (sess.exp <= Date.now()) { revokeToken(token); return res.status(401).json({ error: 'unauthorized' }) }
        req.crmUser = { id: sess.userId, name: sess.name, username: sess.username, role: sess.role }
      } else {
        if (await sharedDisabled()) return res.status(401).json({ error: 'Personal login required', code: 'PERSONAL_LOGIN_REQUIRED' })
        req.crmUser = null
      }
      next()
    } catch (err) {
      console.error('[crm-auth] requireCrmAuth', err)
      res.status(500).json({ error: 'auth check failed' })
    }
  }
  async function requireCrmAdmin(req, res, next) {
    try {
      const token = tokenOf(req)
      if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'Admin session required.' })
      const sess = sessionUsers.get(token)
      if (sess) {
        if (sess.exp <= Date.now() || sess.role !== 'admin') { revokeToken(token); return res.status(401).json({ error: 'Admin session required.' }) }
        req.crmUser = { id: sess.userId, name: sess.name, username: sess.username, role: sess.role }
      } else {
        if (await sharedDisabled()) return res.status(401).json({ error: 'Personal login required', code: 'PERSONAL_LOGIN_REQUIRED' })
        req.crmUser = null
      }
      next()
    } catch (err) {
      console.error('[crm-auth] requireCrmAdmin', err)
      res.status(500).json({ error: 'auth check failed' })
    }
  }
  // Non-middleware check used by the history router for money-record timelines.
  const isAdminRequest = (req) => {
    const token = tokenOf(req)
    if (!token || !adminSessions.has(token)) return false
    const sess = sessionUsers.get(token)
    return sess ? sess.exp > Date.now() && sess.role === 'admin' : true
  }

  // ═══════════ /api/crm/auth ═══════════
  const authRouter = express.Router()
  const jsonBody = express.json({ limit: '16kb' })

  // GET /config — public: tells the login page which forms to show.
  let configCache = { at: 0, value: null }
  authRouter.get('/config', async (_req, res) => {
    try {
      if (configCache.value && Date.now() - configCache.at < 15000) return res.json(configCache.value)
      // Plain select, not a HEAD count: a HEAD response has no body, so a missing table
      // would come back without the error text isMissingTable() looks for.
      const { data, error } = await supabase.from('crm_users').select('id').eq('active', true).limit(1)
      const migrationPending = isMissingTable(error)
      if (error && !migrationPending) throw error
      const value = {
        personalLoginEnabled: !migrationPending && (data || []).length > 0,
        sharedLoginAllowed: !(await sharedDisabled()),
        migrationPending
      }
      configCache = { at: Date.now(), value }
      res.json(value)
    } catch (err) {
      // Never leave the login page without a usable form because of a lookup problem.
      res.json({ personalLoginEnabled: false, sharedLoginAllowed: true, error: true })
    }
  })

  authRouter.post('/login', jsonBody, async (req, res) => {
    const username = normUsername(req.body?.username)
    const password = String(req.body?.password || '')
    const keys = throttleKeys(req, username)
    if (isLocked(keys)) return res.status(429).json({ error: 'Too many failed attempts. Wait 15 minutes and try again.' })
    try {
      if (!username || !password) return res.status(400).json({ error: 'Enter your username and password.' })
      const { data: user, error } = await supabase.from('crm_users').select(`${USER_COLS}, password_hash`).eq('username', username).maybeSingle()
      if (isMissingTable(error)) return res.status(503).json({ error: 'Personal logins are not set up yet — run database migration 017 first.' })
      if (error) throw error
      // Always do the expensive hash work, even for unknown usernames, so response time
      // doesn't reveal which usernames exist.
      const ok = await verifyPassword(password, user?.password_hash || 'scrypt$16384$00$00')
      if (!user || !user.active || !ok) {
        noteFailure(keys)
        if (user) logCrmActivity({ employeeName: user.display_name, action: 'auth.login-failed', entityType: 'user', entityId: user.id, meta: { via: 'personal', reason: user.active ? 'bad password' : 'account inactive' } })
        return res.status(401).json({ error: 'Incorrect username or password.' })
      }
      failures.delete(keys[0])

      const token = crypto.randomBytes(24).toString('hex')
      bypassSessions.add(token)
      if (user.role === 'admin') adminSessions.add(token)
      sessionUsers.set(token, { userId: user.id, name: user.display_name, username: user.username, role: user.role, exp: Date.now() + SESSION_TTL_MS })
      persist()
      supabase.from('crm_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id).then(() => {}, () => {})
      logCrmActivity({ employeeName: user.display_name, action: 'auth.login', entityType: 'user', entityId: user.id, meta: { user: { id: user.id, role: user.role, via: 'personal' } } })
      res.json({
        ok: true,
        token,
        adminToken: user.role === 'admin' ? token : null,
        user: { id: user.id, name: user.display_name, username: user.username, role: user.role }
      })
    } catch (err) {
      console.error('[crm-auth] login', err)
      res.status(500).json({ error: 'Could not sign in right now.' })
    }
  })

  authRouter.post('/logout', (req, res) => {
    const token = tokenOf(req)
    const sess = sessionUsers.get(token)
    if (sess) logCrmActivity({ employeeName: sess.name, action: 'auth.logout', entityType: 'user', entityId: sess.userId, meta: { user: { id: sess.userId, role: sess.role, via: 'personal' } } })
    revokeToken(token)
    res.json({ ok: true })
  })

  // GET /me — who am I? (personal:false = someone on the old shared password)
  authRouter.get('/me', requireCrmAuth, (req, res) => {
    const a = getActor(req)
    res.json({ personal: !!req.crmUser, user: req.crmUser ? { id: req.crmUser.id, name: req.crmUser.name, username: req.crmUser.username, role: req.crmUser.role } : null, name: a.name })
  })

  authRouter.post('/change-password', requireCrmAuth, jsonBody, async (req, res) => {
    try {
      if (!req.crmUser) return res.status(400).json({ error: 'Only personal accounts have their own password.' })
      const current = String(req.body?.currentPassword || '')
      const next = String(req.body?.newPassword || '')
      if (next.length < MIN_PASSWORD) return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD} characters.` })
      const { data: user, error } = await supabase.from('crm_users').select('id, password_hash').eq('id', req.crmUser.id).single()
      if (error) throw error
      if (!(await verifyPassword(current, user.password_hash))) return res.status(401).json({ error: 'Current password is incorrect.' })
      const password_hash = await hashPassword(next)
      const { error: upErr } = await supabase.from('crm_users').update({ password_hash }).eq('id', user.id)
      if (upErr) throw upErr
      // Keep this session, end every other one.
      const keep = tokenOf(req)
      for (const [t, s] of [...sessionUsers.entries()]) if (s.userId === user.id && t !== keep) revokeToken(t)
      logEvent(req, { action: 'user.password-change', entityType: 'user', entityId: user.id })
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm-auth] change-password', err)
      res.status(500).json({ error: 'Could not change the password.' })
    }
  })

  // ═══════════ /api/crm/users  (admin) ═══════════
  const usersRouter = express.Router()
  usersRouter.use(requireCrmAdmin)

  const activeAdminCount = async (excludeId = null) => {
    let q = supabase.from('crm_users').select('id').eq('active', true).eq('role', 'admin')
    if (excludeId) q = q.neq('id', excludeId)
    const { data, error } = await q
    if (error) throw error
    return (data || []).length
  }
  const tableGuard = (res, error) => {
    if (isMissingTable(error)) { res.status(503).json({ error: 'User accounts are not set up yet — run database migration 017 in Supabase.', migrationPending: true }); return true }
    return false
  }

  usersRouter.get('/', async (_req, res) => {
    try {
      const { data, error } = await supabase.from('crm_users').select(USER_COLS).order('created_at', { ascending: true })
      if (tableGuard(res, error)) return
      if (error) throw error
      res.json({ rows: data || [] })
    } catch (err) {
      console.error('[crm-auth] users list', err)
      res.status(500).json({ error: err.message })
    }
  })

  usersRouter.post('/', jsonBody, async (req, res) => {
    try {
      const b = req.body || {}
      const username = normUsername(b.username)
      const displayName = String(b.displayName || '').trim().slice(0, 80)
      const role = ROLES.includes(b.role) ? b.role : 'employee'
      const password = String(b.password || '')
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3–64 characters: letters, numbers, . _ - @ +' })
      if (!displayName) return res.status(400).json({ error: 'Display name is required — it is what appears in the history.' })
      if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` })
      const password_hash = await hashPassword(password)
      const { data, error } = await supabase.from('crm_users')
        .insert({ username, display_name: displayName, role, password_hash, active: true, created_by: getActor(req).name })
        .select(USER_COLS).single()
      if (tableGuard(res, error)) return
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'That username is already taken.' })
        throw error
      }
      configCache = { at: 0, value: null }
      logEvent(req, { action: 'user.create', entityType: 'user', entityId: data.id, meta: { username, role, displayName } })
      res.json({ ok: true, user: data })
    } catch (err) {
      console.error('[crm-auth] user create', err)
      res.status(500).json({ error: err.message })
    }
  })

  usersRouter.patch('/:id', jsonBody, async (req, res) => {
    try {
      const b = req.body || {}
      const { data: existing, error: gErr } = await supabase.from('crm_users').select(USER_COLS).eq('id', req.params.id).maybeSingle()
      if (tableGuard(res, gErr)) return
      if (gErr) throw gErr
      if (!existing) return res.status(404).json({ error: 'User not found' })

      const patch = {}
      if (b.displayName !== undefined) {
        const n = String(b.displayName).trim().slice(0, 80)
        if (!n) return res.status(400).json({ error: 'Display name cannot be empty.' })
        patch.display_name = n
      }
      if (b.role !== undefined) {
        if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'Invalid role.' })
        patch.role = b.role
      }
      if (b.active !== undefined) patch.active = !!b.active

      const losesAdmin = existing.role === 'admin' && existing.active && (patch.role === 'employee' || patch.active === false)
      if (losesAdmin && (await activeAdminCount(existing.id)) === 0) {
        return res.status(400).json({ error: 'You cannot remove the last active admin — create or promote another admin first.' })
      }
      if (!Object.keys(patch).length) return res.json({ ok: true, user: existing })

      const { data, error } = await supabase.from('crm_users').update(patch).eq('id', existing.id).select(USER_COLS).single()
      if (error) throw error
      // A role change or deactivation must take effect immediately, not at next login.
      if (patch.role !== undefined || patch.active === false || patch.display_name !== undefined) revokeUserSessions(existing.id)
      configCache = { at: 0, value: null }
      const changes = {}
      for (const [k, v] of Object.entries(patch)) if (existing[k] !== v) changes[k] = { from: existing[k], to: v }
      logEvent(req, { action: 'user.update', entityType: 'user', entityId: existing.id, meta: { label: existing.username, changes } })
      res.json({ ok: true, user: data })
    } catch (err) {
      console.error('[crm-auth] user update', err)
      res.status(500).json({ error: err.message })
    }
  })

  usersRouter.post('/:id/reset-password', jsonBody, async (req, res) => {
    try {
      const password = String(req.body?.password || '')
      if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` })
      const { data: existing, error: gErr } = await supabase.from('crm_users').select('id, username').eq('id', req.params.id).maybeSingle()
      if (tableGuard(res, gErr)) return
      if (gErr) throw gErr
      if (!existing) return res.status(404).json({ error: 'User not found' })
      const password_hash = await hashPassword(password)
      const { error } = await supabase.from('crm_users').update({ password_hash }).eq('id', existing.id)
      if (error) throw error
      revokeUserSessions(existing.id)
      logEvent(req, { action: 'user.password-reset', entityType: 'user', entityId: existing.id, meta: { label: existing.username } })
      res.json({ ok: true })
    } catch (err) {
      console.error('[crm-auth] reset-password', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET/POST /security — the "require personal logins" switch.
  usersRouter.get('/security/status', async (_req, res) => {
    try {
      res.json({ sharedLoginDisabled: await sharedDisabled(), activeAdmins: await activeAdminCount().catch(() => 0) })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
  usersRouter.post('/security/shared-login', jsonBody, async (req, res) => {
    try {
      const disable = !!req.body?.disabled
      if (disable) {
        if (!req.crmUser || req.crmUser.role !== 'admin') {
          return res.status(400).json({ error: 'Sign in with your personal admin account first — otherwise turning this on would lock you out.' })
        }
        if ((await activeAdminCount()) === 0) return res.status(400).json({ error: 'Create at least one active admin account first.' })
      }
      await saveAdminSettings({ disableSharedLogin: disable })
      logEvent(req, { action: 'security.shared-login', entityType: 'settings', entityId: 'disableSharedLogin', meta: { disabled: disable } })
      configCache = { at: 0, value: null }
      res.json({ ok: true, sharedLoginDisabled: disable })
    } catch (err) {
      console.error('[crm-auth] shared-login switch', err)
      res.status(500).json({ error: err.message })
    }
  })

  return { requireCrmAuth, requireCrmAdmin, isAdminRequest, authRouter, usersRouter }
}
