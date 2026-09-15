// Author: Burhan
//
// Luminus CRM — Phase 2: Responses dashboard (backend)
// Mounted as: app.use('/api/crm/stats', createCrmStatsRouter({ requireAuth }))
//
// Read-only aggregation endpoints over the crm_* tables + leads.
// All queries go through the shared Supabase client and are paginated where
// an unbounded row scan is possible (Supabase caps a single select at ~1000 rows).

import express from 'express'
import { _crmSupabase as supabase } from './crm-db.js'

const HOUR_MS = 3600000

// Bounce / robot / system senders — these land in the inbox but are never a
// client we owe a reply to, so they're kept out of "waiting on you".
const NOISE_SENDER = /(mailer-daemon|postmaster|no-?reply|do-?not-?reply|@(.*\.)?hostinger\.|wordpress@|notifications?@)/i

// A thread the client last touched more than this long ago is a cold lead, not
// an open action item — keep it out of "waiting on you" / "needs reply".
const WAITING_WINDOW_DAYS = 45

/**
 * Page through a Supabase select in 1000-row chunks.
 * `build` must return a *fresh* query builder each call (so .range() can be applied).
 */
async function selectAll(build) {
  const pageSize = 1000
  let from = 0
  const rows = []
  for (;;) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return rows
}

/** YYYY-MM-DD for a timestamp, in UTC. */
function utcDateKey(value) {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export function createCrmStatsRouter({ requireAuth }) {
  const router = express.Router()

  // Auth on every route in this router.
  if (typeof requireAuth === 'function') router.use(requireAuth)

  // ---------------------------------------------------------------------------
  // GET /overview
  // ---------------------------------------------------------------------------
  router.get('/overview', async (_req, res) => {
    try {
      // proposals_sent — leads that have actually been emailed.
      const { count: proposalsSentCount, error: propErr } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .not('email_sent_at', 'is', null)
      if (propErr) throw propErr
      const proposalsSent = proposalsSentCount || 0

      // responded — distinct lead_id among genuine inbound messages (no auto-replies).
      const inboundRows = await selectAll(() =>
        supabase
          .from('crm_messages')
          .select('lead_id')
          .eq('direction', 'inbound')
          .eq('is_auto_reply', false),
      )
      const respondedLeadIds = new Set()
      for (const r of inboundRows) if (r.lead_id != null) respondedLeadIds.add(r.lead_id)
      const responded = respondedLeadIds.size

      // response_rate — % of sent proposals that got a real reply (1 dp, div-by-zero → 0).
      const responseRate =
        proposalsSent > 0 ? Math.round((responded / proposalsSent) * 1000) / 10 : 0

      // waiting_on_us — non-archived threads whose last message came from the
      // counterparty in the last WAITING_WINDOW_DAYS, minus bounce/robot senders.
      // Older than that and the lead is cold — it's not an "act now" item.
      const waitingSince = new Date(Date.now() - WAITING_WINDOW_DAYS * 864e5).toISOString()
      const waitingRows = await selectAll(() =>
        supabase
          .from('crm_threads')
          .select('counterparty')
          .neq('status', 'archived')
          .eq('last_direction', 'inbound')
          .gte('last_message_at', waitingSince),
      )
      const waitingOnUs = waitingRows.filter((r) => !NOISE_SENDER.test(r.counterparty || '')).length

      // unread — sum of per-thread unread counters.
      const unreadRows = await selectAll(() =>
        supabase.from('crm_threads').select('unread_count'),
      )
      const unread = unreadRows.reduce((sum, r) => sum + (Number(r.unread_count) || 0), 0)

      // crm_lead_status — used for avg first response + won/lost.
      const statusRows = await selectAll(() =>
        supabase.from('crm_lead_status').select('lead_id, stage, first_response_at'),
      )

      // avg_first_response_hours — mean of (first_response_at − leads.email_sent_at).
      let avgFirstResponseHours = null
      const withFirstResponse = statusRows.filter((r) => r.first_response_at && r.lead_id != null)
      if (withFirstResponse.length) {
        const leadIds = [...new Set(withFirstResponse.map((r) => r.lead_id))]
        const leadRows = await selectAll(() =>
          supabase.from('leads').select('id, email_sent_at').in('id', leadIds),
        )
        const sentAtById = new Map(leadRows.map((r) => [r.id, r.email_sent_at]))
        const diffsHours = []
        for (const r of withFirstResponse) {
          const sentAt = sentAtById.get(r.lead_id)
          if (!sentAt) continue
          const deltaMs = new Date(r.first_response_at).getTime() - new Date(sentAt).getTime()
          if (Number.isFinite(deltaMs) && deltaMs >= 0) diffsHours.push(deltaMs / HOUR_MS)
        }
        if (diffsHours.length) {
          const mean = diffsHours.reduce((a, b) => a + b, 0) / diffsHours.length
          avgFirstResponseHours = Math.round(mean * 10) / 10
        }
      }

      // won / lost — straight stage tally.
      let won = 0
      let lost = 0
      for (const r of statusRows) {
        if (r.stage === 'won') won++
        else if (r.stage === 'lost') lost++
      }

      res.json({
        proposals_sent: proposalsSent,
        responded,
        response_rate: responseRate,
        waiting_on_us: waitingOnUs,
        unread,
        avg_first_response_hours: avgFirstResponseHours,
        won,
        lost,
      })
    } catch (err) {
      console.error('[crm-stats]', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ---------------------------------------------------------------------------
  // GET /timeseries?days=30   (days clamped to 7..120)
  // ---------------------------------------------------------------------------
  router.get('/timeseries', async (req, res) => {
    try {
      let days = parseInt(req.query.days, 10)
      if (!Number.isFinite(days)) days = 30
      days = Math.max(7, Math.min(120, days))

      // UTC calendar-day window: [start-of-day (days-1 ago), start-of-tomorrow).
      const now = new Date()
      const todayStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      )
      const windowStart = new Date(todayStart)
      windowStart.setUTCDate(windowStart.getUTCDate() - (days - 1))
      const windowEnd = new Date(todayStart)
      windowEnd.setUTCDate(windowEnd.getUTCDate() + 1)

      const startIso = windowStart.toISOString()
      const endIso = windowEnd.toISOString()

      // Zero-filled buckets, one per calendar day, in order.
      const order = []
      const bucket = new Map()
      for (let i = 0; i < days; i++) {
        const d = new Date(windowStart)
        d.setUTCDate(d.getUTCDate() + i)
        const key = d.toISOString().slice(0, 10)
        order.push(key)
        bucket.set(key, { date: key, proposals_sent: 0, replies: 0 })
      }

      // proposals_sent — leads.email_sent_at within the window.
      const leadRows = await selectAll(() =>
        supabase
          .from('leads')
          .select('email_sent_at')
          .gte('email_sent_at', startIso)
          .lt('email_sent_at', endIso),
      )
      for (const r of leadRows) {
        const key = utcDateKey(r.email_sent_at)
        const b = key && bucket.get(key)
        if (b) b.proposals_sent++
      }

      // replies — real inbound crm_messages, bucketed by sent_at.
      const msgRows = await selectAll(() =>
        supabase
          .from('crm_messages')
          .select('sent_at')
          .eq('direction', 'inbound')
          .eq('is_auto_reply', false)
          .gte('sent_at', startIso)
          .lt('sent_at', endIso),
      )
      for (const r of msgRows) {
        const key = utcDateKey(r.sent_at)
        const b = key && bucket.get(key)
        if (b) b.replies++
      }

      res.json({ days: order.map((k) => bucket.get(k)) })
    } catch (err) {
      console.error('[crm-stats]', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ---------------------------------------------------------------------------
  // GET /needs-reply
  // Non-archived threads awaiting our reply, longest-waiting first, max 50.
  // ---------------------------------------------------------------------------
  router.get('/needs-reply', async (_req, res) => {
    try {
      const needsReplySince = new Date(Date.now() - WAITING_WINDOW_DAYS * 864e5).toISOString()
      const { data: threadsData, error: threadErr } = await supabase
        .from('crm_threads')
        .select('id, lead_id, subject, counterparty, last_message_at')
        .neq('status', 'archived')
        .eq('last_direction', 'inbound')
        .gte('last_message_at', needsReplySince)
        .order('last_message_at', { ascending: true, nullsFirst: true })
        .limit(120)
      if (threadErr) throw threadErr
      // Drop bounce/robot senders up front; the rest get an auto-reply check below.
      const threads = (threadsData || []).filter((t) => !NOISE_SENDER.test(t.counterparty || ''))

      const threadIds = threads.map((t) => t.id)
      const leadIds = [...new Set(threads.map((t) => t.lead_id).filter((v) => v != null))]

      // Batch: lead names.
      const leadNameById = new Map()
      if (leadIds.length) {
        const leadRows = await selectAll(() =>
          supabase.from('leads').select('id, client_name').in('id', leadIds),
        )
        for (const r of leadRows) leadNameById.set(r.id, r.client_name)
      }

      // Batch: newest inbound snippet + auto-reply flag per thread.
      const snippetByThread = new Map()
      const autoByThread = new Map()
      if (threadIds.length) {
        const msgRows = await selectAll(() =>
          supabase
            .from('crm_messages')
            .select('thread_id, snippet, sent_at, is_auto_reply')
            .eq('direction', 'inbound')
            .in('thread_id', threadIds)
            .order('sent_at', { ascending: false, nullsFirst: false })
            .order('id', { ascending: false }),
        )
        for (const m of msgRows) {
          if (!snippetByThread.has(m.thread_id)) {
            snippetByThread.set(m.thread_id, m.snippet || '')
            autoByThread.set(m.thread_id, !!m.is_auto_reply)
          }
        }
      }

      const nowMs = Date.now()
      const rows = threads
        .filter((t) => !autoByThread.get(t.id)) // last thing they sent was an OOO/auto-reply — nothing to answer
        .slice(0, 50)
        .map((t) => {
        const lastMs = t.last_message_at ? new Date(t.last_message_at).getTime() : null
        const waitingHours =
          lastMs != null && Number.isFinite(lastMs)
            ? Math.max(0, Math.round(((nowMs - lastMs) / HOUR_MS) * 10) / 10)
            : null
        return {
          thread_id: t.id,
          subject: t.subject || '',
          counterparty: t.counterparty || '',
          last_message_at: t.last_message_at || null,
          waiting_hours: waitingHours,
          lead_name: leadNameById.get(t.lead_id) || null,
          snippet: snippetByThread.get(t.id) || '',
        }
      })

      res.json({ rows })
    } catch (err) {
      console.error('[crm-stats]', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
