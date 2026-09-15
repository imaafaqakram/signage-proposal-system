// Runs headless via cron (5:00 AM America/New_York, DST-aware — see crontab's CRON_TZ)
// and pulls the CRM leads from FETCH_GAP_DAYS days ago (8, by design — deliberately
// wider than "yesterday" to guarantee those leads have had time to fully settle in the
// CRM before being pulled) across every configured CRM source, so they're already
// fetched and sitting in the review queue when an employee logs in. Talks to the
// already-running server over localhost — reuses every existing code path
// (fetch-all-sources lookup, per-lead migrate, archive+strip, save) rather than
// duplicating any of it here.
import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncAirtableProjects } from '../crm-airtable-projects.js'

const PORT = process.env.PORT || 3001
const BASE_URL = `http://localhost:${PORT}`
// Anchored to this SCRIPT's own location, not process.cwd() — confirmed live as a real
// bug: scheduler-check.js spawns this with cwd set to the scripts/ folder itself (its own
// __dirname), so process.cwd() pointed at scripts/ instead of the app root for every
// automated run. admin-settings.json silently failed to be found there, meaning every
// automated run silently fell back to hardcoded defaults instead of whatever was actually
// configured in Admin Settings — and daily-fetch-status.json got written to scripts/
// instead of the app root, where the Admin health panel actually looks for it, making it
// look permanently stale. Manual runs (started with `cd /opt/luminus-app && node ...`)
// never showed this, which is exactly why it went unnoticed.
const APP_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN_SETTINGS_PATH = path.join(APP_ROOT, 'admin-settings.json')
const STATUS_PATH = path.join(APP_ROOT, 'daily-fetch-status.json')

// This script runs standalone via cron (no HTTP call into the server, so it can't reuse
// loadAdminSettings() from server.js) — reads the same admin-settings.json file directly.
// Falls back to env vars / hardcoded defaults if the file doesn't exist yet or a field is
// missing, so a fresh box with no admin panel configured yet still runs with sane values.
async function loadDailyFetchSettings() {
  try {
    const raw = JSON.parse(await fs.readFile(ADMIN_SETTINGS_PATH, 'utf-8'))
    return {
      gapDays: raw.dailyFetchGapDays ?? parseInt(process.env.DAILY_FETCH_GAP_DAYS || '8', 10),
      chunkSize: raw.dailyFetchChunkSize ?? parseInt(process.env.DAILY_FETCH_CHUNK_SIZE || '15', 10),
      maxPerSource: raw.dailyFetchMaxPerSource ?? parseInt(process.env.DAILY_FETCH_MAX_PER_SOURCE || '0', 10)
    }
  } catch {
    return {
      gapDays: parseInt(process.env.DAILY_FETCH_GAP_DAYS || '8', 10),
      chunkSize: parseInt(process.env.DAILY_FETCH_CHUNK_SIZE || '15', 10),
      maxPerSource: parseInt(process.env.DAILY_FETCH_MAX_PER_SOURCE || '0', 10)
    }
  }
}

async function writeStatus(status) {
  try {
    await fs.writeFile(STATUS_PATH, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2))
  } catch {
    // best-effort only — the Admin health panel just won't show a fresh snapshot
  }
}

// Optional safety valve: caps how many leads per source this run will actually fetch
// (each one is a real Gemini call) — unset/0 means no cap.
let MAX_PER_SOURCE
let FETCH_GAP_DAYS
// Confirmed live: a single source with an unusually large day's haul (70 leads at once,
// after a prior run had already failed and left a backlog) sent ALL of them in one HTTP
// request that never came back — every batch before this that succeeded was ~15-20 leads
// per source. Chunking bounds how long any single request can possibly run, and — just as
// important — means one bad chunk only costs THAT chunk, not the other 50+ leads sitting
// right behind it in the same source.
let CHUNK_SIZE

function targetDateStringInNY() {
  const todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const [y, m, d] = todayNY.split('-').map(Number)
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12)) // noon UTC — nowhere near any DST boundary
  utcNoon.setUTCDate(utcNoon.getUTCDate() - FETCH_GAP_DAYS)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(utcNoon)
}

async function fetchAllSourcesList(date) {
  const res = await fetch(`${BASE_URL}/api/crm-leads-for-date-all?date=${date}`)
  const result = await res.json()
  if (!res.ok) throw new Error(result.details || result.error || 'List lookup failed')
  // Confirmed live: a source whose LISTING call itself fails (e.g. a large source's
  // output exceeding the child process's stdout buffer) used to vanish with zero trace —
  // server.js captures the error per source, but this function used to only read
  // `.leads`, throwing that error away. That source then never even appears in bySource
  // below, so it gets no chunk, no failure count, nothing — it just silently isn't there,
  // and the summary email reports a clean run. perSource is returned now specifically so
  // main() can catch this and say so.
  return { leads: result.leads, perSource: result.perSource || [] }
}

// /api/migrate-lead streams NDJSON for live progress in the browser — this script has no
// UI to update, so it just waits for the whole response and parses it after the fact.
async function runMigrateBatch({ recordIds, sourceId, batchId, date }) {
  const res = await fetch(`${BASE_URL}/api/migrate-lead`, {
    // date is what lets the server associate an "already fetched" duplicate-skip with
    // THIS date too, not just whichever date first fetched it — without it, a lead
    // rediscovered here would correctly avoid a wasted CRM/Gemini call but stay invisible
    // when browsing leads for this date, even though it genuinely belongs to it.
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: recordIds, source: sourceId, date, useCache: true, batchId, dailyAuto: true })
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`migrate-lead HTTP ${res.status}: ${text.slice(0, 300)}`)
  let succeeded = 0
  let failed = 0
  let duplicate = 0
  for (const line of text.trim().split('\n')) {
    if (!line.trim()) continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event.type === 'done') succeeded++
    else if (event.type === 'failed') failed++
    // A widened gap re-covering an already-fetched date shouldn't burn a real CRM+Gemini
    // call per lead — server.js catches this and skips straight to 'duplicate' instead of
    // 'done'/'failed'. Counted separately here so the summary email says what actually
    // happened instead of the totals quietly not adding up to what daily-fetch found.
    else if (event.type === 'duplicate') duplicate++
  }
  return { succeeded, failed, duplicate }
}

// One email, sent once, before any chunk runs — replaces the old per-chunk
// notifyFetchStarted pings (see server.js) that used to fire up to a dozen times for a
// single large source with zero indication of total progress.
async function sendStartedEmail({ date, total, perSource }) {
  const res = await fetch(`${BASE_URL}/api/internal/daily-fetch-started-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, total, perSource })
  })
  if (!res.ok) {
    const result = await res.json().catch(() => ({}))
    console.warn('⚠️ Fetch-started email failed (non-critical):', result.details || result.error)
  }
}

async function sendSummaryEmail({ date, total, perSource, incomplete, killed }) {
  const res = await fetch(`${BASE_URL}/api/internal/daily-summary-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, total, perSource, incomplete, killed })
  })
  if (!res.ok) {
    const result = await res.json().catch(() => ({}))
    throw new Error(result.details || result.error || 'Summary email failed')
  }
}

let currentDate = null // set at the top of main(); read by the SIGTERM handler below

async function main() {
  const settings = await loadDailyFetchSettings()
  MAX_PER_SOURCE = settings.maxPerSource
  FETCH_GAP_DAYS = settings.gapDays
  CHUNK_SIZE = settings.chunkSize

  const date = targetDateStringInNY()
  currentDate = date
  const batchId = `daily-${date}-${Date.now()}`
  console.log(`🌅 Daily fetch starting for ${date} (batch ${batchId})`)

  const { leads, perSource: listErrors } = await fetchAllSourcesList(date)
  console.log(`   Found ${leads.length} lead(s) across all sources`)

  const bySource = new Map() // sourceId -> { alias, recordIds: [] }
  for (const l of leads) {
    if (!bySource.has(l.sourceId)) bySource.set(l.sourceId, { alias: l.sourceLabel, recordIds: [] })
    bySource.get(l.sourceId).recordIds.push(l.recordId)
  }

  await sendStartedEmail({
    date,
    total: leads.length,
    perSource: [...bySource.values()].map((s) => ({ alias: s.alias, count: s.recordIds.length }))
  })

  let total = 0
  const perSource = []
  // A source whose LISTING itself failed never gets a bySource entry at all — surface it
  // here up front, before the fetch loop, so it can never again disappear without a trace.
  for (const s of listErrors) {
    if (s.error) {
      console.error(`   ❌ ${s.label}: could not list leads for ${date} — ${s.error}`)
      perSource.push({ alias: s.label, count: 0, duplicate: 0, error: `listing failed — ${s.error}` })
    }
  }
  // Each CHUNK runs in its own try/catch — confirmed live: a run that died partway
  // through (a transient kill unrelated to this script) took the whole day's fetch down
  // with it, so Black/Blue/White never even got attempted that day while Brown's leads
  // (already saved before the failure) silently looked like the whole picture. A failure
  // must never stop everything else — not the other sources, and now not even the rest
  // of the SAME source's remaining chunks — and the summary email must say so instead of
  // just going quiet.
  for (const [sourceId, { alias, recordIds }] of bySource) {
    const ids = MAX_PER_SOURCE > 0 ? recordIds.slice(0, MAX_PER_SOURCE) : recordIds
    if (MAX_PER_SOURCE > 0 && recordIds.length > MAX_PER_SOURCE) {
      console.log(`   ${alias}: capped at ${MAX_PER_SOURCE} of ${recordIds.length} found`)
    }
    if (ids.length === 0) continue

    let sourceSucceeded = 0
    let sourceFailed = 0
    let sourceDuplicate = 0
    let sourceError = null
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE)
      try {
        const { succeeded, failed, duplicate } = await runMigrateBatch({ recordIds: chunk, sourceId, batchId, date })
        sourceSucceeded += succeeded
        sourceFailed += failed
        sourceDuplicate += duplicate
      } catch (err) {
        console.error(`   ❌ ${alias} (leads ${i + 1}-${i + chunk.length} of ${ids.length}): chunk errored, skipping to next chunk — ${err.message}`)
        sourceFailed += chunk.length
        sourceError = err.message // last error wins — enough to point at the pattern, not every chunk's exact message
      }
    }
    console.log(`   ${alias}: ${sourceSucceeded} succeeded, ${sourceFailed} failed, ${sourceDuplicate} already fetched${sourceError ? ` (at least one chunk errored: ${sourceError})` : ''}`)
    total += sourceSucceeded
    perSource.push(sourceError
      ? { alias, count: sourceSucceeded, duplicate: sourceDuplicate, error: sourceError }
      : { alias, count: sourceSucceeded, duplicate: sourceDuplicate })
  }

  const anyErrors = perSource.some((s) => s.error)
  await sendSummaryEmail({ date, total, perSource, incomplete: anyErrors })
  await writeStatus({ date, total, perSource, incomplete: anyErrors, killed: false, ok: true })
  console.log(`✅ Daily fetch complete: ${total} lead(s) saved${anyErrors ? ' (with source errors — see email)' : ''}, summary email sent`)

  // Airtable "Projects" mirror — a separate, read-only CRM section (crm_airtable_projects).
  // Best-effort and fully decoupled from the lead fetch above: its own try/catch, its own
  // status row, and it never affects the lead-fetch result or exit code. Window default 45
  // days by record-creation time; override with admin-settings crmProjectsSyncDays, or set
  // crmProjectsSyncEnabled:false to skip.
  try {
    let syncDays = 45
    let syncEnabled = true
    try {
      const raw = JSON.parse(await fs.readFile(ADMIN_SETTINGS_PATH, 'utf-8'))
      if (Number.isFinite(raw.crmProjectsSyncDays)) syncDays = raw.crmProjectsSyncDays
      if (raw.crmProjectsSyncEnabled === false) syncEnabled = false
    } catch { /* defaults */ }

    if (syncEnabled) {
      console.log(`🔄 Airtable Projects mirror — syncing last ${syncDays} days…`)
      const r = await syncAirtableProjects({ days: syncDays, triggeredBy: 'daily' })
      console.log(`   Projects mirror: ${r.scanned} record(s) across ${Object.keys(r.perBase || {}).length} base(s)`)
    } else {
      console.log('⏸️  Airtable Projects mirror disabled in Admin Settings — skipped')
    }
  } catch (err) {
    console.error(`   ⚠️ Airtable Projects mirror failed (non-critical): ${err.message}`)
  }
}

// A SIGTERM (a deliberate/external stop, not a hard crash) still gets one last chance to
// tell someone the run didn't finish — the exact failure mode confirmed live: this script
// was killed mid-run with no error ever surfacing anywhere a human would see it.
process.on('SIGTERM', async () => {
  console.error('❌ Daily fetch received SIGTERM — exiting without finishing')
  try {
    await sendSummaryEmail({ date: currentDate || 'unknown', total: 0, perSource: [], incomplete: true, killed: true })
  } catch {
    // best-effort only — if even this fails, the console.error above is the last resort
  }
  await writeStatus({ date: currentDate || 'unknown', total: 0, perSource: [], incomplete: true, killed: true, ok: false })
  process.exit(1)
})

main().catch(async (err) => {
  console.error('❌ Daily fetch failed:', err.message)
  await writeStatus({ date: currentDate || 'unknown', total: 0, perSource: [], incomplete: true, killed: false, ok: false, error: err.message })
  process.exit(1)
})
