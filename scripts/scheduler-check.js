// Runs every 5 minutes via cron (in the VM's own system time — deliberately NOT tied to
// a fixed CRON_TZ entry) and decides whether it's time to trigger the daily fetch, based
// on a small config file the Dashboard can edit live (enabled/hour/minute, in America/
// New_York). This is what makes the schedule changeable from the UI without needing to
// rewrite the crontab itself — the crontab always just says "check every 5 minutes."
import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, '..', 'schedule-config.json')
const CHECK_INTERVAL_MINUTES = 5

async function loadConfig() {
  try {
    return JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'))
  } catch {
    return { enabled: true, hour: 5, minute: 0, lastRunDate: null }
  }
}

async function saveConfig(cfg) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2))
}

function nowInNY() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date())
  const get = (t) => parts.find((p) => p.type === t).value
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10)
  }
}

async function main() {
  const cfg = await loadConfig()
  if (!cfg.enabled) return

  const { dateStr, hour, minute } = nowInNY()
  if (cfg.lastRunDate === dateStr) return // already triggered today

  const withinWindow = hour === cfg.hour && minute >= cfg.minute && minute < cfg.minute + CHECK_INTERVAL_MINUTES
  if (!withinWindow) return

  console.log(`⏰ Scheduler: triggering daily fetch at ${dateStr} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ET`)
  cfg.lastRunDate = dateStr
  await saveConfig(cfg)

  execFile('node', ['daily-fetch.js'], { cwd: __dirname, env: process.env, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (stdout) console.log(stdout)
    if (stderr) console.error(stderr)
    if (err) console.error('❌ daily-fetch.js failed:', err.message)
  })
}

main().catch((err) => {
  console.error('❌ Scheduler check failed:', err.message)
  process.exit(1)
})
