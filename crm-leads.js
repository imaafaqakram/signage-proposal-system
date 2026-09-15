// Luminus CRM — Phase 2: the Leads section API.
//
// Mounted at /api/crm/leads in server.js, right after the Phase 1 CRM router:
//
//   import { createCrmLeadsRouter } from './crm-leads.js'
//   app.use('/api/crm/leads', createCrmLeadsRouter({ requireAuth: requireBypassAuth }))
//
// Self-contained: the only thing it touches is the CRM Supabase client exported
// from crm-db.js (service-role key, 15s timeout). It never imports or calls into
// the proposal system's send / persistence paths. Every route sits behind
// requireAuth. Reads only, except PATCH /:id/status which writes crm_lead_status.
import express from 'express'
import fs from 'node:fs'
import { _crmSupabase as supabase } from './crm-db.js'

const STAGES = ['new', 'contacted', 'responded', 'negotiating', 'won', 'lost']
const NON_NEW = STAGES.filter((s) => s !== 'new')
const CLOSED_STAGES = new Set(['won', 'lost'])

// Automation rule: a lead that's been decided (Won or Lost) never needs another
// follow-up nudge. Guarded on IS NULL so it only ever sets the flag once — it
// won't silently undo an admin's manual "Resume follow-ups" on a lead that gets
// dragged between stages again later.
async function autoStopFollowUpsIfClosed(leadId, stage) {
  if (!CLOSED_STAGES.has(stage)) return
  const { error } = await supabase
    .from('leads')
    .update({ follow_up_stopped_at: new Date().toISOString() })
    .eq('id', leadId)
    .is('follow_up_stopped_at', null)
  if (error) console.warn('[crm-leads] autoStopFollowUpsIfClosed failed:', error.message)
}
// This app has no per-lead deep link into the proposal editor — just the base URL.
const PROPOSAL_BASE_URL = 'https://proposal.controvallc.com/'
// Activity sort joins a cross-table column in memory; this caps how deep it stays exact.
const ACTIVITY_SCAN_CAP = 1000

const iso = (v) => {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
const clampInt = (v, def, min, max) => {
  const n = parseInt(v, 10)
  if (isNaN(n)) return def
  return Math.min(Math.max(n, min), max)
}
// Strip anything that would break PostgREST's .or() / ilike grammar, then wrap our own %.
const sanitizeLike = (s) => (s || '').toString().replace(/[,()*%\\]/g, ' ').replace(/\s+/g, ' ').trim()

// ── batched lookups (deliberately no N+1) ────────────────

async function fetchStatusMap(ids) {
  const m = new Map()
  if (!ids.length) return m
  const { data, error } = await supabase.from('crm_lead_status').select('*').in('lead_id', ids)
  if (error) throw error
  for (const r of data || []) m.set(r.lead_id, r)
  return m
}

async function fetchLeadIdSet(table, ids, refine) {
  const s = new Set()
  if (!ids.length) return s
  let query = supabase.from(table).select('lead_id').in('lead_id', ids)
  if (refine) query = refine(query)
  const { data, error } = await query
  if (error) throw error
  for (const r of data || []) if (r.lead_id != null) s.add(r.lead_id)
  return s
}

// Latest lead_version per lead → its crm_source_alias.
async function fetchLatestAliasMap(ids) {
  const m = new Map()
  if (!ids.length) return m
  const { data, error } = await supabase
    .from('lead_versions')
    .select('lead_id, crm_source_alias, version_number, created_at')
    .in('lead_id', ids)
    .order('lead_id', { ascending: true })
    .order('version_number', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  for (const r of data || []) if (!m.has(r.lead_id)) m.set(r.lead_id, r.crm_source_alias || null)
  return m
}

export function createCrmLeadsRouter({ requireAuth } = {}) {
  const router = express.Router()
  const auth = requireAuth || ((req, res, next) => next())
  const jsonBody = express.json({ limit: '1mb' })

  // ── GET /  — paginated lead list ──────────────────────────
  router.get('/', auth, async (req, res) => {
    try {
      const limit = clampInt(req.query.limit, 50, 1, 200)
      const offset = clampInt(req.query.offset, 0, 0, 1_000_000)
      const sort = req.query.sort === 'activity' ? 'activity' : 'recent'
      const stage = (req.query.stage || 'all').toString()
      const q = sanitizeLike(req.query.q)

      // stage lives in crm_lead_status, and 'new' also covers leads with no row
      // yet — so resolve the stage filter to an id constraint on `leads`.
      let stageFilter = null
      if (stage !== 'all' && STAGES.includes(stage)) {
        if (stage === 'new') {
          const { data, error } = await supabase
            .from('crm_lead_status')
            .select('lead_id')
            .in('stage', NON_NEW)
          if (error) throw error
          stageFilter = { mode: 'exclude', ids: (data || []).map((r) => r.lead_id) }
        } else {
          const { data, error } = await supabase
            .from('crm_lead_status')
            .select('lead_id')
            .eq('stage', stage)
          if (error) throw error
          stageFilter = { mode: 'include', ids: (data || []).map((r) => r.lead_id) }
        }
      }
      if (stageFilter && stageFilter.mode === 'include' && stageFilter.ids.length === 0) {
        return res.json({ leads: [], total: 0 })
      }

      const applyFilters = (query) => {
        if (q) query = query.or(`client_name.ilike.%${q}%,contact_email.ilike.%${q}%`)
        if (stageFilter) {
          if (stageFilter.mode === 'include') query = query.in('id', stageFilter.ids)
          else if (stageFilter.ids.length) query = query.not('id', 'in', `(${stageFilter.ids.join(',')})`)
        }
        return query
      }

      // total — exact; the stage id-list keeps it exact here
      let total = 0
      {
        const { count, error } = await applyFilters(
          supabase.from('leads').select('id', { count: 'exact', head: true })
        )
        if (error) throw error
        total = count || 0
      }

      const cols = 'id, client_name, contact_email, crm_lead_date, created_at, email_sent_at'
      let pageRows = []
      let statusMap = null

      if (sort === 'activity') {
        // last_activity_at is on crm_lead_status — pull a capped candidate window,
        // join status in memory, order (nulls last), then slice the page.
        const { data, error } = await applyFilters(supabase.from('leads').select(cols))
          .order('created_at', { ascending: false })
          .limit(ACTIVITY_SCAN_CAP)
        if (error) throw error
        const cands = data || []
        statusMap = await fetchStatusMap(cands.map((l) => l.id))
        cands.sort((a, b) => {
          const av = statusMap.get(a.id)?.last_activity_at
          const bv = statusMap.get(b.id)?.last_activity_at
          if (av && bv) return new Date(bv) - new Date(av)
          if (av) return -1
          if (bv) return 1
          return new Date(b.created_at) - new Date(a.created_at)
        })
        pageRows = cands.slice(offset, offset + limit)
      } else {
        const { data, error } = await applyFilters(supabase.from('leads').select(cols))
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1)
        if (error) throw error
        pageRows = data || []
      }

      const ids = pageRows.map((l) => l.id)
      if (!statusMap) statusMap = await fetchStatusMap(ids)
      const [aliasMap, threadSet, pdfSet] = await Promise.all([
        fetchLatestAliasMap(ids),
        fetchLeadIdSet('crm_threads', ids),
        fetchLeadIdSet('crm_attachments', ids, (query) => query.eq('kind', 'proposal-pdf'))
      ])

      const leads = pageRows.map((l) => {
        const st = statusMap.get(l.id) || null
        return {
          id: l.id,
          client_name: l.client_name,
          contact_email: l.contact_email,
          crm_lead_date: l.crm_lead_date,
          created_at: l.created_at,
          email_sent_at: l.email_sent_at,
          source_alias: aliasMap.get(l.id) || null,
          stage: st?.stage || 'new',
          owner: st?.owner || null,
          first_response_at: st?.first_response_at || null,
          last_activity_at: st?.last_activity_at || null,
          has_thread: threadSet.has(l.id),
          has_proposal_pdf: pdfSet.has(l.id)
        }
      })

      res.json({ leads, total })
    } catch (err) {
      console.error('[crm-leads]', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ── GET /attachment/:attachmentId — stream a stored file ──
  // Registered before /:id so "attachment" is never read as an id.
  router.get('/attachment/:attachmentId', auth, async (req, res) => {
    try {
      const attId = Number(req.params.attachmentId)
      if (!Number.isFinite(attId)) return res.status(400).json({ error: 'bad id' })

      const { data: att, error } = await supabase
        .from('crm_attachments')
        .select('id, filename, content_type, disk_path, drive_path')
        .eq('id', attId)
        .maybeSingle()
      if (error) throw error
      if (!att) return res.status(404).json({ error: 'not found' })

      if (att.disk_path && fs.existsSync(att.disk_path)) {
        const safeName = (att.filename || 'file').replace(/["\r\n]/g, '')
        res.setHeader('Content-Type', att.content_type || 'application/octet-stream')
        res.setHeader('Content-Disposition', `inline; filename="${safeName}"`)
        const stream = fs.createReadStream(att.disk_path)
        stream.on('error', (e) => {
          console.error('[crm-leads]', e)
          if (!res.headersSent) res.status(500).json({ error: e.message })
          else res.destroy(e)
        })
        stream.pipe(res)
        return
      }
      return res.status(404).json({ error: 'not on disk', drive_path: att.drive_path || null })
    } catch (err) {
      console.error('[crm-leads]', err)
      if (!res.headersSent) res.status(500).json({ error: err.message })
    }
  })

  // ── GET /:id — one lead: list row + proposal fields + timeline ──
  router.get('/:id', auth, async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })

      const { data: lead, error } = await supabase.from('leads').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      if (!lead) return res.status(404).json({ error: 'not found' })

      const [
        { data: versions, error: vErr },
        { data: st, error: sErr },
        { data: threads, error: tErr },
        { data: atts, error: aErr }
      ] = await Promise.all([
        supabase
          .from('lead_versions')
          .select('data, crm_source_alias, version_number, created_at')
          .eq('lead_id', id)
          .order('version_number', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1),
        supabase.from('crm_lead_status').select('*').eq('lead_id', id).maybeSingle(),
        supabase.from('crm_threads').select('id').eq('lead_id', id),
        supabase
          .from('crm_attachments')
          .select('id, filename, size_bytes, created_at, disk_path')
          .eq('lead_id', id)
          .eq('kind', 'proposal-pdf')
          .order('created_at', { ascending: false })
      ])
      if (vErr) throw vErr
      if (sErr) throw sErr
      if (tErr) throw tErr
      if (aErr) throw aErr

      const v = versions?.[0] || null
      const d = (v && v.data) || {}
      const page0 = Array.isArray(d.pages) ? d.pages[0] : null

      const threadIds = (threads || []).map((t) => t.id)
      let messages = []
      if (threadIds.length) {
        const { data: msgs, error: mErr } = await supabase
          .from('crm_messages')
          .select('direction, subject, snippet, sent_at, created_at')
          .in('thread_id', threadIds)
          .order('sent_at', { ascending: true })
        if (mErr) throw mErr
        messages = msgs || []
      }

      // ── merged, chronological timeline ──
      const timeline = []
      if (lead.email_sent_at) {
        timeline.push({
          at: iso(lead.email_sent_at),
          type: 'proposal-sent',
          label: 'Proposal emailed',
          detail: lead.email_sent_by || null
        })
      }
      for (const m of messages) {
        const inbound = m.direction === 'inbound'
        timeline.push({
          at: iso(m.sent_at || m.created_at),
          type: inbound ? 'reply-received' : 'reply-sent',
          label: inbound ? 'Reply received' : 'Reply sent',
          detail: m.subject || m.snippet || null
        })
      }
      if ((lead.follow_up_count || 0) > 0) {
        timeline.push({
          at: iso(lead.follow_up_last_sent_at),
          type: 'follow-up',
          label: `Follow-up ${lead.follow_up_count}`,
          detail: null
        })
      }
      if (st?.first_response_at) {
        timeline.push({
          at: iso(st.first_response_at),
          type: 'responded',
          label: 'First response',
          detail: null
        })
      }
      timeline.sort((a, b) => {
        if (!a.at && !b.at) return 0
        if (!a.at) return 1
        if (!b.at) return -1
        return new Date(a.at) - new Date(b.at)
      })

      const attachments = (atts || []).map((a) => ({
        id: a.id,
        filename: a.filename,
        size_bytes: a.size_bytes,
        created_at: a.created_at,
        on_disk: !!a.disk_path
      }))

      res.json({
        id: lead.id,
        client_name: lead.client_name,
        contact_email: lead.contact_email,
        crm_lead_date: lead.crm_lead_date,
        created_at: lead.created_at,
        email_sent_at: lead.email_sent_at,
        email_sent_by: lead.email_sent_by || null,
        follow_up_count: lead.follow_up_count || 0,
        source_alias: (v && v.crm_source_alias) || d?._source?.crmSourceAlias || null,
        stage: st?.stage || 'new',
        owner: st?.owner || null,
        first_response_at: st?.first_response_at || null,
        last_activity_at: st?.last_activity_at || null,
        has_thread: threadIds.length > 0,
        has_proposal_pdf: attachments.length > 0,
        sign_type: page0?.signType ?? null,
        price: page0?.pricing?.[0]?.cost ?? null,
        address: d.clientAddress || d?._source?.address || null,
        phone: d.contactPhone || d?._source?.phone || null,
        proposal_link: PROPOSAL_BASE_URL,
        attachments,
        timeline
      })
    } catch (err) {
      console.error('[crm-leads]', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ── PATCH /:id/status — set stage / owner (manual override) ──
  router.patch('/:id/status', auth, jsonBody, async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })

      const body = req.body || {}
      const patch = {}
      if (body.stage !== undefined && body.stage !== null) {
        if (!STAGES.includes(body.stage)) return res.status(400).json({ error: 'invalid stage' })
        patch.stage = body.stage
      }
      if (body.owner !== undefined) {
        const o = body.owner === null ? '' : String(body.owner).trim()
        patch.owner = o || null
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' })

      const { data: lead, error: lErr } = await supabase
        .from('leads')
        .select('id')
        .eq('id', id)
        .maybeSingle()
      if (lErr) throw lErr
      if (!lead) return res.status(404).json({ error: 'not found' })

      const now = new Date().toISOString()
      const { data: existing, error: exErr } = await supabase
        .from('crm_lead_status')
        .select('*')
        .eq('lead_id', id)
        .maybeSingle()
      if (exErr) throw exErr

      let row
      if (!existing) {
        const { data, error } = await supabase
          .from('crm_lead_status')
          .insert({ lead_id: id, stage: 'new', ...patch, updated_at: now, last_activity_at: now })
          .select('*')
          .single()
        if (error) throw error
        row = data
      } else {
        const { data, error } = await supabase
          .from('crm_lead_status')
          .update({ ...patch, updated_at: now, last_activity_at: now })
          .eq('lead_id', id)
          .select('*')
          .single()
        if (error) throw error
        row = data
      }

      if (patch.stage) await autoStopFollowUpsIfClosed(id, patch.stage)

      res.json(row)
    } catch (err) {
      console.error('[crm-leads]', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
