// Runs daily via cron (see crontab) and sends the next reminder to every client who's due
// one today, per the admin-configured drip cadence (Admin page → Follow-Up Automation).
// Day-math lives HERE, not in the database or in n8n — computed fresh against live
// admin-settings every run, so a same-day settings change (e.g. widening the interval)
// takes effect on the very next run with no redeploy, and a missed cron run just catches
// up next time since everything is computed from real elapsed days, not a fixed calendar
// slot (same self-correcting approach as daily-fetch.js's target-date math).
import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = process.env.PORT || 3001
const BASE_URL = `http://localhost:${PORT}`
// Anchored to this script's own location, not process.cwd() — confirmed live elsewhere in
// this codebase (daily-fetch.js) that relying on the caller's working directory silently
// breaks the moment something spawns the script with a different cwd (e.g. execFile with
// an explicit cwd override). Safe regardless of how/from-where this gets invoked.
const ADMIN_SETTINGS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'admin-settings.json')

const DEFAULTS = {
  followUpEnabled: false,
  followUpFirstDelayDays: 7,
  followUpIntervalMinDays: 3,
  followUpIntervalMaxDays: 4,
  followUpMaxDurationDays: 120,
  followUpMaxCount: 30
}

async function loadSettings() {
  try {
    const raw = JSON.parse(await fs.readFile(ADMIN_SETTINGS_PATH, 'utf-8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return DEFAULTS
  }
}

const daysBetween = (fromIso, toDate) => (toDate.getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60 * 24)

// The "3rd to 4th day" cadence, alternating rather than a fixed gap so the sequence
// doesn't look like an obvious bot pattern to a mail provider or the client themselves.
// Follow-up #1 uses firstDelayDays; #2 onward alternate min/max starting from min.
function requiredGapForNext(followUpCount, settings) {
  if (followUpCount === 0) return settings.followUpFirstDelayDays
  const isEvenStep = (followUpCount - 1) % 2 === 0
  return isEvenStep ? settings.followUpIntervalMinDays : settings.followUpIntervalMaxDays
}

async function main() {
  const settings = await loadSettings()
  if (!settings.followUpEnabled) {
    console.log('⏸️  Follow-up automation is disabled in Admin Settings — nothing to do.')
    return
  }

  const res = await fetch(`${BASE_URL}/api/internal/follow-up-candidates`)
  const result = await res.json()
  if (!res.ok) throw new Error(result.details || result.error || 'Failed to load candidates')

  const candidates = result.candidates || []
  console.log(`📋 ${candidates.length} lead(s) eligible for follow-ups (sent, not manually stopped)`)

  const now = new Date()
  let sent = 0
  let skippedDone = 0
  let skippedNotDue = 0

  for (const lead of candidates) {
    const followUpCount = lead.follow_up_count || 0
    const daysSinceOriginal = daysBetween(lead.email_sent_at, now)

    // Whichever limit the admin set is hit first ends this client's sequence — no more
    // attempts against it, but it's left alone in the DB (not un-marked) so re-enabling a
    // higher limit later doesn't accidentally fire a burst of overdue emails at once.
    if (followUpCount >= settings.followUpMaxCount || daysSinceOriginal >= settings.followUpMaxDurationDays) {
      skippedDone++
      continue
    }

    const anchor = lead.follow_up_last_sent_at || lead.email_sent_at
    const daysSinceAnchor = daysBetween(anchor, now)
    const requiredGap = requiredGapForNext(followUpCount, settings)

    if (daysSinceAnchor < requiredGap) {
      skippedNotDue++
      continue
    }

    try {
      const sendRes = await fetch(`${BASE_URL}/api/internal/send-followup-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          clientName: lead.client_name,
          clientEmail: lead.contact_email,
          followUpNumber: followUpCount + 1,
          daysSinceOriginal: Math.round(daysSinceOriginal)
        })
      })
      const sendResult = await sendRes.json()
      if (!sendRes.ok) throw new Error(sendResult.details || sendResult.error || 'send failed')
      sent++
      console.log(`   ✅ ${lead.client_name} — follow-up #${followUpCount + 1} sent (day ${Math.round(daysSinceOriginal)} since original)`)
    } catch (err) {
      console.error(`   ❌ ${lead.client_name} (lead ${lead.id}): follow-up send failed — ${err.message}`)
    }
  }

  console.log(`✅ Follow-up run complete: ${sent} sent, ${skippedNotDue} not due yet, ${skippedDone} finished their sequence`)
}

main().catch((err) => {
  console.error('❌ Follow-up run failed:', err.message)
  process.exit(1)
})
