// Persistence for saved leads/proposals, so recalling or editing one never needs
// another CRM/Gemini round trip. Supabase-backed so this works identically from
// the local dev server (server.js) and once deployed to Vercel (api/leads.js) —
// a local SQLite file would have worked locally but Vercel's serverless functions
// have no persistent disk between invocations. Schema: supabase/migrations/004_add_leads_tables.sql.
// Author: Burhan.
import { createClient } from '@supabase/supabase-js'

// A stalled Supabase request (seen live: a TCP connection stayed ESTABLISHED with
// data sitting unread in the kernel receive queue) has no built-in timeout, so it
// hangs the whole await chain forever — the client never gets a `done` or `failed`
// event and the fetch panel spins indefinitely. Every Supabase call now aborts
// after 15s so a stall degrades to a clear, catchable error instead of a hang.
const fetchWithTimeout = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(15000) })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, // server-side only — bypasses RLS, never expose to the frontend
  { global: { fetch: fetchWithTimeout } }
)

// Insert a new lead, or a new version onto an existing one if crmRecordId already
// matches a saved lead. Returns { leadId, version, isNewLead }.
export async function saveLeadVersion({ crmRecordId, clientName, contactEmail, data, label, source, batchId, crmSourceAlias, archivePath, crmLeadDate }) {
  const now = new Date().toISOString()
  let lead = null

  if (crmRecordId) {
    const { data: existing, error } = await supabase
      .from('leads')
      .select('id')
      .eq('crm_record_id', crmRecordId)
      .maybeSingle()
    if (error) throw error
    lead = existing
  }

  let isNewLead = false
  if (!lead) {
    isNewLead = true
    const { data: inserted, error } = await supabase
      .from('leads')
      .insert({
        crm_record_id: crmRecordId || null,
        client_name: clientName || 'Unnamed Client',
        contact_email: contactEmail || '',
        crm_lead_date: crmLeadDate || null,
        created_at: now,
        updated_at: now
      })
      .select('id')
      .single()
    if (error) throw error
    lead = inserted
  } else {
    // Only touches crm_lead_date when this save actually carries one — a manual save from
    // the editor (no date context at all) must never blank out a date this lead already
    // picked up from an earlier CRM fetch.
    const update = { client_name: clientName || 'Unnamed Client', contact_email: contactEmail || '', updated_at: now }
    if (crmLeadDate) update.crm_lead_date = crmLeadDate
    const { error } = await supabase
      .from('leads')
      .update(update)
      .eq('id', lead.id)
    if (error) throw error
  }

  const { data: maxRow, error: maxErr } = await supabase
    .from('lead_versions')
    .select('version_number')
    .eq('lead_id', lead.id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (maxErr) throw maxErr
  const version = (maxRow?.version_number || 0) + 1

  const { error: insertErr } = await supabase
    .from('lead_versions')
    .insert({
      lead_id: lead.id,
      version_number: version,
      data,
      label: label || null,
      source: source || 'manual',
      batch_id: batchId || null,
      crm_source_alias: crmSourceAlias || null,
      archive_path: archivePath || null,
      created_at: now
    })
  if (insertErr) throw insertErr

  return { leadId: lead.id, version, isNewLead }
}

// Powers the "already fetched" dedup check in /api/migrate-lead — a re-fetch of a
// crmRecordId that's already saved doesn't need another CRM+Gemini round trip, it needs
// to tell the caller what's already there (when it was first fetched, whether the
// proposal email already went out) so the UI can show that instead of silently redoing
// the work. created_at is never touched after the initial insert (see saveLeadVersion's
// update branch above), so it doubles as "first fetched" without a separate column.
export async function getLeadByCrmRecordId(crmRecordId) {
  if (!crmRecordId) return null
  const { data, error } = await supabase
    .from('leads')
    .select('id, created_at, email_sent_at, email_sent_by')
    .eq('crm_record_id', crmRecordId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { leadId: data.id, fetchedAt: data.created_at, emailSentAt: data.email_sent_at, emailSentBy: data.email_sent_by }
}

// Confirmed live as a real gap: an "already fetched" lead (dedup-skipped, no new CRM/AI
// call made) never got associated with the date it was found under on THIS run — only
// with whenever it was first actually fetched, which could be a completely different
// date. That meant re-covering the same CRM date later (a widened gap, or a recovery run)
// correctly avoided re-doing the work, but the lead then had nowhere to show up when
// browsing "leads for that date" — it just silently wasn't there, even though it
// genuinely belongs to it. Called on every dedup-skip that carries a target date, so the
// association gets backfilled the first time any date-based fetch rediscovers it — no new
// CRM/Gemini call, just one cheap column update.
export async function markLeadCrmDate(leadId, date) {
  if (!date) return
  const { error } = await supabase
    .from('leads')
    .update({ crm_lead_date: date })
    .eq('id', leadId)
  if (error) throw error
}

// Called from /api/send-email once the proposal actually goes out, so a later duplicate
// fetch of the same lead can say "email sent" instead of just "already fetched" — and so
// the review queue itself can show it, for every employee, on every device (everyone
// shares one login, so there's no per-user account to check this against otherwise).
// sentBy is a best-effort "who" — IP + browser/OS, the same signal already used for fetch
// activity — not a real identity, but confirmed the concrete thing multiple employees on
// separate devices actually needed: "did SOMEONE already send this."
export async function markLeadEmailSent(leadId, sentBy = null) {
  const { error } = await supabase
    .from('leads')
    .update({ email_sent_at: new Date().toISOString(), email_sent_by: sentBy })
    .eq('id', leadId)
  if (error) throw error
}

// The one manual override for the follow-up drip sequence — an employee marking a client
// as replied/converted/uninterested stops it immediately, regardless of how many of the
// admin-configured follow-ups are left. Idempotent: stopping an already-stopped lead just
// re-stamps the timestamp, never errors.
export async function stopFollowUps(leadId) {
  const { error } = await supabase
    .from('leads')
    .update({ follow_up_stopped_at: new Date().toISOString() })
    .eq('id', leadId)
  if (error) throw error
}

export async function resumeFollowUps(leadId) {
  const { error } = await supabase
    .from('leads')
    .update({ follow_up_stopped_at: null })
    .eq('id', leadId)
  if (error) throw error
}

// Every lead that's had its ORIGINAL proposal emailed and hasn't been manually stopped —
// scripts/send-followups.js does the actual day-math (whose turn it is today) itself,
// since that logic needs the live admin-settings values, not just what's in the DB.
export async function getFollowUpCandidates() {
  const { data, error } = await supabase
    .from('leads')
    .select('id, client_name, contact_email, email_sent_at, follow_up_count, follow_up_last_sent_at')
    .not('email_sent_at', 'is', null)
    .is('follow_up_stopped_at', null)
  if (error) throw error
  return data
}

export async function recordFollowUpSent(leadId) {
  const { data: current, error: readErr } = await supabase
    .from('leads')
    .select('follow_up_count')
    .eq('id', leadId)
    .single()
  if (readErr) throw readErr
  const { error } = await supabase
    .from('leads')
    .update({ follow_up_count: (current.follow_up_count || 0) + 1, follow_up_last_sent_at: new Date().toISOString() })
    .eq('id', leadId)
  if (error) throw error
}

export async function listLeads() {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, client_name, contact_email, crm_record_id, updated_at, created_at, email_sent_at, email_sent_by')
    .order('updated_at', { ascending: false })
  if (error) throw error
  if (leads.length === 0) return []

  const { data: versions, error: vErr } = await supabase
    .from('lead_versions')
    .select('lead_id, version_number, crm_source_alias')
    .in('lead_id', leads.map((l) => l.id))
  if (vErr) throw vErr

  const byLead = {}
  for (const v of versions) {
    const s = (byLead[v.lead_id] ||= { max: 0, count: 0, alias: null })
    s.count++
    if (v.version_number > s.max) s.max = v.version_number
    // The source company doesn't change between re-fetches of the same CRM record — any
    // version's alias works, but the earliest is the one actually present for leads
    // fetched before this column existed on later versions.
    if (v.crm_source_alias && !s.alias) s.alias = v.crm_source_alias
  }

  return leads.map((l) => ({
    id: l.id,
    clientName: l.client_name,
    contactEmail: l.contact_email,
    crmRecordId: l.crm_record_id,
    updatedAt: l.updated_at,
    fetchedAt: l.created_at,
    emailSentAt: l.email_sent_at,
    emailSentBy: l.email_sent_by,
    crmSourceAlias: byLead[l.id]?.alias || null,
    latestVersion: byLead[l.id]?.max || 0,
    versionCount: byLead[l.id]?.count || 0
  }))
}

// Groups lead_versions by batch_id (one user-initiated fetch action, or one daily
// automated run) — powers the Dashboard's Batch History panel. Aggregated in JS rather
// than a DB-side GROUP BY: simplest option, and batch volume here is small (per-run
// counts, not per-lead), so this stays cheap even as lead_versions grows.
export async function listBatches() {
  const { data, error } = await supabase
    .from('lead_versions')
    .select('batch_id, crm_source_alias, source, created_at')
    .not('batch_id', 'is', null)
    .order('created_at', { ascending: false })
  if (error) throw error

  const byBatch = new Map()
  for (const row of data) {
    if (!byBatch.has(row.batch_id)) {
      byBatch.set(row.batch_id, { batchId: row.batch_id, createdAt: row.created_at, total: 0, bySource: {}, isAutomated: false })
    }
    const b = byBatch.get(row.batch_id)
    b.total++
    const alias = row.crm_source_alias || 'Unknown'
    b.bySource[alias] = (b.bySource[alias] || 0) + 1
    if (row.source === 'daily-auto-fetch') b.isAutomated = true
    if (row.created_at < b.createdAt) b.createdAt = row.created_at // earliest row = batch start time
  }
  return Array.from(byBatch.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

// email_sent_at/_by live on `leads`, not `lead_versions` — a plain separate lookup
// merged in JS, same pattern as listLeads()'s version merge below, rather than an
// embedded Supabase join (which depends on FK metadata being set up a specific way and
// is easy to get subtly wrong). Lets the review queue show "sent" — and who sent it —
// for every employee on every device, since it's shared login with no per-user session
// to check this against otherwise.
async function attachEmailSentInfo(rows) {
  if (rows.length === 0) return rows
  const leadIds = [...new Set(rows.map((r) => r.lead_id))]
  const { data, error } = await supabase
    .from('leads')
    .select('id, email_sent_at, email_sent_by')
    .in('id', leadIds)
  if (error) throw error
  const byId = new Map(data.map((l) => [l.id, l]))
  return rows.map((r) => ({
    ...r,
    email_sent_at: byId.get(r.lead_id)?.email_sent_at || null,
    email_sent_by: byId.get(r.lead_id)?.email_sent_by || null
  }))
}

// Full data for every lead in one batch, images rehydrated by the caller (server.js) —
// this just returns what's in Supabase (stripped) plus each row's archive_path.
export async function getBatchLeads(batchId) {
  const { data, error } = await supabase
    .from('lead_versions')
    .select('lead_id, version_number, data, archive_path, crm_source_alias, created_at')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return attachEmailSentInfo(data)
}

// A single target date (e.g. leads created on 2026-08-16) can span MULTIPLE batch runs —
// the original 5am automated run plus any later manual/recovery re-run that picked up
// what the first one missed. Every daily batch_id embeds its target date as
// daily-<date>-<timestamp>, so matching on that prefix merges all of them into one list —
// confirmed as the fix for "I have to manually load a second batch from the Dashboard to
// see leads that came in from a recovery run." One lead_id appearing in more than one
// matched batch (re-fetched, not just a dedup-skip) keeps only its newest version.
// Queries leads.crm_lead_date directly — NOT a batch_id prefix match. batch_id only ever
// reflects whichever run FIRST actually fetched a lead; a lead re-discovered later as an
// "already fetched" duplicate (a widened gap, a recovery run, a second pass over the same
// CRM date) never gets a new batch_id, so it would silently never show up here even
// though it genuinely belongs to this date. crm_lead_date is written on every real save
// AND backfilled on every dedup-skip (see markLeadCrmDate) specifically so this stays
// correct regardless of how many separate runs it took to fully cover one date.
export async function getLeadsByDate(date) {
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, email_sent_at, email_sent_by')
    .eq('crm_lead_date', date)
  if (leadsErr) throw leadsErr
  if (leads.length === 0) return []

  const leadIds = leads.map((l) => l.id)
  const { data: versions, error: vErr } = await supabase
    .from('lead_versions')
    .select('lead_id, version_number, data, archive_path, crm_source_alias, created_at')
    .in('lead_id', leadIds)
    .order('created_at', { ascending: true })
  if (vErr) throw vErr

  const byLead = new Map()
  for (const row of versions) {
    const existing = byLead.get(row.lead_id)
    if (!existing || row.version_number > existing.version_number) byLead.set(row.lead_id, row)
  }
  const emailInfoByLeadId = new Map(leads.map((l) => [l.id, l]))
  return [...byLead.values()].map((row) => ({
    ...row,
    email_sent_at: emailInfoByLeadId.get(row.lead_id)?.email_sent_at || null,
    email_sent_by: emailInfoByLeadId.get(row.lead_id)?.email_sent_by || null
  }))
}

export async function listVersions(leadId) {
  const { data, error } = await supabase
    .from('lead_versions')
    .select('version_number, label, source, created_at')
    .eq('lead_id', leadId)
    .order('version_number', { ascending: false })
  if (error) throw error
  return data.map((v) => ({
    version: v.version_number,
    label: v.label,
    source: v.source,
    createdAt: v.created_at
  }))
}

export async function getVersion(leadId, version) {
  let query = supabase.from('lead_versions').select('data, version_number, archive_path').eq('lead_id', leadId)
  query = version === 'latest'
    ? query.order('version_number', { ascending: false }).limit(1)
    : query.eq('version_number', Number(version))

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) return null
  return { version: data.version_number, data: data.data, archivePath: data.archive_path }
}

export async function deleteLead(leadId) {
  const { data, error } = await supabase.from('leads').delete().eq('id', leadId).select('id')
  if (error) throw error
  return data.length > 0
}
