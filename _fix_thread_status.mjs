import 'dotenv/config'
import { _crmSupabase as s } from './crm-db.js'
// Re-derive crm_threads.status now that "responded" means "a matched lead
// actually wrote back" (not just "some inbound landed"). Archived threads untouched.
const { data: threads } = await s.from('crm_threads').select('id, lead_id, status')
let toResponded = 0, toOpen = 0
for (const t of threads) {
  if (t.status === 'archived') continue
  let real = false
  if (t.lead_id) {
    const { data: msgs } = await s.from('crm_messages')
      .select('id').eq('thread_id', t.id).eq('direction', 'inbound').eq('is_auto_reply', false).limit(1)
    real = (msgs && msgs.length > 0)
  }
  const want = real ? 'responded' : 'open'
  if (want !== t.status) {
    await s.from('crm_threads').update({ status: want }).eq('id', t.id)
    if (want === 'responded') toResponded++; else toOpen++
  }
}
console.log(`thread status re-derived: -> responded ${toResponded}, -> open ${toOpen}, unchanged ${threads.length - toResponded - toOpen}`)
process.exit(0)
