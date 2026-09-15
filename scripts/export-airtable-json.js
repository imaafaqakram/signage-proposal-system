// Pulls the RAW Airtable records (exactly as they come from Airtable, before any Gemini
// extraction) for one date across every enabled CRM source, groups them by company alias,
// and emails the combined JSON as a file attachment. Reuses migrate.py --list-only, which
// already returns each record's full { id, fields } — no separate Airtable client here.
//
// Usage:
//   node scripts/export-airtable-json.js               # date = today minus the daily gap
//   node scripts/export-airtable-json.js 2026-08-15    # a specific UTC date
//
// The recipient is the admin notify address (admin-settings.json), same as every other
// internal email — never a client, and never an address passed in from outside.
import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import nodemailer from 'nodemailer'

const execFileP = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = process.env.LEAD_IMPORT_DIR || '/opt/lead-import'
const ADMIN_SETTINGS_PATH = path.join(process.cwd(), 'admin-settings.json')

function targetDateUTC() {
  const gap = parseInt(process.env.DAILY_FETCH_GAP_DAYS || '8', 10)
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - gap)
  return d.toISOString().slice(0, 10)
}

// Every CRM_SOURCE_<n>_LABEL present in the environment — a commented-out block in .env
// simply isn't set, so it's skipped here, matching what the daily fetch actually pulls.
function enabledSources() {
  const sources = []
  for (let n = 1; n <= 10; n++) {
    const label = process.env[`CRM_SOURCE_${n}_LABEL`]
    if (label) sources.push({ n: String(n), alias: label })
  }
  return sources
}

async function listRecordsForSource(sourceN, date) {
  const { stdout } = await execFileP(
    'python3',
    ['migrate.py', '--list-only', '--date', date, '--source', sourceN],
    { cwd: SCRIPT_DIR, env: process.env, maxBuffer: 64 * 1024 * 1024 }
  )
  // --list-only prints progress lines to stdout too; the JSON is the last non-empty line.
  const lastLine = stdout.trim().split('\n').filter((l) => l.trim().startsWith('{')).pop()
  if (!lastLine) return []
  return JSON.parse(lastLine).leads.map((l) => l.record)
}

async function loadNotifyEmail() {
  try {
    const raw = JSON.parse(await fs.readFile(ADMIN_SETTINGS_PATH, 'utf-8'))
    return raw.notifyEmail || 'controva258@gmail.com'
  } catch {
    return 'controva258@gmail.com'
  }
}

async function main() {
  const date = process.argv[2] || targetDateUTC()
  const sources = enabledSources()
  console.log(`📤 Airtable JSON export for ${date} across ${sources.length} source(s)`)

  const byCompany = {}
  let total = 0
  for (const { n, alias } of sources) {
    try {
      const records = await listRecordsForSource(n, date)
      byCompany[alias] = records
      total += records.length
      console.log(`   ${alias}: ${records.length} record(s)`)
    } catch (err) {
      byCompany[alias] = { error: err.message }
      console.error(`   ❌ ${alias}: ${err.message}`)
    }
  }

  const payload = { date, exportedAt: new Date().toISOString(), totalRecords: total, byCompany }
  const outPath = path.join(os.tmpdir(), `airtable-export-${date}.json`)
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2))
  console.log(`   Wrote ${outPath} (${total} records)`)

  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS
  if (!smtpUser || !smtpPass) {
    console.error('❌ SMTP not configured — file written but not emailed')
    process.exit(1)
  }
  const to = await loadNotifyEmail()
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: (process.env.SMTP_PORT || '465') === '465',
    auth: { user: smtpUser, pass: smtpPass },
    tls: { rejectUnauthorized: false }
  })
  const summary = Object.entries(byCompany)
    .map(([alias, v]) => `${alias}: ${Array.isArray(v) ? v.length : 'ERROR — ' + v.error}`)
    .join('<br>')
  await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'Signage Crafting'}" <${smtpUser}>`,
    to,
    subject: `Airtable raw export — ${date} — ${total} record(s)`,
    html: `<p>Raw Airtable records for <strong>${date}</strong>, grouped by company, attached as JSON.</p><p>${summary}</p>`,
    attachments: [{ filename: `airtable-export-${date}.json`, path: outPath }]
  })
  console.log(`✅ Emailed ${total} record(s) to ${to}`)
}

main().catch((err) => {
  console.error('❌ Export failed:', err.message)
  process.exit(1)
})
