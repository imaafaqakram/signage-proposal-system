// One-time, re-runnable repair: rewrites Message-ID / In-Reply-To values that the n8n workflow
// stored as raw header lines ("Message-ID: <abc@host>") into canonical "<abc@host>" form, so
// duplicate detection and reply-threading work for those rows too (see crm-mail-utils.js).
//
//   node scripts/crm-repair-message-ids.mjs            # dry run: shows what it would change
//   node scripts/crm-repair-message-ids.mjs --apply    # saves a backup of every row it will
//                                                      # touch to .deploy-backups/, then updates
//
// Run it from the app folder (/opt/luminus-app) so .env is found. Rows whose cleaned id would
// collide with ANOTHER row's id (the same email stored twice) are left alone and reported.
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { _crmSupabase as supabase } from '../crm-db.js'
import { normalizeMessageId, isMalformedId, idKey } from '../crm-mail-utils.js'

const APPLY = process.argv.includes('--apply')

const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('crm_messages')
    .select('id, message_id, in_reply_to')
    .order('id', { ascending: true })
    .range(from, from + 999)
  if (error) throw error
  rows.push(...data)
  if (data.length < 1000) break
}

const keyCount = new Map()
for (const r of rows) {
  const k = idKey(r.message_id)
  if (k) keyCount.set(k, (keyCount.get(k) || 0) + 1)
}

const plan = []
const collisions = []
for (const r of rows) {
  const newMid = isMalformedId(r.message_id) ? normalizeMessageId(r.message_id) : r.message_id
  const newIrt = isMalformedId(r.in_reply_to) ? normalizeMessageId(r.in_reply_to) : r.in_reply_to
  if (newMid === r.message_id && newIrt === r.in_reply_to) continue
  if (newMid !== r.message_id && keyCount.get(idKey(r.message_id)) > 1) {
    collisions.push(r)
    continue
  }
  plan.push({ id: r.id, oldMid: r.message_id, newMid, oldIrt: r.in_reply_to, newIrt })
}

const midFixes = plan.filter((p) => p.newMid !== p.oldMid).length
const irtFixes = plan.filter((p) => p.newIrt !== p.oldIrt).length
console.log(`${rows.length} messages checked`)
console.log(`  Message-ID needing cleanup : ${midFixes}`)
console.log(`  In-Reply-To needing cleanup: ${irtFixes}`)
console.log(`  left alone (same email stored twice): ${collisions.length}`)
for (const p of plan.filter((x) => x.newMid !== x.oldMid).slice(0, 3)) console.log(`   Message-ID  ${JSON.stringify(p.oldMid)}\n            -> ${JSON.stringify(p.newMid)}`)
for (const p of plan.filter((x) => x.newIrt !== x.oldIrt).slice(0, 2)) console.log(`   In-Reply-To ${JSON.stringify(p.oldIrt)}\n            -> ${JSON.stringify(p.newIrt)}`)
for (const c of collisions.slice(0, 10)) console.log(`   duplicate: row ${c.id} ${JSON.stringify(String(c.message_id).slice(0, 70))}`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing changed. Re-run with --apply to write.')
  process.exit(0)
}

const dir = path.join(process.cwd(), '.deploy-backups')
fs.mkdirSync(dir, { recursive: true })
const backup = path.join(dir, `message-id-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
fs.writeFileSync(backup, JSON.stringify(plan, null, 1), { mode: 0o600 })
console.log(`\nBackup of the ${plan.length} rows (old values) saved to ${backup}`)

let done = 0
let failed = 0
for (const p of plan) {
  const { error } = await supabase.from('crm_messages').update({ message_id: p.newMid, in_reply_to: p.newIrt }).eq('id', p.id)
  if (error) {
    failed++
    console.warn(`  ! row ${p.id}: ${error.message}`)
  } else {
    done++
  }
}
console.log(`Updated ${done} rows${failed ? `, ${failed} failed` : ''}. To undo, restore the old values from the backup file.`)
process.exit(failed ? 1 : 0)
