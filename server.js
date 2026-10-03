// ============================================
// LUMINUS COMPLETE - MULTI-AI SERVER
// All 4 AI Providers Working
// Text-to-Image + Image-to-Image Support
//
// Real Gemini integration, /api/migrate-lead streaming CRM import bridge,
// and related fixes in this file: Author Burhan.
// ============================================

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fetch from 'node-fetch'
import FormData from 'form-data'
import { mkdirSync, readFileSync, writeFile } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, execFile } from 'child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import crypto from 'node:crypto'
import nodemailer from 'nodemailer'
import batchRouter from './api/batch.js'
import imageGenRouter from './api/imageGen.js'
import pdfGenRouter from './api/pdfGen.js'
import stripeRouter from './api/stripe.js'
import { createCrmRouter } from './crm-routes.js'
import { createCrmLeadsRouter } from './crm-leads.js'
import { createCrmStatsRouter } from './crm-stats.js'
import { createCrmTemplatesRouter } from './crm-templates.js'
import { createCrmBoardRouter } from './crm-board.js'
import { createCrmProjectsRouter } from './crm-airtable-projects.js'
import { createCrmAutomationRouter } from './crm-automation.js'
import { createCrmOrdersRouter } from './crm-orders.js'
import { createCrmExpensesRouter } from './crm-expenses.js'
import { createCrmMaterialsRouter } from './crm-materials.js'
import { createCrmVendorsRouter } from './crm-vendors.js'
import { createCrmAuth } from './crm-auth.js'
import { createCrmFxRouter } from './crm-fx.js'
import { createCrmHistoryRouter } from './crm-audit.js'
import { createCrmBroadcastRouter, startBroadcastWorker } from './crm-broadcast.js'
import { pollSentFolder as crmPollSentFolder } from './crm-sent-poll.js'
import { logOutboundEmail as crmLogOutbound, recordAttachment as crmRecordAttachment } from './crm-db.js'
import { saveLeadVersion, listLeads, listVersions, getVersion, deleteLead, listBatches, getBatchLeads, getLeadsByDate, getLeadByCrmRecordId, markLeadEmailSent, markLeadCrmDate, stopFollowUps, resumeFollowUps, getFollowUpCandidates, recordFollowUpSent } from './db.js'

// ============================================
// NODEMAILER SMTP TRANSPORTER (Hostinger)
// ============================================
const createSMTPTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: (process.env.SMTP_PORT || '465') === '465', // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
})

// ============================================
// ADMIN SETTINGS — everything an owner (not an employee) might reasonably need to change
// without asking a developer, stored in one plain JSON file rather than .env: env vars
// only take effect on the NEXT process restart, which makes them a bad fit for anything
// meant to be editable live from a settings page. Genuinely sensitive credentials
// (Gemini/Airtable/SMTP keys) deliberately stay in .env, out of this file and out of any
// UI — those still need a developer, on purpose (see the admin routes below for why).
// ============================================
const ADMIN_SETTINGS_PATH = path.join(process.cwd(), 'admin-settings.json')
const DEFAULT_ADMIN_SETTINGS = {
  adminPassword: null, // set on first boot below if the file doesn't exist yet
  notifyEmail: 'controva258@gmail.com', // internal/admin notifications: fetch-started, daily summary, crash alerts
  clientCcEmail: 'junev8316@gmail.com', // CC'd on outgoing CLIENT proposal emails only — never internal ones
  clientCcEnabled: true,
  smtpFromName: 'Signage Crafting',
  dailyFetchGapDays: 8,
  dailyFetchChunkSize: 15,
  dailyFetchMaxPerSource: 0, // 0 = unlimited
  discountPresets: [0, 5, 10, 15],
  proposalPhone: '+1 209 340 4633',
  archiveRetentionDays: 60,
  driveSyncEnabled: true,
  // Client follow-up drip sequence — every knob the owner asked to control themselves
  // rather than needing a developer for. First follow-up at +firstDelayDays from the
  // original send, then alternating intervalMinDays/intervalMaxDays apart, stopping at
  // whichever comes first: maxDurationDays elapsed, or maxCount emails sent, or the lead
  // was manually marked stopped (see the per-lead "Stop follow-ups" control).
  followUpEnabled: false,
  followUpFirstDelayDays: 7,
  followUpIntervalMinDays: 3,
  followUpIntervalMaxDays: 4,
  followUpMaxDurationDays: 120,
  followUpMaxCount: 30
}

let adminSettingsCache = null
async function loadAdminSettings() {
  if (adminSettingsCache) return adminSettingsCache
  try {
    const raw = JSON.parse(await fs.readFile(ADMIN_SETTINGS_PATH, 'utf-8'))
    adminSettingsCache = { ...DEFAULT_ADMIN_SETTINGS, ...raw } // merge so new fields added later get their default until explicitly set
  } catch {
    adminSettingsCache = { ...DEFAULT_ADMIN_SETTINGS, adminPassword: crypto.randomBytes(9).toString('base64url') }
    await fs.writeFile(ADMIN_SETTINGS_PATH, JSON.stringify(adminSettingsCache, null, 2))
    console.log(`🔑 First boot: generated admin panel password (change it from the Admin page) — ${adminSettingsCache.adminPassword}`)
  }
  return adminSettingsCache
}
async function saveAdminSettings(partial) {
  const current = await loadAdminSettings()
  adminSettingsCache = { ...current, ...partial }
  await fs.writeFile(ADMIN_SETTINGS_PATH, JSON.stringify(adminSettingsCache, null, 2))
  return adminSettingsCache
}

// Visibility into every fetch as it happens — one email per /api/migrate-lead request,
// whether it came from an employee clicking Fetch or the automated daily job calling this
// same endpoint internally. Kept separate from the daily summary email (that one reports
// results after the fact; this one is "something just started").
const FETCH_NOTIFY_EMAIL = 'controva258@gmail.com' // fallback only — notifyFetchStarted reads the live value from admin settings

// Same constraint as the activity log below: no individual logins, so there's no name to
// attach to a "who sent this" record — just IP + a friendly browser/OS label parsed out
// of the User-Agent string, e.g. "Chrome on Windows (192.168.1.4)". Deliberately simple
// regex matching rather than a full UA-parsing library — this only needs to be readable
// enough for a coworker to recognize "oh, that's Sarah's laptop," not forensically exact.
function friendlyDeviceLabel(userAgent, ip) {
  const ua = userAgent || ''
  let browser = 'Unknown browser'
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\//.test(ua)) browser = 'Opera'
  else if (/Chrome\//.test(ua)) browser = 'Chrome'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua)) browser = 'Safari'
  let os = 'Unknown device'
  if (/iPhone/.test(ua)) os = 'iPhone'
  else if (/iPad/.test(ua)) os = 'iPad'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/Mac OS X/.test(ua)) os = 'Mac'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/Linux/.test(ua)) os = 'Linux'
  return `${browser} on ${os}${ip ? ` (${ip})` : ''}`
}

// Everyone shares one bypass password (no individual logins), so there's no username to
// log — IP + browser fingerprint is the only "who did this" signal actually available.
// Appended to a plain local file rather than a DB table: no schema migration needed, and
// it's simple to grep/tail directly on the VM if the API endpoint below is ever down too.
const EMPLOYEE_ACTIVITY_LOG = path.join(process.cwd(), 'employee-activity.log')
async function logEmployeeActivity(entry) {
  try {
    await fs.appendFile(EMPLOYEE_ACTIVITY_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
  } catch (err) {
    console.warn('⚠️  Employee activity log write failed (non-critical):', err.message)
  }
}

async function notifyFetchStarted({ dailyAuto, sourceAlias, count, date, ip, userAgent }) {
  if (!dailyAuto) {
    await logEmployeeActivity({ action: 'fetch-started', sourceAlias, count, date, ip, userAgent })
  }
  // The automated daily job calls /api/migrate-lead once PER CHUNK (up to 15 leads at a
  // time) to bound how long any single request can run — confirmed live that this meant
  // an 11-chunk source sent 11 near-identical "fetch started" emails with no indication
  // of total progress, which just read as spam. daily-fetch.js now sends its own single,
  // properly summarized start email covering every source before any chunk runs — so this
  // per-request notification is only useful (and only sent) for a real employee action.
  if (dailyAuto) return
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS
  if (!smtpUser || !smtpPass) return // not configured — silently skip, same as other email paths
  const settings = await loadAdminSettings()
  const fromName = settings.smtpFromName || process.env.SMTP_FROM_NAME || 'Signage Crafting'
  const who = dailyAuto ? 'Automated daily fetch' : 'Manual fetch (employee)'
  const what = date ? `all leads for ${date}` : `${count} lead(s)`
  // IP/device only make sense for a real person at a keyboard — the automated run has
  // neither (it calls the API from the server itself), so this line is only ever
  // included for actual employee-triggered fetches.
  const whoDetail = !dailyAuto && ip ? `<p style="color:#888;font-size:12px;">From ${ip}${userAgent ? ' — ' + userAgent : ''}</p>` : ''
  const transporter = createSMTPTransporter()
  await transporter.sendMail({
    from: `"${fromName}" <${smtpUser}>`,
    to: settings.notifyEmail || FETCH_NOTIFY_EMAIL,
    subject: `Fetch started — ${sourceAlias} — ${who}`,
    html: `<p><strong>${who}</strong> just started against <strong>${sourceAlias}</strong>: ${what}.</p><p>${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</p>${whoDetail}`
  })
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Ensure tmp upload dir exists
mkdirSync(path.join(__dirname, 'tmp/uploads'), { recursive: true })

// Full lead JSON (images included) archived here on the VM's own disk — Supabase only
// ever stores a stripped, images-out copy (see archiveAndStripImages below). Local disk
// instead of Supabase Storage: no third-party free-tier quota, ~50GB free on this VM.
const BATCH_ARCHIVE_DIR = path.join(__dirname, 'batch-archive')
mkdirSync(BATCH_ARCHIVE_DIR, { recursive: true })

// CRM keeps the proposal PDFs we send here (the "hot" copy). Every file is also
// pushed to Google Drive via the existing rclone queue; a retention sweep prunes
// this folder, Drive keeps everything.
const CRM_STORAGE_DIR = path.join(__dirname, 'crm-storage')
mkdirSync(CRM_STORAGE_DIR, { recursive: true })

const app = express()
const PORT = parseInt(process.env.PORT || '3001', 10)

// Only Caddy (running on this same VM) ever talks to this process directly — "loopback"
// tells Express to trust the X-Forwarded-For header Caddy sets, so req.ip below resolves
// to the real employee's IP instead of just showing 127.0.0.1 for every single request.
app.set('trust proxy', 'loopback')

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// A plain in-memory Set loses every logged-in session on any process restart — and this
// process restarts often (every deploy, every OOM auto-recovery). Confirmed live: that
// made a `pm2 restart` during business hours silently boot every employee back to the
// login screen on their next refresh, even though their sessionStorage token was still
// perfectly valid — from their side it just looked like "refreshing logs me out". Backing
// the Set with a small JSON file (same pattern as admin-settings.json) means a restart
// only clears sessions that were already going to expire from actual inactivity-style
// causes, not from us shipping a fix.
function persistedSessionSet(filename) {
  const filePath = path.join(process.cwd(), filename)
  let tokens = new Set()
  try {
    tokens = new Set(JSON.parse(readFileSync(filePath, 'utf-8')))
  } catch {
    // no file yet, or unreadable — start empty, same as before this fix existed
  }
  const persist = () => {
    writeFile(filePath, JSON.stringify([...tokens]), () => {})
  }
  return {
    has: (t) => tokens.has(t),
    add: (t) => { tokens.add(t); persist() },
    delete: (t) => { tokens.delete(t); persist() }
  }
}

// ============================================
// ADMIN BYPASS AUTH — verified here, not in the browser
// ============================================
// The password used to live in the client bundle as VITE_ADMIN_BYPASS_PASSWORD, which
// Vite bakes into public JS at build time — anyone with DevTools open could read it in
// plaintext. It's compared here instead, using the non-VITE-prefixed ADMIN_BYPASS_PASSWORD
// (server-only, never shipped to the browser). Sessions are a random token this process
// remembers (see persistedSessionSet above), not a client-settable "true" flag — the old
// approach let anyone grant themselves access via
// sessionStorage.setItem('admin_bypass','true') in the console, without ever knowing the
// password at all.
const activeBypassSessions = persistedSessionSet('bypass-sessions.json')

// Guards the CRM read/write API — same employee bypass session the proposal editor uses.
const requireBypassAuth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token || !activeBypassSessions.has(token)) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

app.post('/api/auth/verify', (req, res) => {
  const { password } = req.body
  const expected = process.env.ADMIN_BYPASS_PASSWORD
  if (!expected) {
    return res.status(400).json({ error: 'Bypass mode is not configured on the server.' })
  }
  if (password !== expected) {
    return res.status(401).json({ error: 'Invalid bypass password.' })
  }
  const token = crypto.randomBytes(24).toString('hex')
  activeBypassSessions.add(token)
  res.status(200).json({ ok: true, token })
})

app.get('/api/auth/check', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  res.status(200).json({ ok: activeBypassSessions.has(token) })
})

app.post('/api/auth/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  activeBypassSessions.delete(token)
  res.status(200).json({ ok: true })
})

// ============================================
// ADMIN AUTH — a SECOND, separate tier from the employee bypass password above. The
// employee password (ADMIN_BYPASS_PASSWORD, env var) only unlocks the proposal editor;
// it must never also unlock settings/credentials/employee-activity, since every employee
// shares it. The admin password lives in admin-settings.json (not .env) specifically
// because it's meant to be viewable/changeable by the owner from the Admin page itself —
// unlike the genuinely sensitive keys (Gemini/Airtable/SMTP), which deliberately stay
// out of any UI, admin-settings.json included, and require direct server access to change.
// ============================================
const activeAdminSessions = persistedSessionSet('admin-sessions.json')

app.post('/api/admin/auth/verify', async (req, res) => {
  const { password } = req.body
  const settings = await loadAdminSettings()
  if (password !== settings.adminPassword) {
    return res.status(401).json({ error: 'Invalid admin password.' })
  }
  const token = crypto.randomBytes(24).toString('hex')
  activeAdminSessions.add(token)
  res.status(200).json({ ok: true, token })
})

app.get('/api/admin/auth/check', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  res.status(200).json({ ok: activeAdminSessions.has(token) })
})

app.post('/api/admin/auth/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  activeAdminSessions.delete(token)
  res.status(200).json({ ok: true })
})

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!activeAdminSessions.has(token)) {
    return res.status(401).json({ error: 'Admin session required.' })
  }
  next()
}

// Only these keys are owner-editable from the Admin page — deliberately excludes any
// credential/API-key field, matching the standing rule that Gemini/Airtable/SMTP secrets
// never appear in any UI (admin-gated or not) and stay changeable only via direct server
// access. adminPassword IS included here on purpose: the owner explicitly asked to be
// able to change it from the dashboard rather than needing a developer for that specific
// field, unlike every other credential in the system.
const ADMIN_EDITABLE_KEYS = [
  'adminPassword', 'notifyEmail', 'clientCcEmail', 'clientCcEnabled', 'smtpFromName',
  'dailyFetchGapDays', 'dailyFetchChunkSize', 'dailyFetchMaxPerSource', 'discountPresets',
  'proposalPhone', 'archiveRetentionDays', 'driveSyncEnabled',
  'followUpEnabled', 'followUpFirstDelayDays', 'followUpIntervalMinDays', 'followUpIntervalMaxDays',
  'followUpMaxDurationDays', 'followUpMaxCount'
]

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  const settings = await loadAdminSettings()
  res.status(200).json({ settings })
})

// Unauthenticated on purpose, same trust model as /api/crm-sources (aliases, not real
// names) — the proposal editor itself (used by every employee) needs the live discount
// presets and phone number to render its UI, but must never receive anything from this
// file beyond those two display values. Every other admin-settings field (emails,
// credentials, fetch tuning) is deliberately left out of this response.
app.get('/api/settings/public', async (req, res) => {
  const settings = await loadAdminSettings()
  res.status(200).json({ discountPresets: settings.discountPresets, proposalPhone: settings.proposalPhone })
})

app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  const partial = {}
  for (const key of ADMIN_EDITABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) partial[key] = req.body[key]
  }
  if (typeof partial.adminPassword === 'string' && partial.adminPassword.trim().length < 8) {
    return res.status(400).json({ error: 'Admin password must be at least 8 characters.' })
  }
  const settings = await saveAdminSettings(partial)
  res.status(200).json({ ok: true, settings })
})

// Moved from the old, unauthenticated /api/internal/employee-activity — this reads IP +
// browser fingerprint for every employee-triggered fetch, which is exactly the kind of
// "who did this" detail that must sit behind the admin tier, not be reachable by anyone
// who merely knows the shared employee password.
app.get('/api/admin/employee-activity', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500)
    const raw = await fs.readFile(EMPLOYEE_ACTIVITY_LOG, 'utf-8').catch(() => '')
    const lines = raw.trim() ? raw.trim().split('\n') : []
    const entries = lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    res.status(200).json({ entries })
  } catch (error) {
    res.status(500).json({ error: 'Failed to read employee activity log', details: error.message })
  }
})

// Snapshot the owner actually asked for: did the last automated fetch finish, and is the
// box itself healthy right now. daily-fetch.js writes daily-fetch-status.json after every
// run (success, failure, or SIGTERM-kill) — read here rather than parsing logs live.
const DAILY_FETCH_STATUS_PATH = path.join(process.cwd(), 'daily-fetch-status.json')
app.get('/api/admin/health', requireAdmin, async (req, res) => {
  try {
    const lastFetch = await fs.readFile(DAILY_FETCH_STATUS_PATH, 'utf-8')
      .then((raw) => JSON.parse(raw))
      .catch(() => null)
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    res.status(200).json({
      lastFetch,
      uptimeSeconds: process.uptime(),
      memory: {
        totalMB: Math.round(totalMem / 1024 / 1024),
        freeMB: Math.round(freeMem / 1024 / 1024),
        usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100)
      },
      loadAvg: os.loadavg()
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to read health snapshot', details: error.message })
  }
})

// Unauthenticated on purpose, same trust model as /api/crm-sources and /api/settings/public
// — the proposal editor needs to know which CRM date the automated system most recently
// processed, with nothing else from the health snapshot exposed. Confirmed live as a real
// gap: the editor used to infer "today's date" from which batch_id most recently appeared
// in the database — but a run that finds only already-fetched/no-PDF leads (a completely
// normal outcome, not a failure) saves zero new rows, so no batch_id for that date ever
// exists, and the editor had no way to discover that date was actually the relevant one.
// This file gets written after every run regardless of how many leads were saved, so it's
// the one reliable source for "what date did the system just look at."
app.get('/api/last-fetch-date', async (req, res) => {
  try {
    const raw = await fs.readFile(DAILY_FETCH_STATUS_PATH, 'utf-8').catch(() => null)
    const status = raw ? JSON.parse(raw) : null
    res.status(200).json({ date: status?.date || null })
  } catch (error) {
    res.status(500).json({ error: 'Failed to read last fetch date', details: error.message })
  }
})

// ============================================
// BULK BATCH ROUTES
// ============================================
app.use('/api/batch', batchRouter)
app.use('/api/image-gen', imageGenRouter)
app.use('/api/pdf-gen', pdfGenRouter)
app.use('/api/stripe', stripeRouter)
// ── CRM auth ─────────────────────────────────────────────────────────────────────────
// Personal per-user logins (crm-auth.js) layered on top of the two shared-password
// sessions above. Only the /api/crm/* mounts use these guards — the Proposal System's
// own routes keep requireBypassAuth / requireAdmin exactly as they were. The new
// guards accept the old shared tokens too (until an admin turns on "require personal
// logins" on the Team page) and additionally tell every route WHO the caller is.
const crmAuth = createCrmAuth({
  bypassSessions: activeBypassSessions,
  adminSessions: activeAdminSessions,
  loadAdminSettings,
  saveAdminSettings
})
const { requireCrmAuth, requireCrmAdmin } = crmAuth
// Mounted BEFORE the catch-all-ish '/api/crm' router so /api/crm/auth/login etc. are never
// swallowed by its own auth-guarded routes.
app.use('/api/crm/auth', crmAuth.authRouter)
app.use('/api/crm/users', crmAuth.usersRouter)
app.use('/api/crm/fx', createCrmFxRouter({ requireAuth: requireCrmAuth }))
app.use('/api/crm/history', createCrmHistoryRouter({ requireAuth: requireCrmAuth, requireAdmin: requireCrmAdmin, isAdmin: crmAuth.isAdminRequest }))
// Client announcements (admin-only; queue + 30-per-hour sender live in crm-broadcast.js).
app.use('/api/crm/broadcasts', createCrmBroadcastRouter({ requireAuth: requireCrmAdmin, loadAdminSettings }))
app.use('/api/crm', createCrmRouter({ requireAuth: requireCrmAuth }))
app.use('/api/crm/leads', createCrmLeadsRouter({ requireAuth: requireCrmAuth }))
app.use('/api/crm/stats', createCrmStatsRouter({ requireAuth: requireCrmAuth }))
app.use('/api/crm/templates', createCrmTemplatesRouter({ requireAuth: requireCrmAuth }))
app.use('/api/crm/board', createCrmBoardRouter({ requireAuth: requireCrmAuth }))
app.use('/api/crm/projects', createCrmProjectsRouter({ requireAuth: requireCrmAuth }))
app.use('/api/crm/automation', createCrmAutomationRouter({ requireAuth: requireCrmAuth, requireAdmin: requireCrmAdmin }))
app.use('/api/crm/orders', createCrmOrdersRouter({ requireAuth: requireCrmAdmin }))
app.use('/api/crm/expenses', createCrmExpensesRouter({ requireAuth: requireCrmAdmin }))
app.use('/api/crm/materials', createCrmMaterialsRouter({ requireAuth: requireCrmAdmin }))
app.use('/api/crm/vendors', createCrmVendorsRouter({ requireAuth: requireCrmAdmin }))

console.log('🚀 Starting Luminus Multi-AI Server...')

// ============================================
// REPLICATE API (Your Custom LoRA)
// ============================================
app.post('/api/replicate', async (req, res) => {
  try {
    const { prompt, sourceImage, strength, steps } = req.body
    const apiKey = process.env.VITE_REPLICATE_API_TOKEN

    if (!apiKey) {
      return res.status(400).json({ error: 'Replicate API token not configured' })
    }

    const input = {
      prompt: prompt,
      num_inference_steps: steps || 28,
      guidance_scale: 7.5
    }

    // Add image-to-image params if source image provided
    if (sourceImage) {
      input.image = sourceImage
      input.prompt_strength = (strength || 75) / 100
    }

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: process.env.VITE_REPLICATE_VERSION_ID,
        input
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Replicate error: ${error}`)
    }

    const data = await response.json()
    res.status(200).json(data)

  } catch (error) {
    console.error('❌ Replicate error:', error.message)
    res.status(500).json({ error: 'Replicate generation failed', details: error.message })
  }
})

// Get Replicate prediction status
app.get('/api/replicate/:id', async (req, res) => {
  try {
    const { id } = req.params
    const apiKey = process.env.VITE_REPLICATE_API_TOKEN

    const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { 'Authorization': `Token ${apiKey}` }
    })

    const data = await response.json()
    res.status(200).json(data)

  } catch (error) {
    console.error('❌ Replicate status error:', error.message)
    res.status(500).json({ error: 'Status check failed', details: error.message })
  }
})

// ============================================
// GEMINI PROMPT ENHANCEMENT
// ============================================
app.post('/api/gemini-prompt', async (req, res) => {
  try {
    console.log('\n✨ === GEMINI PROMPT ENHANCEMENT ===')
    const { prompt, context } = req.body
    const apiKey = process.env.VITE_GEMINI_API_KEY

    console.log('📝 Original prompt:', prompt?.substring(0, 50) || 'No prompt')
    console.log('🎯 Context:', context || 'general')

    if (!apiKey) {
      console.log('⚠️ No API key, returning original prompt')
      return res.status(200).json({ enhancedPrompt: prompt })
    }

    // Call Gemini API to enhance the prompt
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are a prompt enhancer for AI image generation. Take this short prompt and enhance it with more visual details, materials, lighting, and professional qualities for ${context || 'signage'} design. Keep the enhancement concise (under 100 words). Return ONLY the enhanced prompt text, nothing else.

Original prompt: "${prompt}"`
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 200
          }
        })
      }
    )

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text()
      console.error('❌ Gemini API error:', errorText)
      return res.status(200).json({ enhancedPrompt: prompt })
    }

    const geminiData = await geminiResponse.json()
    const enhancedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || prompt

    console.log('✅ Enhanced prompt:', enhancedText.substring(0, 80))
    res.status(200).json({ enhancedPrompt: enhancedText.trim() })

  } catch (error) {
    console.error('❌ Prompt enhancement error:', error.message)
    // Fall back to original prompt on error
    res.status(200).json({ enhancedPrompt: req.body.prompt || '' })
  }
})

// ============================================
// GEMINI API (Google) — Nano Banana image generation
// Rotates across up to 3 accounts: VITE_GEMINI_API_KEY, _2, _3
// ============================================
app.post('/api/gemini', async (req, res) => {
  try {
    console.log('\n🖼️  === GEMINI IMAGE GENERATION ===')
    const { prompt, model, sourceImage } = req.body

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' })
    }

    const modelId = model && model.startsWith('gemini') ? model : 'gemini-2.5-flash-image'
    const keys = [
      process.env.VITE_GEMINI_API_KEY,
      process.env.VITE_GEMINI_API_KEY_2,
      process.env.VITE_GEMINI_API_KEY_3
    ].filter(Boolean)

    console.log(`📝 Prompt: ${prompt.substring(0, 50)} | Model: ${modelId} | Accounts available: ${keys.length}`)

    if (keys.length === 0) {
      return res.status(400).json({ error: 'No Gemini API key configured. Set VITE_GEMINI_API_KEY (and optionally VITE_GEMINI_API_KEY_2 / _3).' })
    }

    // Image-to-image: attach the source image as inline data alongside the prompt
    const parts = [{ text: prompt }]
    if (sourceImage) {
      const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(sourceImage)
      if (match) {
        parts.push({ inline_data: { mime_type: match[1], data: match[2] } })
        console.log('🖼️  Image-to-image mode: source image attached')
      }
    }

    let lastError = null

    for (let i = 0; i < keys.length; i++) {
      const apiKey = keys[i]
      try {
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
            })
          }
        )

        if (geminiResponse.status === 429 || geminiResponse.status === 403) {
          lastError = `Account ${i + 1}: ${geminiResponse.status} ${await geminiResponse.text()}`
          console.warn(`⚠️  Gemini account ${i + 1} rate-limited/forbidden, trying next...`)
          continue
        }

        if (!geminiResponse.ok) {
          const errText = await geminiResponse.text()
          console.error('❌ Gemini API error:', errText)
          return res.status(geminiResponse.status).json({ error: 'Gemini API error', details: errText })
        }

        const data = await geminiResponse.json()
        const responseParts = data?.candidates?.[0]?.content?.parts || []
        let imageUrl = null

        for (const part of responseParts) {
          const inline = part.inlineData || part.inline_data
          if (inline?.data) {
            const mimeType = inline.mimeType || inline.mime_type || 'image/png'
            imageUrl = `data:${mimeType};base64,${inline.data}`
            break
          }
        }

        if (!imageUrl) {
          lastError = `Account ${i + 1}: no image in response`
          continue
        }

        console.log(`✅ Image generated using account ${i + 1}`)
        return res.status(200).json({ imageUrl, usedAccount: i + 1 })

      } catch (err) {
        lastError = `Account ${i + 1}: ${err.message}`
        console.error(`❌ Gemini account ${i + 1} failed:`, err.message)
      }
    }

    return res.status(502).json({ error: 'All Gemini accounts failed or are rate-limited', details: lastError })

  } catch (error) {
    console.error('❌ Gemini error:', error.message)
    res.status(500).json({ error: 'Gemini generation failed', details: error.message })
  }
})

// ============================================
// IMAGINE.ART API (Vyro.ai) - v2 API
// ============================================
app.post('/api/imagineart', async (req, res) => {
  try {
    console.log('\n🎨 === IMAGINE.ART REQUEST ===')
    const { prompt, style, sourceImage, strength } = req.body
    const apiKey = process.env.VITE_IMAGINEART_API_KEY

    console.log('📝 Prompt:', prompt?.substring(0, 50) || 'No prompt')
    console.log('🎨 Style:', style || 'realistic (default)')
    console.log('🔑 API Key present:', !!apiKey, apiKey ? `(starts with ${apiKey.substring(0, 6)}...)` : '')

    if (!apiKey) {
      return res.status(400).json({ error: 'Imagine.art API key not configured' })
    }

    // Valid styles for Imagine.art v2 API
    const validStyles = ['realistic', 'anime', 'flux_schnell', 'flux_dev_fast', 'flux_dev', 'imagine_turbo']
    const finalStyle = validStyles.includes(style) ? style : 'realistic'
    console.log('🎨 Final Style:', finalStyle)

    // Use FormData for v2 API
    const formData = new FormData()
    formData.append('prompt', prompt)
    formData.append('style', finalStyle)
    formData.append('aspect_ratio', '1:1')
    formData.append('variation', 'txt2img')  // Required parameter for text-to-image
    formData.append('seed', Math.floor(Math.random() * 1000000).toString())

    if (sourceImage) {
      const base64Data = sourceImage.split(',')[1]
      const imageBuffer = Buffer.from(base64Data, 'base64')
      formData.append('image', imageBuffer, { filename: 'source.png' })
      formData.append('strength', ((strength || 75) / 100).toString())
      console.log('🖼️ Source image provided, strength:', ((strength || 75) / 100))
    }

    console.log('📤 Sending request to Vyro.ai v2 API...')
    const response = await fetch('https://api.vyro.ai/v2/image/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formData.getHeaders()
      },
      body: formData
    })

    console.log('📥 Response status:', response.status, response.statusText)

    // Check if response is an image (binary) or JSON
    const contentType = response.headers.get('content-type') || ''
    console.log('📦 Content-Type:', contentType)

    if (!response.ok) {
      const error = await response.text()
      console.error('❌ API Error Response:', error)
      throw new Error(`Imagine.art error (${response.status}): ${error}`)
    }

    // Handle image response (binary)
    if (contentType.includes('image/')) {
      console.log('✅ Received binary image response')
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const base64 = buffer.toString('base64')
      const mimeType = contentType.split(';')[0] || 'image/png'
      const imageUrl = `data:${mimeType};base64,${base64}`
      console.log('🎉 Converted to base64, length:', base64.length)
      return res.status(200).json({ imageUrl })
    }

    // Handle JSON response
    const data = await response.json()
    console.log('📦 Raw API Response:', JSON.stringify(data, null, 2))

    // Try multiple response formats
    let imageUrl = null

    // Format 1: data.data[0].url
    if (data.data && Array.isArray(data.data) && data.data[0] && data.data[0].url) {
      imageUrl = data.data[0].url
      console.log('✅ Found URL in data.data[0].url')
    }
    // Format 2: Direct url field
    else if (data.url && typeof data.url === 'string') {
      imageUrl = data.url
      console.log('✅ Found URL in data.url')
    }
    // Format 3: Direct image field (base64)
    else if (data.image && typeof data.image === 'string') {
      imageUrl = data.image.startsWith('data:') ? data.image : `data:image/png;base64,${data.image}`
      console.log('✅ Found image in data.image')
    }
    // Format 4: output array
    else if (data.output && Array.isArray(data.output) && data.output[0]) {
      imageUrl = data.output[0]
      console.log('✅ Found URL in data.output[0]')
    }
    // Format 5: output string
    else if (data.output && typeof data.output === 'string') {
      imageUrl = data.output
      console.log('✅ Found URL in data.output')
    }
    // Format 6: result field
    else if (data.result && typeof data.result === 'string') {
      imageUrl = data.result
      console.log('✅ Found URL in data.result')
    }

    if (imageUrl) {
      console.log('🎉 Returning image URL:', typeof imageUrl === 'string' ? imageUrl.substring(0, 100) + '...' : '[invalid]')
      res.status(200).json({ imageUrl })
    } else {
      console.error('❌ No image URL found in any expected format')
      console.error('📦 Data keys:', Object.keys(data))
      throw new Error('No image URL in response - unexpected format')
    }

  } catch (error) {
    console.error('❌ Imagine.art error:', error.message)
    res.status(500).json({ error: 'Imagine.art generation failed', details: error.message })
  }
})

// ============================================
// HUGGING FACE API (Open Source Models)
// ============================================
app.post('/api/huggingface', async (req, res) => {
  try {
    const { model, prompt, sourceImage, strength } = req.body
    const apiKey = process.env.VITE_HUGGINGFACE_API_KEY

    if (!apiKey) {
      return res.status(400).json({ error: 'Hugging Face API key not configured' })
    }

    const modelMap = {
      'flux-dev': 'black-forest-labs/FLUX.1-dev',
      'flux-schnell': 'black-forest-labs/FLUX.1-schnell',
      'stable-diffusion-xl': 'stabilityai/stable-diffusion-xl-base-1.0',
      'stable-diffusion-2.1': 'stabilityai/stable-diffusion-2-1',
      'dreamshaper': 'Lykon/DreamShaper'
    }

    const modelName = modelMap[model] || modelMap['stable-diffusion-xl']
    const url = `https://api-inference.huggingface.co/models/${modelName}`

    const requestBody = {
      inputs: prompt,
      parameters: {
        num_inference_steps: 30,
        guidance_scale: 7.5
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (response.status === 503) {
      const errorText = await response.text()
      if (errorText.includes('loading')) {
        const match = errorText.match(/estimated_time":\s*(\d+\.?\d*)/)
        const waitTime = match ? parseFloat(match[1]) : 20

        return res.status(503).json({
          error: 'Model is loading',
          retryAfter: waitTime,
          details: `Model warming up. Retry in ${Math.ceil(waitTime)}s`
        })
      }
    }

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Hugging Face error (${response.status}): ${error}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const base64 = buffer.toString('base64')
    const imageUrl = `data:image/png;base64,${base64}`

    res.status(200).json({ imageUrl })

  } catch (error) {
    console.error('❌ Hugging Face error:', error.message)
    res.status(500).json({ error: 'Hugging Face generation failed', details: error.message })
  }
})

// ============================================
// PAYMENT LINK GENERATION
// ============================================
app.post('/api/payment-link', async (req, res) => {
  try {
    console.log('\n💳 === PAYMENT LINK GENERATION ===')
    const { clientName, clientEmail, items, totalAmount } = req.body

    // Generate a unique payment reference
    const paymentRef = `PAY-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`

    // Forward to N8N webhook if configured
    const n8nWebhook = process.env.VITE_N8N_PAYMENT_WEBHOOK
    if (n8nWebhook) {
      try {
        await fetch(n8nWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentRef,
            clientName,
            clientEmail,
            items,
            totalAmount,
            timestamp: new Date().toISOString()
          })
        })
        console.log('✅ Payment data sent to N8N webhook')
      } catch (webhookError) {
        console.warn('⚠️ N8N webhook failed:', webhookError.message)
      }
    }

    // Return payment link (placeholder - integrate with actual payment processor)
    const paymentLink = `https://pay.luminus.com/${paymentRef}`

    console.log('✅ Payment link generated:', paymentRef)
    res.status(200).json({
      paymentLink,
      paymentRef,
      success: true
    })

  } catch (error) {
    console.error('❌ Payment link error:', error.message)
    res.status(500).json({ error: 'Payment link generation failed', details: error.message })
  }
})

// ============================================
// GOOGLE SHEETS INTEGRATION VIA N8N
// ============================================
app.post('/api/send-to-sheets', async (req, res) => {
  try {
    console.log('\n📊 === SENDING TO GOOGLE SHEETS ===')
    const { name, price, size, image, signType, timestamp } = req.body

    const googleScriptUrl = process.env.VITE_GOOGLE_SHEETS_SCRIPT_URL
    const n8nWebhook = process.env.VITE_N8N_SHEETS_WEBHOOK

    if (!googleScriptUrl && !n8nWebhook) {
      console.warn('⚠️ No Sheets webhooks configured')
      return res.status(200).json({
        success: false,
        message: 'No webhooks configured. Data logged locally.',
        data: { name, price, size, image, timestamp }
      })
    }

    // Google Apps Script Payload (Strict Schema)
    const googlePayload = {
      productName: `${name} - ${signType || 'Signage'}`, // Combine Name + Sign Type
      price: price,
      size: size,
      imageUrl: image // Map 'image' to 'imageUrl'
    }

    // N8N Payload (Flexible)
    const n8nPayload = {
      name,
      price,
      size,
      image,
      signType,
      timestamp: timestamp || new Date().toISOString()
    }

    const promises = []

    // 1. Send to Google Apps Script
    if (googleScriptUrl) {
      console.log('📤 Sending to Google Apps Script...', googlePayload)
      const p1 = fetch(googleScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(googlePayload)
      })
        .then(r => {
          if (r.ok) console.log('✅ Sent to Google Script')
          else console.error('❌ Google Script failed:', r.statusText)
          return r
        })
        .catch(e => console.error('❌ Google Script error:', e.message))

      promises.push(p1)
    }

    // 2. Send to N8N
    if (n8nWebhook) {
      console.log('📤 Sending to N8N...')
      const p2 = fetch(n8nWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(n8nPayload)
      })
        .then(r => {
          if (r.ok) console.log('✅ Sent to N8N')
          else console.error('❌ N8N failed:', r.statusText)
          return r
        })
        .catch(e => console.error('❌ N8N error:', e.message))

      promises.push(p2)
    }

    await Promise.all(promises)

    res.status(200).json({ success: true, message: 'Data sent to configured webhooks' })

  } catch (error) {
    console.error('❌ Sheets integration error:', error.message)
    // Don't crash frontend if webhook fails
    res.status(200).json({ success: false, message: 'Webhook error, check server logs' })
  }
})

// ============================================
// EMAIL SENDING — Direct SMTP via Nodemailer
// Falls back gracefully; also fires N8N hook
// ============================================
app.post('/api/send-email', async (req, res) => {
  try {
    console.log('\n📧 === SENDING EMAIL (Hostinger SMTP) ===')
    const { clientName, clientEmail, pdfBase64, companyId, leadId } = req.body

    if (!clientEmail) {
      return res.status(400).json({ error: 'Client email is required' })
    }

    if (!pdfBase64) {
      return res.status(400).json({ error: 'PDF data is required' })
    }

    const smtpUser = process.env.SMTP_USER
    const smtpPass = process.env.SMTP_PASS
    const settings = await loadAdminSettings()
    const fromName = settings.smtpFromName || process.env.SMTP_FROM_NAME || 'Signage Crafting'

    if (!smtpUser || !smtpPass) {
      console.warn('⚠️ SMTP credentials not set in .env')
      return res.status(500).json({ error: 'SMTP credentials not configured' })
    }

    console.log(`📤 Sending proposal for "${clientName}" to ${clientEmail}`)

    // Build a clean PDF filename
    const safeClientName = (clientName || 'Client').replace(/[^a-z0-9]/gi, '_')
    const fileName = `${safeClientName}_Proposal.pdf`

    // Convert base64 to Buffer
    const pdfBuffer = Buffer.from(pdfBase64, 'base64')

    const proposalDateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

    // Build email
    const transporter = createSMTPTransporter()
    const mailOptions = {
      from: `"${fromName}" <${smtpUser}>`,
      to: clientEmail,
      ...(settings.clientCcEnabled && settings.clientCcEmail ? { cc: settings.clientCcEmail } : {}),
      subject: `Your Custom Signage Proposal Is Ready, ${clientName || 'Valued Client'}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 24px 30px; text-align: left;">
            <h1 style="color: #38bdf8; font-size: 22px; font-weight: 800; margin: 0; letter-spacing: 0.5px;">Signage Crafting</h1>
          </div>
          <div style="padding: 30px; font-size: 15px; line-height: 1.65; color: #334155;">
            <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin-top: 0;">Hi ${clientName || 'there'},</p>
            
            <p style="margin-bottom: 16px;">Your custom signage proposal is ready for review — I think you'll be pleased with how it turned out.</p>
            
            <p style="margin-bottom: 12px;">To move this project forward with no surprises, here's what's included:</p>
            
            <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px 20px; margin: 18px 0;">
              <ul style="list-style: none; padding: 0; margin: 0;">
                <li style="margin-bottom: 10px; color: #0369a1; font-size: 14.5px;">
                  <span style="color: #0284c7; font-weight: bold; margin-right: 8px;">•</span><strong>10% discount</strong>, locked in through <strong>${proposalDateStr}</strong>
                </li>
                <li style="margin-bottom: 10px; color: #0369a1; font-size: 14.5px;">
                  <span style="color: #0284c7; font-weight: bold; margin-right: 8px;">•</span><strong>Unlimited design revisions</strong> included, so we can fine-tune the details together
                </li>
                <li style="color: #0369a1; font-size: 14.5px;">
                  <span style="color: #0284c7; font-weight: bold; margin-right: 8px;">•</span><strong>Professional installation</strong> and mounting kit.
                </li>
              </ul>
            </div>

            <div style="display: inline-block; background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 6px; margin: 12px 0 20px 0;">
              📎 Proposal PDF attached for your review
            </div>
            
            <p style="margin-bottom: 16px;">Take a look and let me know your thoughts — happy to adjust anything that's not quite right. Once you're ready to move forward, I'll send a secure payment link along with a clear timeline for production.</p>
            
            <p style="margin-bottom: 24px;">I'm available by email or phone if you'd like to talk through the design or next steps.</p>
            
            <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 6px 0; color: #64748b; font-size: 14px;">Best,</p>
              <p style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 4px 0;">Steven <span style="font-weight: 400; color: #64748b; font-size: 14px;">| Customer Relationship</span></p>
              <p style="font-size: 15px; font-weight: 700; color: #0284c7; margin: 0 0 6px 0;">Signage Crafting</p>
              <div style="font-size: 13.5px; color: #64748b;">
                <a href="mailto:Info@signagecrafting.com" style="color: #0284c7; text-decoration: none; font-weight: 600;">Info@signagecrafting.com</a><br/>
                <a href="https://signagecrafting.com" target="_blank" style="color: #0284c7; text-decoration: none;">https://signagecrafting.com</a>
              </div>
            </div>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: fileName,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    }

    // Send via SMTP
    const info = await transporter.sendMail(mailOptions)
    console.log('✅ Email sent via SMTP:', info.messageId)

    // Best-effort — a lead fetched before this feature shipped, or one sent from outside
    // the normal queue flow, won't have a leadId to stamp; that just means a future
    // duplicate-fetch of it won't be able to say "email already sent," nothing breaks.
    if (leadId) {
      const sentBy = friendlyDeviceLabel(req.headers['user-agent'], req.ip)
      markLeadEmailSent(leadId, sentBy).catch((err) => console.warn('⚠️  markLeadEmailSent failed (non-critical):', err.message))
    }

    // Also fire N8N webhook in background for tracking (non-blocking)
    const webhookUrl = process.env.N8N_EMAIL_WEBHOOK || process.env.VITE_N8N_EMAIL_WEBHOOK
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName, clientEmail, companyId, date: new Date().toISOString(), messageId: info.messageId })
      }).catch(err => console.warn('⚠️ N8N webhook ping failed (non-critical):', err.message))
    }

    // CRM: keep a copy of the sent proposal + log it on the client's thread. Non-blocking.
    saveCrmProposalCopy({
      leadId,
      clientName,
      clientEmail,
      pdfBuffer,
      fileName,
      messageId: info.messageId,
      subject: `Your Custom Signage Proposal Is Ready, ${clientName || 'Valued Client'}`
    }).catch(err => console.warn('⚠️ CRM proposal-copy save failed (non-critical):', err.message))

    res.status(200).json({ success: true, serviceUsed: 'SMTP', messageId: info.messageId })

  } catch (error) {
    console.error('❌ Email sending error:', error.message)
    res.status(500).json({ error: 'Failed to send email', details: error.message })
  }
})

// Caps how many migrate.py subprocesses run at once ACROSS ALL employees' fetch
// requests at the same time — not just within one person's batch (that already runs
// sequentially). Each subprocess can download tens of MB of mockups, so several
// employees clicking Fetch simultaneously on a modest shared VM could otherwise choke
// it. Extra requests wait their turn instead of piling on.
const MAX_CONCURRENT_FETCHES = 2
let activeFetches = 0
const fetchQueue = []
function acquireFetchSlot() {
  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    activeFetches++
    return Promise.resolve()
  }
  return new Promise((resolve) => fetchQueue.push(resolve))
}
function releaseFetchSlot() {
  const next = fetchQueue.shift()
  if (next) next()
  else activeFetches--
}

// Spawn migrate.py, but keep a handle to the child process so a caller can kill it
// (used both for the per-client timeout and for user-initiated cancel).
function spawnMigrate(args, options) {
  let child
  const promise = new Promise((resolve, reject) => {
    child = execFile('python3', args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
  return { promise, child }
}

const MIGRATE_ENV = (crmToken, geminiKey, geminiKey2, geminiKey3, geminiKey4, geminiKeyTier1) => ({
  ...process.env,
  CRM_API_TOKEN: crmToken,
  GEMINI_API_KEY: geminiKey || '',
  // migrate.py rotates across every free-tier account (and every fallback text model) on
  // a 429/403 before giving up, same as the app's own /api/gemini — one account/model
  // running out of quota mid-batch no longer stops a fetch.
  GEMINI_API_KEY_2: geminiKey2 || '',
  GEMINI_API_KEY_3: geminiKey3 || '',
  GEMINI_API_KEY_4: geminiKey4 || '',
  // Paid key, much higher limits — migrate.py only reaches for this once every free-tier
  // key/model combination above is exhausted, not on every call.
  GEMINI_API_KEY_TIER1: geminiKeyTier1 || '',
  // This machine's python3 doesn't resolve system CAs without this — same fix
  // used when running migrate.py by hand from the terminal.
  SSL_CERT_FILE: process.env.SSL_CERT_FILE || '/usr/local/etc/ca-certificates/cert.pem'
})

// Lists configured CRM sources (label + id) so the Fetch panel can offer a picker —
// labels come from .env only (CRM_SOURCE_<n>_LABEL), never hardcoded here, so no
// brand name ever appears in committed code.
app.get('/api/crm-sources', async (req, res) => {
  const scriptDir = process.env.MIGRATION_SCRIPT_DIR
  if (!scriptDir) return res.status(400).json({ error: 'MIGRATION_SCRIPT_DIR not configured' })
  try {
    const { promise } = spawnMigrate(
      ['migrate.py', '--list-sources'],
      { cwd: scriptDir, env: MIGRATE_ENV(process.env.CRM_API_TOKEN, ''), timeout: 10000 }
    )
    const { stdout } = await promise
    const { sources } = JSON.parse(stdout.trim().split('\n').pop())
    res.status(200).json({ sources })
  } catch (error) {
    res.status(500).json({ error: 'Failed to list CRM sources', details: error.message })
  }
})

// Server-side holding pen for raw Airtable records from a list-only lookup, so the
// "skip redundant re-lookup" fast path (see /api/migrate-lead below) never has to send
// the raw record to the browser. Those records carry real, unaliased brand info deep in
// their own fields (e.g. a "Project Name" field, or internal Airtable URLs literally
// containing the real base ID) that no amount of UI-level aliasing can hide once it's
// sitting in a DevTools Network response — so it just never leaves the server.
// recordId -> { record, expiresAt }. Needs to survive Look Up -> Fetch for a manual
// run, and the whole daily fetch for the automated one — a large day chunked 15 at a
// time can take well over an hour end to end, and every chunk that misses this cache
// falls back to a paid per-record CRM lookup. 6h covers both comfortably; the cache
// only ever holds one day's leads (tens to low hundreds of small records).
const listRecordCache = new Map()
const RECORD_CACHE_TTL_MS = 6 * 60 * 60 * 1000
function cacheRecords(leads) {
  const now = Date.now()
  for (const [id, entry] of listRecordCache) {
    if (entry.expiresAt < now) listRecordCache.delete(id)
  }
  for (const l of leads) {
    if (l.recordId && l.record) listRecordCache.set(l.recordId, { record: l.record, expiresAt: now + RECORD_CACHE_TTL_MS })
  }
}
function stripRecordForClient(l) {
  const { record, ...rest } = l
  return rest
}

// Every generated proposal embeds its mockup/technical-drawing images as base64 — a
// couple MB per lead — which is fine for the browser but would blow through Supabase's
// free-tier DB storage in days at any real fetch volume. The full JSON (images intact)
// is archived to disk here; only a stripped copy (images blanked, archive path kept)
// goes to Supabase. rehydrateFromArchive reverses this when a saved lead is loaded back.
async function archiveAndStripImages(data, leadLabel, batchId) {
  const safeName = (leadLabel || 'lead').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'lead'
  const batchDir = path.join(BATCH_ARCHIVE_DIR, batchId)
  await fs.mkdir(batchDir, { recursive: true })
  const relPath = path.join(batchId, `${safeName}-${Date.now()}.json`)
  await fs.writeFile(path.join(BATCH_ARCHIVE_DIR, relPath), JSON.stringify(data))

  const stripped = JSON.parse(JSON.stringify(data))

  // Individual image files, written alongside the one big JSON archive above (which stays
  // as-is for rehydrateFromArchive's own use) — a separate Google Drive sync step needs
  // real files it can hand to the Drive API, not base64 buried inside one JSON blob.
  const imagePaths = []
  for (const [pi, page] of (stripped.pages || []).entries()) {
    for (const [ai, asset] of (page.assets || []).entries()) {
      if (typeof asset.src === 'string' && asset.src.startsWith('data:image')) {
        const match = asset.src.match(/^data:image\/(\w+);base64,(.*)$/)
        if (match) {
          const [, ext, b64] = match
          const imgRelPath = path.join(batchId, `${safeName}-p${pi}-a${ai}.${ext}`)
          await fs.writeFile(path.join(BATCH_ARCHIVE_DIR, imgRelPath), Buffer.from(b64, 'base64'))
          imagePaths.push(imgRelPath)
        }
        asset.src = null
      }
    }
  }

  // The original proposal PDF (see migrate.py's payload.sourcePdf) — never persisted
  // anywhere before this. Written out here for the same Drive-sync reason as the images
  // above, then stripped from what reaches Supabase (Supabase only needs text/pricing).
  let pdfPath = null
  if (data.sourcePdf && data.sourcePdf.base64) {
    const pdfName = (data.sourcePdf.filename || 'proposal.pdf').replace(/[^a-zA-Z0-9_.-]+/g, '_')
    pdfPath = path.join(batchId, `${safeName}-${pdfName}`)
    await fs.writeFile(path.join(BATCH_ARCHIVE_DIR, pdfPath), Buffer.from(data.sourcePdf.base64, 'base64'))
  }
  delete stripped.sourcePdf

  return { stripped, archivePath: relPath, imagePaths, pdfPath }
}

// "Small/Medium/Large"-style pricing tables aren't guaranteed to be listed smallest-first
// (confirmed inconsistent across real records) — parsed by area from the dimension string
// instead of trusting row order, so this reliably picks the actual smallest option's
// price for the Sheets row, matching what the client would pay for the base size.
function smallestPricingRow(data) {
  const pricing = data.pages?.[0]?.pricing || []
  if (!pricing.length) return null
  const area = (dim) => {
    const nums = (dim || '').match(/\d+(\.\d+)?/g)
    if (!nums || nums.length < 2) return Infinity
    return parseFloat(nums[0]) * parseFloat(nums[1])
  }
  return pricing.reduce((best, row) => (area(row.dim) < area(best.dim) ? row : best), pricing[0])
}

// Fire-and-forget push to the n8n workflow that appends the Sheets row (see n8n workflow
// "Google Sync - Leads") — same non-blocking pattern as the existing N8N_EMAIL_WEBHOOK
// ping just above, so a Google API hiccup or the sync running slow can never hold up or
// fail the actual lead save. Drive upload is handled separately below via rclone, not
// through this webhook — a bare Google service account can't own file content in a
// personal Drive (confirmed live: every upload attempt came back "Service Accounts do
// not have storage quota"), so Sheets (which has no such restriction) stays on the
// original n8n/service-account path while Drive moved to a real user-authorized rclone
// remote instead.
// Confirmed live as a real bug: this used to ONLY pull the date out of the batchId
// string (daily-2026-08-16-<ts>) — which meant every fetch that isn't the exact automated
// daily job (a manual by-date fetch, "Fetch All Companies", this week's force re-fetches)
// used a batchId that doesn't match that pattern at all, silently falling through to
// TODAY's date instead of the lead's actual CRM date. Now takes the real target date
// directly when the caller has one (every fetch path that knows a date already passes it
// through req.body.date) — batchId-parsing is only a fallback for the rare case neither
// is available, and "today" is the last resort, not the common case.
function resolveLeadDateForSheet(explicitDate, batchId) {
  if (explicitDate) return explicitDate
  const m = /^daily-(\d{4}-\d{2}-\d{2})-/.exec(batchId || '')
  return m ? m[1] : new Date().toISOString().slice(0, 10)
}

function notifyGoogleSync(data, date, batchId) {
  const webhookUrl = process.env.N8N_GOOGLE_SYNC_WEBHOOK
  if (!webhookUrl) return
  const row = smallestPricingRow(data)
  // The Drive folder isn't known to exist yet at this exact moment (rclone upload below
  // is fire-and-forget and can take minutes for a large PDF) — rather than block the
  // Sheets row on that, this links to a Drive search for the client's own name, which
  // reliably surfaces their folder the moment it exists, no upload-completion race needed.
  const driveLink = `https://drive.google.com/drive/search?q=%22${encodeURIComponent(data.clientName || '')}%22`
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: resolveLeadDateForSheet(date, batchId),
      clientName: data.clientName || 'Unknown Client',
      signType: data.pages?.[0]?.signType || '',
      dimensions: row?.dim || '',
      phone: data.contactPhone || '',
      email: data.contactEmail || '',
      size: row?.size || '',
      price: row?.cost || '',
      status: data.status || '',
      driveLink
    })
  }).catch((err) => console.warn('⚠️ Google Sync webhook ping failed (non-critical):', err.message))
}

// Fire-and-forget ping into n8n after a follow-up email actually goes out — purely for
// visibility/logging (e.g. a Sheets row), not the send path itself. Deliberately NOT
// routed through n8n's own SMTP node: that credential has already broken once this
// session (535 auth error), and a months-long client drip sequence is exactly the kind of
// thing that must keep working even if n8n's mail credential goes stale again — so the
// actual send uses the same SMTP transporter as every other email in this file, and n8n
// only ever hears about it after the fact.
function notifyFollowUpSent({ clientName, clientEmail, followUpNumber, daysSinceOriginal }) {
  const webhookUrl = process.env.N8N_FOLLOWUP_WEBHOOK
  if (!webhookUrl) return
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientName, clientEmail, followUpNumber, daysSinceOriginal,
      sentAt: new Date().toISOString()
    })
  }).catch((err) => console.warn('⚠️ Follow-up log webhook ping failed (non-critical):', err.message))
}

// Uploads this lead's archived images + PDF straight into their own Drive folder via the
// rclone "drive" remote (see rclone.conf) — gated behind RCLONE_DRIVE_ENABLED so it only
// ever runs where that's explicitly turned on (production), never on staging test fetches.
// Fire-and-forget per file, same reasoning as notifyGoogleSync: a slow/failed upload must
// never hold up or break the actual lead save.
// Confirmed live as a real bug during a large bulk fetch: firing every file's upload as
// its own unlimited, untracked execFile() call meant dozens of leads × several files each
// could spawn a huge burst of concurrent rclone processes with zero queueing — some got
// silently starved/lost under the load, with nothing ever logged (execFile's callback
// only fires on an actual error, not on a process that just never got its fair share of
// resources). A small fixed-concurrency queue with retries fixes this: every upload is
// awaited and tracked, so a real failure is always visible, and the queue itself bounds
// how many rclone processes exist at once regardless of how large a batch is.
const DRIVE_UPLOAD_CONCURRENCY = 4
let driveUploadActive = 0
const driveUploadQueue = []

function runRcloneCopy(localPath, destPath) {
  return new Promise((resolve, reject) => {
    execFile('rclone', ['copyto', localPath, destPath], (err) => (err ? reject(err) : resolve()))
  })
}

async function queueDriveUpload(localPath, destPath, fileName, attempt = 1) {
  try {
    await runRcloneCopy(localPath, destPath)
  } catch (err) {
    if (attempt < 3) {
      console.warn(`⚠️ rclone upload retry ${attempt} for ${fileName}: ${err.message}`)
      return queueDriveUpload(localPath, destPath, fileName, attempt + 1)
    }
    console.error(`❌ rclone upload FAILED after ${attempt} attempts for ${fileName} — this file is missing from Drive:`, err.message)
  }
}

function processDriveQueue() {
  while (driveUploadActive < DRIVE_UPLOAD_CONCURRENCY && driveUploadQueue.length > 0) {
    const job = driveUploadQueue.shift()
    driveUploadActive++
    queueDriveUpload(job.localPath, job.destPath, job.fileName)
      .finally(() => {
        driveUploadActive--
        processDriveQueue()
      })
  }
}

function uploadToDriveViaRclone(clientName, imagePaths, pdfPath) {
  if (!process.env.RCLONE_DRIVE_ENABLED) return
  const safeName = (clientName || 'Unknown Client').replace(/[^a-zA-Z0-9 _-]+/g, '').trim() || 'Unknown Client'
  const dest = `drive:SC LEADS/${safeName}`
  for (const relPath of [...(imagePaths || []), ...(pdfPath ? [pdfPath] : [])]) {
    const localPath = path.join(BATCH_ARCHIVE_DIR, relPath)
    const fileName = path.basename(relPath)
    driveUploadQueue.push({ localPath, destPath: `${dest}/${fileName}`, fileName })
  }
  processDriveQueue()
}

// Saves a copy of a proposal PDF we just emailed: to the CRM hot folder on disk,
// onto the same rclone → Drive queue as the mockups, and as an outbound message +
// attachment row so the thread shows "we sent the proposal" with the file on it.
// Fire-and-forget — a failure here must never affect the send that already succeeded.
async function saveCrmProposalCopy({ leadId, clientName, clientEmail, pdfBuffer, fileName, messageId, subject }) {
  const safeClient = (clientName || 'client').replace(/[^a-zA-Z0-9 _-]+/g, '').trim() || 'client'
  const folder = path.join(CRM_STORAGE_DIR, `${leadId || 'x'}-${safeClient}`)
  mkdirSync(folder, { recursive: true })
  const diskPath = path.join(folder, fileName)
  await fs.writeFile(diskPath, pdfBuffer)

  const drivePath = `drive:SC LEADS/${safeClient}/${fileName}`
  if (process.env.RCLONE_DRIVE_ENABLED) {
    driveUploadQueue.push({ localPath: diskPath, destPath: drivePath, fileName })
    processDriveQueue()
  }

  const logged = await crmLogOutbound({
    leadId: leadId || null,
    messageId,
    fromAddr: process.env.SMTP_USER,
    fromName: process.env.SMTP_FROM_NAME || 'Signage Crafting',
    toAddr: clientEmail,
    subject,
    bodyText: 'Proposal PDF sent.',
    sentAt: new Date().toISOString()
  })
  await crmRecordAttachment({
    messageId: logged.messageId,
    leadId: leadId || null,
    kind: 'proposal-pdf',
    filename: fileName,
    contentType: 'application/pdf',
    sizeBytes: pdfBuffer.length,
    diskPath,
    drivePath: process.env.RCLONE_DRIVE_ENABLED ? drivePath : null
  })
}

async function rehydrateFromArchive(data, archivePath) {
  if (!archivePath) return data
  try {
    const full = JSON.parse(await fs.readFile(path.join(BATCH_ARCHIVE_DIR, archivePath), 'utf-8'))
    const merged = JSON.parse(JSON.stringify(data))
    ;(merged.pages || []).forEach((page, pi) => {
      ;(page.assets || []).forEach((asset, ai) => {
        const archivedSrc = full.pages?.[pi]?.assets?.[ai]?.src
        if (archivedSrc) asset.src = archivedSrc
      })
    })
    return merged
  } catch {
    return data // archive missing/pruned by retention — degrade gracefully, text/pricing still intact
  }
}

function newBatchId() {
  return `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

// Cheap lookup only — one Airtable call, no PDF/AI processing, no per-client fetch.
// Lets "By Date" show the operator exactly who was found on that date so they can pick
// which ones to actually fetch, instead of every lead on that date being auto-fetched
// (each with its own real AI cost) the instant a date is chosen.
app.get('/api/crm-leads-for-date', async (req, res) => {
  const scriptDir = process.env.MIGRATION_SCRIPT_DIR
  const crmToken = process.env.CRM_API_TOKEN
  const { date, source } = req.query
  if (!scriptDir || !crmToken) {
    return res.status(400).json({ error: 'Migration not configured. Set MIGRATION_SCRIPT_DIR and CRM_API_TOKEN in .env.' })
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD.' })
  }
  try {
    const { promise } = spawnMigrate(
      ['migrate.py', '--date', date, '--list-only', '--source', (source || '1').toString()],
      { cwd: scriptDir, env: MIGRATE_ENV(crmToken, ''), timeout: 30000, maxBuffer: 20 * 1024 * 1024 }
    )
    const { stdout } = await promise
    const { leads } = JSON.parse(stdout.trim().split('\n').pop())
    cacheRecords(leads)
    res.status(200).json({ leads: leads.map(stripRecordForClient) })
  } catch (error) {
    res.status(500).json({ error: 'Failed to look up leads for that date', details: error.message })
  }
})

// Same list-only lookup as above, but across every configured CRM source at once,
// merged into one list. Runs concurrently — Airtable's 5 req/sec limit is per-base, so
// separate bases don't contend with each other. One source erroring (e.g. a transient
// Airtable hiccup) doesn't fail the rest; it's reported per-source instead.
app.get('/api/crm-leads-for-date-all', async (req, res) => {
  const scriptDir = process.env.MIGRATION_SCRIPT_DIR
  const crmToken = process.env.CRM_API_TOKEN
  const { date } = req.query
  if (!scriptDir || !crmToken) {
    return res.status(400).json({ error: 'Migration not configured. Set MIGRATION_SCRIPT_DIR and CRM_API_TOKEN in .env.' })
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD.' })
  }
  try {
    const { promise: listPromise } = spawnMigrate(
      ['migrate.py', '--list-sources'],
      { cwd: scriptDir, env: MIGRATE_ENV(crmToken, ''), timeout: 10000 }
    )
    const { stdout: listStdout } = await listPromise
    const { sources } = JSON.parse(listStdout.trim().split('\n').pop())

    const perSourceResults = await Promise.all(sources.map(async (src) => {
      try {
        const { promise } = spawnMigrate(
          ['migrate.py', '--date', date, '--list-only', '--source', src.id],
          { cwd: scriptDir, env: MIGRATE_ENV(crmToken, ''), timeout: 30000, maxBuffer: 20 * 1024 * 1024 }
        )
        const { stdout } = await promise
        const { leads } = JSON.parse(stdout.trim().split('\n').pop())
        return { sourceId: src.id, label: src.label, leads: leads || [], error: null }
      } catch (error) {
        return { sourceId: src.id, label: src.label, leads: [], error: error.message }
      }
    }))

    perSourceResults.forEach((r) => cacheRecords(r.leads))
    const leads = perSourceResults.flatMap((r) =>
      r.leads.map((l) => stripRecordForClient({ ...l, sourceId: r.sourceId, sourceLabel: r.label }))
    )
    const perSource = perSourceResults.map((r) => ({ sourceId: r.sourceId, label: r.label, count: r.leads.length, error: r.error }))
    res.status(200).json({ leads, perSource })
  } catch (error) {
    res.status(500).json({ error: 'Failed to look up leads across all sources', details: error.message })
  }
})

// ============================================
// LEAD IMPORT — fetch a lead (or a sheet of leads) from the CRM
// straight into the editor, no terminal, no manual file upload.
//
// Streams one NDJSON event per line so the frontend can show live per-client progress
// instead of waiting on one all-or-nothing response. Each client runs as its OWN
// migrate.py subprocess with its own 150s timeout — one stuck/oversized lead can only
// ever cost 150s and gets marked "failed", it can never take the rest of the batch down
// with it, and whatever already succeeded is delivered to the browser immediately.
// If the client disconnects (cancel button, tab closed), we kill whatever is currently
// running and stop — no further API calls happen.
// ============================================
app.post('/api/migrate-lead', async (req, res) => {
  const scriptDir = process.env.MIGRATION_SCRIPT_DIR
  const crmToken = process.env.CRM_API_TOKEN
  const geminiKey = process.env.VITE_GEMINI_API_KEY
  const geminiKey2 = process.env.VITE_GEMINI_API_KEY_2
  const geminiKey3 = process.env.VITE_GEMINI_API_KEY_3
  const geminiKey4 = process.env.VITE_GEMINI_API_KEY_4
  const geminiKeyTier1 = process.env.VITE_GEMINI_API_KEY_TIER1

  if (!scriptDir || !crmToken) {
    return res.status(400).json({
      error: 'Migration not configured. Set MIGRATION_SCRIPT_DIR and CRM_API_TOKEN in .env.'
    })
  }

  // `useCache`, when true, is the "By Date" panel's optional fast path: a caller that
  // already listed this date's leads (via /api/crm-leads-for-date[-all]) already caused
  // the server to hold each lead's full Airtable record in listRecordCache, keyed by
  // recordId — so instead of the browser echoing the raw record back here (which would
  // put unaliased brand info in a request body visible in DevTools), the server just
  // looks its own cache up by id. Entirely opt-in and best-effort: a cache miss (expired,
  // or never looked up this way) just falls through to resolving that lead fresh via the CRM.
  const { names, date, source, useCache, batchId: clientBatchId, dailyAuto } = req.body
  const src = (source || '1').toString()
  const crmSourceAlias = process.env[`CRM_SOURCE_${src}_LABEL`] || null
  // One batch_id per user-initiated fetch action, even when "Fetch All Companies" splits
  // it into several requests (one per source) — the client generates and reuses the same
  // id across those requests. Falls back to a fresh one for direct/automated callers
  // (e.g. the daily fetch script) that don't pass one.
  const batchId = clientBatchId || newBatchId()
  const nameList = (Array.isArray(names) ? names : [names]).map((n) => (n || '').trim())
  let entries = nameList
    .map((n) => ({ id: n, label: n, record: useCache ? (listRecordCache.get(n)?.record || null) : null }))
    .filter((e) => e.id)

  if (entries.length === 0 && !date) {
    return res.status(400).json({ error: 'Provide at least one client name/ID, or a date.' })
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD.' })
  }

  // Fire-and-forget notification that a fetch just started — one email per request (a
  // "Fetch All Companies" click sends one request per source, so that's one email per
  // source, not per lead — a single manual fetch of several names in one request is one
  // email covering all of them). Never awaited/blocking: a slow or failed send must not
  // hold up or break the actual fetch.
  notifyFetchStarted({
    dailyAuto: !!dailyAuto,
    sourceAlias: crmSourceAlias || `Source ${src}`,
    count: date ? null : entries.length,
    date: date || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null
  }).catch((err) => console.warn('⚠️  Fetch-started notification email failed (non-critical):', err.message))

  const env = MIGRATE_ENV(crmToken, geminiKey, geminiKey2, geminiKey3, geminiKey4, geminiKeyTier1)

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no'
    // No internal provenance header here on purpose — a response header is visible in
    // DevTools' Network tab to anyone using the app regardless of whether frontend code
    // reads it, so it doesn't actually stay "internal." Removed for the same reason
    // migrate.py's _source stopped including schemaRev/imageMatches.
  })
  const send = (obj) => res.write(JSON.stringify(obj) + '\n')

  let aborted = false
  let currentChild = null
  // NOTE: `req`'s 'close' fires as soon as Express finishes reading the POST body —
  // essentially immediately, NOT when the client disconnects — so it's the wrong signal
  // to use here (it caused every run to randomly self-cancel). The response socket only
  // closing early, before we ourselves called res.end(), is what actually means the
  // client (or a proxy in between) dropped the connection.
  res.on('close', () => {
    if (res.writableEnded) return
    aborted = true
    if (currentChild) currentChild.kill('SIGTERM')
  })

  // A client can take 20-150s with zero bytes written in between (Python does its
  // work silently). Some proxies close connections that go quiet that long, so keep
  // the stream visibly alive regardless of proxy timeout tuning.
  const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10 * 1000)

  console.log(`\n🔄 === LEAD IMPORT: ${date ? `date ${date}` : `${entries.length} lead(s)`} ===`)

  try {
    // Re-list here ONLY for a bare "fetch everything on this date" caller (a date with
    // no explicit lead IDs). Every real caller — the manual By-Date panel and the daily
    // fetch — sends the record IDs it already got from its own Look Up / list step, plus
    // `useCache` so `entries` above is hydrated from listRecordCache. Re-listing when we
    // already have the IDs repeats a CRM list call the caller already paid for, and then
    // (before this) re-resolved every lead one more time, one paid CRM call each. The
    // `date` still travels through so per-lead duplicate skips get associated with it.
    if (date && entries.length === 0) {
      send({ type: 'listing', message: `Looking up leads for ${date}...` })
      const { promise } = spawnMigrate(
        ['migrate.py', '--date', date, '--list-only', '--source', src],
        { cwd: scriptDir, env, timeout: 30000, maxBuffer: 20 * 1024 * 1024 }
      )
      const { stdout } = await promise
      const { leads } = JSON.parse(stdout.trim().split('\n').pop())
      // Carry the full record from the list response so each lead takes the
      // --records-json fast path (0 extra CRM calls) rather than a per-record re-lookup.
      entries = leads.map((l) => ({ id: l.recordId, label: l.label, record: l.record || null }))

      if (entries.length === 0) {
        send({ type: 'complete', succeeded: 0, failed: 0, total: 0 })
        return
      }
      send({ type: 'listed', total: entries.length, labels: entries.map((e) => e.label) })
    }

    let succeeded = 0
    let failed = 0
    let duplicate = 0
    const total = entries.length
    const force = !!req.body.force

    for (let i = 0; i < total; i++) {
      if (aborted) break
      const { id, label, record } = entries[i]

      // Confirmed live: widening the daily-fetch gap (or manually re-picking a date
      // already covered before) resends crmRecordIds that were already fully fetched —
      // re-running them burns a real CRM+Gemini call for no new data. A lead already in
      // the DB skips straight to a 'duplicate' event instead, carrying when it was first
      // fetched and whether its proposal email already went out, so the UI can show that
      // instead of quietly redoing the work. `force: true` in the request body bypasses
      // this for the rare case a fresh version is actually wanted.
      if (!force) {
        const existing = await getLeadByCrmRecordId(id).catch(() => null)
        if (existing) {
          duplicate++
          // Backfills the "which date does this lead belong to" association even on a
          // pure skip — no CRM/Gemini call happens either way, this is just one cheap
          // column update so the lead shows up when browsing leads for THIS date too, not
          // only whichever date first fetched it. See getLeadsByDate for why this matters.
          if (date) markLeadCrmDate(existing.leadId, date).catch((err) => console.warn('⚠️  markLeadCrmDate failed (non-critical):', err.message))
          console.log(`  ⏭️  ${label}: already fetched ${new Date(existing.fetchedAt).toLocaleDateString()} (lead ${existing.leadId}), skipping — email ${existing.emailSentAt ? 'already sent' : 'not sent yet'}`)
          send({
            type: 'duplicate',
            index: i,
            total,
            label,
            leadId: existing.leadId,
            fetchedAt: existing.fetchedAt,
            emailSent: !!existing.emailSentAt,
            emailSentAt: existing.emailSentAt
          })
          continue
        }
      }

      send({ type: 'processing', index: i, total, label })

      const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'luminus-migrate-'))
      await acquireFetchSlot()
      try {
        // Fast path: this lead's full record was already fetched (e.g. by the By-Date
        // list step) and handed through — skip the redundant CRM re-lookup entirely.
        let migrateArgs = ['migrate.py', id, '--out-dir', outDir, '--source', src]
        if (record) {
          const recordJsonPath = path.join(outDir, 'record.json')
          await fs.writeFile(recordJsonPath, JSON.stringify([record]))
          migrateArgs = ['migrate.py', '--records-json', recordJsonPath, '--out-dir', outDir, '--source', src]
        }
        const { promise, child } = spawnMigrate(
          migrateArgs,
          { cwd: scriptDir, env, maxBuffer: 20 * 1024 * 1024, timeout: 150 * 1000 }
        )
        currentChild = child
        const { stdout } = await promise
        currentChild = null
        // migrate.py's own diagnostic prints (spec extraction results, image match distances,
        // any fallback reasons) — surfaced here so a warning on a client is actually explainable
        // from the server console, not just visible as an opaque icon in the UI.
        console.log(stdout.trim().split('\n').map((l) => `    ${l}`).join('\n'))

        const file = (await fs.readdir(outDir)).find((f) => f.endsWith('.luminus.json'))
        if (!file) throw new Error('produced no output JSON')
        const data = JSON.parse(await fs.readFile(path.join(outDir, file), 'utf-8'))
        // migrate.py has no concept of the alias (Brown/Black/Blue/White/Orange) — that
        // mapping lives only in this process's env vars, so it's stamped on here rather
        // than threaded through the Python side. Lets the review queue and Saved Leads
        // list group/label by company without a second lookup.
        if (data._source) data._source.crmSourceAlias = crmSourceAlias || `Source ${src}`

        // Auto-save so this fetch never has to be repeated — recalling or editing this
        // client later comes from the DB, not another CRM/Gemini round trip. Images go to
        // the VM archive first; only the stripped (images-out) copy reaches Supabase.
        let saved = null
        try {
          const { stripped, archivePath, imagePaths, pdfPath } = await archiveAndStripImages(data, label, batchId)
          saved = await saveLeadVersion({
            crmRecordId: data._source?.crmRecordId || null,
            clientName: data.clientName,
            contactEmail: data.contactEmail,
            data: stripped,
            label: 'Imported from CRM',
            source: dailyAuto ? 'daily-auto-fetch' : 'migration',
            batchId,
            crmSourceAlias,
            archivePath,
            crmLeadDate: date || null
          })
          console.log(`  💾 auto-saved lead ${saved.leadId} v${saved.version}`)
          notifyGoogleSync(data, date, batchId)
          uploadToDriveViaRclone(data.clientName, imagePaths, pdfPath)
        } catch (saveErr) {
          console.warn(`  ⚠️  auto-save failed for ${label}: ${saveErr.message}`)
        }

        succeeded++
        send({ type: 'done', index: i, total, label: data.clientName || label, payload: data, saved })
      } catch (err) {
        currentChild = null
        failed++
        const reason = err.killed
          ? (aborted ? 'cancelled' : 'timed out after 150s')
          : (err.stderr || err.stdout || err.message || 'unknown error').toString().trim().slice(-300)
        console.warn(`  ⚠️  ${label}: ${reason.split('\n').slice(-1)[0]}`)
        // The short `reason` above (last line only) is all the UI toast needs, but it's
        // rarely enough to actually diagnose a failure. Log everything migrate.py produced
        // on both streams up to the point of failure — this is the only place that trail
        // survives, since a non-zero exit means the success-path stdout log above never runs.
        if (err.stdout && err.stdout.trim()) {
          console.warn(`  --- ${label}: full stdout ---\n${err.stdout.trim().split('\n').map((l) => `    ${l}`).join('\n')}`)
        }
        if (err.stderr && err.stderr.trim()) {
          console.warn(`  --- ${label}: full stderr ---\n${err.stderr.trim().split('\n').map((l) => `    ${l}`).join('\n')}`)
        }
        send({ type: 'failed', index: i, total, label, reason })
      } finally {
        releaseFetchSlot()
        await fs.rm(outDir, { recursive: true, force: true }).catch(() => {})
      }
    }

    console.log(`✅ Migration ${aborted ? 'cancelled' : 'complete'}: ${succeeded} succeeded, ${failed} failed`)
    send({ type: 'complete', succeeded, failed, total: entries.length, cancelled: aborted })
  } catch (error) {
    console.error('❌ Migration fatal error:', (error.message || '').toString().slice(-500))
    send({ type: 'fatal', error: (error.stderr || error.message || 'unknown error').toString().slice(-500) })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

// ============================================
// SAVED LEADS — local persistence (db.js/SQLite) so recalling or editing a
// previously-migrated proposal never needs another CRM/Gemini round trip.
// Author: Burhan.
// ============================================
app.post('/api/leads', async (req, res) => {
  try {
    const { data, label, source } = req.body
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Missing proposal data' })
    }
    const { stripped, archivePath } = await archiveAndStripImages(data, data.clientName, newBatchId())
    const result = await saveLeadVersion({
      crmRecordId: data._source?.crmRecordId || null,
      clientName: data.clientName,
      contactEmail: data.contactEmail,
      data: stripped,
      label,
      source: source || 'manual-edit',
      archivePath
    })
    console.log(`💾 Saved lead ${result.leadId} v${result.version} (${data.clientName || 'unnamed'})`)
    res.status(200).json(result)
  } catch (error) {
    console.error('❌ Save lead error:', error.message)
    res.status(500).json({ error: 'Failed to save lead', details: error.message })
  }
})

// Real Airtable/Gemini call counts, straight from migrate.py's own usage_log.jsonl
// (one line per actual external API call — see log_api_call in migrate.py). Answers
// "how many calls have we actually made" without guessing or digging through logs.
app.get('/api/usage-stats', async (req, res) => {
  const scriptDir = process.env.MIGRATION_SCRIPT_DIR
  if (!scriptDir) return res.status(400).json({ error: 'MIGRATION_SCRIPT_DIR not set' })
  const logPath = path.join(scriptDir, 'usage_log.jsonl')

  const now = Date.now() / 1000
  const dayAgo = now - 24 * 3600
  const weekAgo = now - 7 * 24 * 3600
  const stats = {
    today: { airtable: 0, gemini: 0 },
    week: { airtable: 0, gemini: 0 },
    allTime: { airtable: 0, gemini: 0 }
  }

  try {
    const raw = await fs.readFile(logPath, 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let entry
      try { entry = JSON.parse(line) } catch { continue }
      const kind = entry.kind === 'gemini' ? 'gemini' : 'airtable'
      stats.allTime[kind]++
      if (entry.ts >= weekAgo) stats.week[kind]++
      if (entry.ts >= dayAgo) stats.today[kind]++
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      return res.status(500).json({ error: 'Failed to read usage log', details: err.message })
    }
    // No log file yet (no calls made since this feature was added) — zeros are correct.
  }

  res.status(200).json(stats)
})

// Every individual call, not just aggregate counts — same usage_log.jsonl, most recent
// first, capped so the Dashboard never has to load an unbounded log.
app.get('/api/usage-log', async (req, res) => {
  const scriptDir = process.env.MIGRATION_SCRIPT_DIR
  if (!scriptDir) return res.status(400).json({ error: 'MIGRATION_SCRIPT_DIR not set' })
  const limit = Math.min(parseInt(req.query.limit, 10) || 300, 2000)
  const logPath = path.join(scriptDir, 'usage_log.jsonl')
  try {
    const raw = await fs.readFile(logPath, 'utf-8')
    const entries = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { entries.push(JSON.parse(line)) } catch { /* skip malformed line */ }
    }
    entries.reverse()
    res.status(200).json({ calls: entries.slice(0, limit), total: entries.length })
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(200).json({ calls: [], total: 0 })
    res.status(500).json({ error: 'Failed to read usage log', details: err.message })
  }
})

// Daily automated fetch schedule — read/write the config scripts/scheduler-check.js polls
// every 5 minutes. Changing it here takes effect on the next poll, no cron/crontab edit or
// restart needed.
const SCHEDULE_CONFIG_PATH = path.join(__dirname, 'schedule-config.json')
async function loadScheduleConfig() {
  try {
    return JSON.parse(await fs.readFile(SCHEDULE_CONFIG_PATH, 'utf-8'))
  } catch {
    return { enabled: true, hour: 5, minute: 0, lastRunDate: null }
  }
}

app.get('/api/schedule-config', async (req, res) => {
  try {
    res.status(200).json(await loadScheduleConfig())
  } catch (error) {
    res.status(500).json({ error: 'Failed to read schedule config', details: error.message })
  }
})

app.post('/api/schedule-config', async (req, res) => {
  try {
    const { enabled, hour, minute } = req.body
    if (hour !== undefined && (hour < 0 || hour > 23)) return res.status(400).json({ error: 'hour must be 0-23' })
    if (minute !== undefined && (minute < 0 || minute > 59)) return res.status(400).json({ error: 'minute must be 0-59' })
    const current = await loadScheduleConfig()
    const updated = {
      ...current,
      ...(enabled !== undefined && { enabled: !!enabled }),
      ...(hour !== undefined && { hour: parseInt(hour, 10) }),
      ...(minute !== undefined && { minute: parseInt(minute, 10) })
    }
    await fs.writeFile(SCHEDULE_CONFIG_PATH, JSON.stringify(updated, null, 2))
    console.log(`⏰ Schedule config updated: enabled=${updated.enabled}, ${String(updated.hour).padStart(2, '0')}:${String(updated.minute).padStart(2, '0')} ET`)
    res.status(200).json(updated)
  } catch (error) {
    res.status(500).json({ error: 'Failed to update schedule config', details: error.message })
  }
})

// GET /api/leads              -> list all leads
// GET /api/leads?id=X&action=versions             -> version history for lead X
// GET /api/leads?id=X&action=version&version=Y    -> one version (Y can be "latest")
// Query-param routing (not /:id/:version path segments) so this matches api/leads.js's
// Vercel-function shape exactly — same URLs work identically local vs. deployed.
app.get('/api/leads', async (req, res) => {
  try {
    const { id, action, version } = req.query
    if (!id) {
      return res.status(200).json({ leads: await listLeads() })
    }
    if (action === 'versions') {
      return res.status(200).json({ versions: await listVersions(Number(id)) })
    }
    if (action === 'version') {
      const result = await getVersion(Number(id), version)
      if (!result) return res.status(404).json({ error: 'Version not found' })
      // Images were stripped out before this was saved to Supabase (see
      // archiveAndStripImages) — reunite them from the VM archive before returning.
      const data = await rehydrateFromArchive(result.data, result.archivePath)
      return res.status(200).json({ version: result.version, data })
    }
    res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    res.status(500).json({ error: 'Failed to read leads', details: error.message })
  }
})

// One clean "here's what's about to run" email at the very start of a daily-fetch run —
// replaces what used to be a separate notifyFetchStarted ping PER CHUNK (11 near-identical
// emails for one 164-lead source, no total-progress context). Sequential by design: each
// source in perSource fully completes before the next one starts, listed in that order.
app.post('/api/internal/daily-fetch-started-email', async (req, res) => {
  try {
    const { date, perSource, total } = req.body
    const smtpUser = process.env.SMTP_USER
    const smtpPass = process.env.SMTP_PASS
    const settings = await loadAdminSettings()
    const fromName = settings.smtpFromName || process.env.SMTP_FROM_NAME || 'Signage Crafting'
    if (!smtpUser || !smtpPass) {
      return res.status(500).json({ error: 'SMTP credentials not configured' })
    }
    const breakdown = (perSource || []).map((s) => `${s.alias}: ${s.count} lead(s)`).join('<br>')
    const order = (perSource || []).map((s) => s.alias).join(' → ')
    const transporter = createSMTPTransporter()
    await transporter.sendMail({
      from: `"${fromName}" <${smtpUser}>`,
      to: settings.notifyEmail || FETCH_NOTIFY_EMAIL,
      subject: `Daily fetch started — ${date} — ${total} lead(s) found`,
      html: `
        <p>The daily automated fetch for <strong>${date}</strong> just started.</p>
        <p><strong>${total}</strong> lead(s) found, by company:</p>
        <p>${breakdown || '(none)'}</p>
        <p style="color:#888;font-size:12px;">Processed one company at a time, in this order: ${order || '(none)'}. A completion email follows once every company is done.</p>
      `
    })
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('❌ Daily fetch-started email error:', error.message)
    res.status(500).json({ error: 'Failed to send fetch-started email', details: error.message })
  }
})

// Called by scripts/daily-fetch.js (localhost-only, no browser involved) once the daily
// automated fetch finishes — reuses the same SMTP transporter/credentials as
// /api/send-email rather than duplicating them into a second standalone script.
app.post('/api/internal/daily-summary-email', async (req, res) => {
  try {
    const { date, total, perSource, incomplete, killed } = req.body
    const smtpUser = process.env.SMTP_USER
    const smtpPass = process.env.SMTP_PASS
    const settings = await loadAdminSettings()
    const fromName = settings.smtpFromName || process.env.SMTP_FROM_NAME || 'Signage Crafting'
    if (!smtpUser || !smtpPass) {
      return res.status(500).json({ error: 'SMTP credentials not configured' })
    }
    const breakdown = (perSource || [])
      .map((s) => {
        const dupNote = s.duplicate ? ` (+${s.duplicate} already fetched, skipped)` : ''
        return s.error ? `${s.alias}: FAILED — ${s.error}${dupNote}` : `${s.alias}: ${s.count}${dupNote}`
      })
      .join('<br>')
    // Surfaced only when something actually went wrong — confirmed live: a run that got
    // killed partway through used to fail completely silently (no email at all, since the
    // summary only ever sent on a clean finish), so the count you saw in the Dashboard
    // (only whatever source(s) finished before the kill) never matched what you'd expect,
    // with nothing anywhere telling you the run didn't actually complete.
    const warningBanner = killed
      ? `<p style="color:#b91c1c;font-weight:bold;">⚠️ This run was interrupted before finishing — some sources may not have been attempted at all. The count below only reflects what completed before the interruption.</p>`
      : incomplete
      ? `<p style="color:#b45309;font-weight:bold;">⚠️ One or more sources failed during this run (see FAILED lines below) — everything else still completed normally.</p>`
      : ''
    // A single date can span more than one run (this run plus an earlier one for the same
    // date, e.g. a same-day recovery re-fetch) — reporting only THIS run's count is exactly
    // what caused confusion adding up several emails by hand to guess the real total. The
    // grand total here is queried fresh from the DB, not carried from the request body, so
    // it's always the true cumulative figure regardless of how many runs it took.
    let grandTotal = total
    try {
      const allForDate = await getLeadsByDate(date)
      grandTotal = allForDate.length
    } catch (e) {
      console.warn('⚠️ Could not compute grand total for', date, '— falling back to this run\'s count:', e.message)
    }
    const totalLine = grandTotal !== total
      ? `<p><strong>${total}</strong> lead(s) saved in this run — <strong>${grandTotal}</strong> lead(s) total now saved for ${date} (across all runs).</p>`
      : `<p><strong>${total}</strong> lead(s) found and saved.</p>`
    const transporter = createSMTPTransporter()
    await transporter.sendMail({
      from: `"${fromName}" <${smtpUser}>`,
      to: settings.notifyEmail || FETCH_NOTIFY_EMAIL,
      subject: `${incomplete || killed ? '⚠️ ' : ''}Daily Lead Fetch — ${date}: ${grandTotal} lead(s) total ready for review`,
      html: `
        <p>The daily automated fetch for <strong>${date}</strong> just finished.</p>
        ${warningBanner}
        ${totalLine}
        <p>${breakdown || '(none)'}</p>
        <p>Log in to the proposal system's Dashboard to review and send.</p>
      `
    })
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('❌ Daily summary email error:', error.message)
    res.status(500).json({ error: 'Failed to send summary email', details: error.message })
  }
})

// GET /api/leads/batches                       -> list past fetch runs (Dashboard's Batch History)
// GET /api/leads/batches/:batchId/queue-preview -> lightweight, no images — client name/specs/
//                                                   pricing + leadId+version per lead, for
//                                                   populating the review queue. A real automated
//                                                   batch can be 50+ leads with full embedded
//                                                   images each (~2-4MB); rehydrating all of them
//                                                   into one response for a queue LIST is exactly
//                                                   what doesn't need images yet — the queue only
//                                                   needs to show who's in it. Full images load
//                                                   per-lead, on demand, when one is actually opened
//                                                   (see /api/leads?action=version, already built).
// GET /api/leads/batches/:batchId/export        -> full JSON array, images rehydrated, streamed
//                                                   rather than buffered — a 200+MB batch used to
//                                                   be built as one in-memory string via
//                                                   Promise.all + res.json(), which could exceed
//                                                   the process's memory cap and crash mid-response
//                                                   (the exact cause of a "Load into Queue" attempt
//                                                   coming back as a truncated, unparseable JSON
//                                                   error). Streaming one lead at a time keeps peak
//                                                   memory to roughly one lead's size regardless of
//                                                   batch size.
app.get('/api/leads/batches', async (req, res) => {
  try {
    res.status(200).json({ batches: await listBatches() })
  } catch (error) {
    res.status(500).json({ error: 'Failed to list batches', details: error.message })
  }
})

app.get('/api/leads/batches/:batchId/queue-preview', async (req, res) => {
  try {
    const rows = await getBatchLeads(req.params.batchId)
    if (rows.length === 0) return res.status(404).json({ error: 'Batch not found' })
    const leads = rows.map((r) => {
      // Older saved leads (before crmSourceAlias started getting stamped onto _source
      // itself) only have it as this row's own DB column — set it here too so the queue
      // can group/label by company regardless of when the lead was originally fetched.
      if (r.data?._source) r.data._source.crmSourceAlias = r.crm_source_alias || r.data._source.crmSourceAlias || null
      return { leadId: r.lead_id, version: r.version_number, data: r.data, createdAt: r.created_at, emailSentAt: r.email_sent_at, emailSentBy: r.email_sent_by }
    })
    res.status(200).json({ leads })
  } catch (error) {
    res.status(500).json({ error: 'Failed to load batch preview', details: error.message })
  }
})

// One target date can span multiple batch runs (the original automated fetch plus any
// later manual/recovery re-run) — this merges every one of them into a single queue-ready
// list so a reviewer never has to know or care how many separate runs it took to actually
// get that date's leads in. Same lightweight shape as the single-batch preview above (no
// images — see that endpoint's comment for why).
app.get('/api/leads/by-date/:date/queue-preview', async (req, res) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
      return res.status(400).json({ error: 'Date must be YYYY-MM-DD.' })
    }
    const rows = await getLeadsByDate(req.params.date)
    if (rows.length === 0) return res.status(404).json({ error: 'No leads found for this date' })
    const leads = rows.map((r) => {
      if (r.data?._source) r.data._source.crmSourceAlias = r.crm_source_alias || r.data._source.crmSourceAlias || null
      return { leadId: r.lead_id, version: r.version_number, data: r.data, createdAt: r.created_at, emailSentAt: r.email_sent_at, emailSentBy: r.email_sent_by }
    })
    res.status(200).json({ leads })
  } catch (error) {
    res.status(500).json({ error: 'Failed to load leads for date', details: error.message })
  }
})

app.get('/api/leads/batches/:batchId/export', async (req, res) => {
  try {
    const rows = await getBatchLeads(req.params.batchId)
    if (rows.length === 0) return res.status(404).json({ error: 'Batch not found' })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{"leads":[')
    for (let i = 0; i < rows.length; i++) {
      const full = await rehydrateFromArchive(rows[i].data, rows[i].archive_path)
      if (i > 0) res.write(',')
      res.write(JSON.stringify(full))
    }
    res.write(']}')
    res.end()
  } catch (error) {
    // Headers may already be sent if this fails partway through streaming — best effort only.
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export batch', details: error.message })
    } else {
      res.end()
    }
  }
})

app.delete('/api/leads', async (req, res) => {
  try {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'Missing id' })
    const ok = await deleteLead(Number(id))
    if (!ok) return res.status(404).json({ error: 'Lead not found' })
    res.status(200).json({ deleted: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete lead', details: error.message })
  }
})

// The one manual override for the follow-up drip sequence (see admin-settings.json's
// followUp* fields) — an employee who hears back from a client, or watches them convert,
// stops that client's remaining reminders immediately regardless of how many are left.
app.post('/api/leads/:id/stop-follow-ups', async (req, res) => {
  try {
    await stopFollowUps(Number(req.params.id))
    res.status(200).json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop follow-ups', details: error.message })
  }
})

app.post('/api/leads/:id/resume-follow-ups', async (req, res) => {
  try {
    await resumeFollowUps(Number(req.params.id))
    res.status(200).json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to resume follow-ups', details: error.message })
  }
})

// Read-only list scripts/send-followups.js pulls once per run — every lead eligible in
// principle (proposal actually sent, not manually stopped). The script itself does the
// day-math against live admin-settings values to work out whose turn it actually is today.
app.get('/api/internal/follow-up-candidates', async (req, res) => {
  try {
    const candidates = await getFollowUpCandidates()
    res.status(200).json({ candidates })
  } catch (error) {
    res.status(500).json({ error: 'Failed to load follow-up candidates', details: error.message })
  }
})

// Called once per due client by scripts/send-followups.js (localhost-only) — the script
// does the day-math (whose turn it is today), this endpoint does the actual send, reusing
// the exact same SMTP path and CC rule as the original proposal email rather than a
// separate, divergent code path.
app.post('/api/internal/send-followup-email', async (req, res) => {
  try {
    const { leadId, clientName, clientEmail, followUpNumber, daysSinceOriginal } = req.body
    if (!leadId || !clientEmail) return res.status(400).json({ error: 'leadId and clientEmail are required' })
    const smtpUser = process.env.SMTP_USER
    const smtpPass = process.env.SMTP_PASS
    if (!smtpUser || !smtpPass) return res.status(500).json({ error: 'SMTP credentials not configured' })
    const settings = await loadAdminSettings()
    const fromName = settings.smtpFromName || process.env.SMTP_FROM_NAME || 'Signage Crafting'
    const transporter = createSMTPTransporter()
    await transporter.sendMail({
      from: `"${fromName}" <${smtpUser}>`,
      to: clientEmail,
      ...(settings.clientCcEnabled && settings.clientCcEmail ? { cc: settings.clientCcEmail } : {}),
      subject: `Following up on your custom signage proposal, ${clientName || 'there'}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 24px 30px;">
            <h1 style="color: #38bdf8; font-size: 22px; font-weight: 800; margin: 0;">Signage Crafting</h1>
          </div>
          <div style="padding: 30px; font-size: 15px; line-height: 1.65; color: #334155;">
            <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin-top: 0;">Hi ${clientName || 'there'},</p>
            <p>Just following up on the custom signage proposal we sent over — wanted to make sure it reached you and see if you had any questions.</p>
            <p>Happy to walk through pricing, sizing, or timelines whenever works for you — just reply to this email.</p>
            <p style="margin-top: 24px;">Best,<br/>Signage Crafting</p>
          </div>
        </div>
      `
    })
    console.log(`✅ Follow-up #${followUpNumber} sent to ${clientEmail}`)
    // The email has already gone out at this point — a failure here must never be
    // reported back as "the send failed" (it didn't), but it DOES need to be loud: if
    // follow_up_count/last_sent_at don't get updated, tomorrow's run sees this lead as
    // still due on the same anchor date and would email the same client again.
    try {
      await recordFollowUpSent(leadId)
    } catch (recordErr) {
      console.error(`❌ Follow-up SENT but DB update failed for lead ${leadId} — will likely re-send tomorrow unless fixed manually:`, recordErr.message)
    }
    notifyFollowUpSent({ clientName, clientEmail, followUpNumber, daysSinceOriginal })
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('❌ Follow-up email error:', error.message)
    res.status(500).json({ error: 'Failed to send follow-up email', details: error.message })
  }
})

// ----------------------------------------------------------------
// OCR readiness check at startup
// ----------------------------------------------------------------
const checkOcrReady = () => {
  const pythonScript = `
import sys, shutil, os
from pathlib import Path

try:
    import pytesseract
    env_cmd = os.environ.get("TESSERACT_CMD")
    if env_cmd and Path(env_cmd).exists():
        pytesseract.pytesseract.tesseract_cmd = env_cmd
    elif not shutil.which("tesseract"):
        candidates = [
            Path(r"C:\\Program Files\\Tesseract-OCR\\tesseract.exe"),
            Path(r"C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe"),
            Path.home() / r"AppData\\Local\\Programs\\Tesseract-OCR\\tesseract.exe",
        ]
        for c in candidates:
            if c.exists():
                pytesseract.pytesseract.tesseract_cmd = str(c)
                break

    ver = pytesseract.get_tesseract_version()
    print(f"TESSERACT:{ver}")
except Exception:
    if os.environ.get("VITE_GEMINI_API_KEY"):
        print("GEMINI_ACTIVE")
    else:
        sys.exit(1)
`
  // 'python' doesn't exist on this machine (and on many others — macOS ships python3
  // only, with no `python` symlink). Without an 'error' listener, a missing binary
  // here throws an unhandled 'error' event on the ChildProcess and crashes the entire
  // server, not just this optional startup readiness check.
  const proc = spawn('python3', ['-c', pythonScript], { env: process.env })
  proc.on('error', () => {
    if (process.env.VITE_REPLICATE_API_TOKEN) {
      console.log('✅ OCR Engine     - Florence-2 + Replicate LLaMA-3 Active (Cloud Extraction)')
    } else if (process.env.VITE_GEMINI_API_KEY) {
      console.log('✅ OCR Engine     - Gemini Vision AI Active (Cloud Extraction)')
    } else {
      console.log('💡 OCR Engine     - Manual Entry Mode')
    }
  })

  let out = ''
  let err = ''
  proc.stdout.on('data', d => { out += d.toString() })
  proc.stderr.on('data', d => { err += d.toString() })
  proc.on('close', (code) => {
    if (out.includes('TESSERACT:')) {
      const ver = out.split('TESSERACT:')[1].trim()
      console.log(`✅ Tesseract OCR - Ready (${ver})`)
    } else if (process.env.VITE_REPLICATE_API_TOKEN) {
      console.log('✅ OCR Engine     - Florence-2 + Replicate LLaMA-3 Active (Cloud Extraction)')
    } else if (out.includes('GEMINI_ACTIVE') || process.env.VITE_GEMINI_API_KEY) {
      console.log('✅ OCR Engine     - Gemini Vision AI Active (Cloud Extraction)')
    } else {
      console.log('💡 OCR Engine     - Manual Entry Mode')
    }
  })
}

// Production only: serve the built SPA from this same process/port so a single
// Caddy upstream covers both the API and the frontend. In dev, Vite serves the
// frontend on its own port instead (see vite.config.js).
if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, 'dist')
  app.use(express.static(distDir))
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

const server = app.listen(PORT, () => {
  console.log('')
  console.log('╔════════════════════════════════════════╗')
  console.log('║   LUMINUS MULTI-AI SERVER READY!       ║')
  console.log('╚════════════════════════════════════════╝')
  console.log('')
  console.log(`🌐 Server: http://localhost:${PORT}`)
  console.log('')
  console.log('✅ Replicate - Ready')
  console.log('✅ Gemini - Ready (Nano Banana image-to-image + rotation)')
  console.log('✅ Imagine.art - Ready')
  console.log('✅ Hugging Face - Ready')
  console.log('✅ Batch Upload   - POST /api/batch/upload')
  console.log('✅ Batch Status   - GET  /api/batch/status/:batchId')
  console.log('✅ Client Detail  - GET  /api/batch/client/:clientId')
  console.log('')
  console.log('💡 Frontend: http://localhost:3000')
  console.log('   Run: npm run dev')
  console.log('')
  checkOcrReady()
})


server.setTimeout(600000);

// CRM: pull anything sent straight from webmail (bypassing the CRM) into the
// conversation as outbound. n8n only watches INBOX; this covers the Sent folder.
// Every 3 min, ~1 IMAP round-trip, deduped by Message-ID — no Airtable, no Gemini.
const CRM_SENT_POLL_MS = 3 * 60 * 1000
setTimeout(() => {
  crmPollSentFolder({ days: 3 }).catch((e) => console.warn('⚠️  CRM sent-poll (startup) failed:', e.message))
  setInterval(() => {
    crmPollSentFolder({ days: 3 }).catch((e) => console.warn('⚠️  CRM sent-poll failed:', e.message))
  }, CRM_SENT_POLL_MS)
}, 30 * 1000)

// CRM client announcements: background sender (30 emails per rolling hour). Off unless
// CRM_BROADCAST_WORKER=true is set in THIS server's .env — see crm-broadcast.js.
startBroadcastWorker({ loadAdminSettings })

