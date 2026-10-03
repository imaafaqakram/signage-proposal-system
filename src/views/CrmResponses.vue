<!-- Author: Burhan -->
<!--
  Luminus CRM — Phase 2: Responses dashboard (view)
  Route to register:
    { path: '/crm/responses', name: 'crm-responses',
      component: () => import('./views/CrmResponses.vue') }

  Reads:  /api/crm/stats/overview , /api/crm/stats/timeseries?days=30 , /api/crm/stats/needs-reply
  "Waiting on you" rows link into the inbox view via ?thread=<id> (wiring owned by the inbox).
-->
<script setup>
import { useCrmThemeStore } from '@/stores/crmThemeStore'
import { useInboxUnread } from '@/composables/useInboxUnread'
import CrmUserChip from '@/components/crm/CrmUserChip.vue'
import CrmTeamLink from '@/components/crm/CrmTeamLink.vue'
import CrmBroadcastLink from '@/components/crm/CrmBroadcastLink.vue'

const crmTheme = useCrmThemeStore()
const { unreadCount } = useInboxUnread()
import { ref, computed, onMounted } from 'vue'

/* ------------------------------------------------------------------ auth + fetch */
const token = () => sessionStorage.getItem('admin_bypass_token') || ''
const api = (path, opts = {}) =>
  fetch(`/api/crm${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) } })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j })

/* ------------------------------------------------------------------ state */
const loading = ref(true)
const err = ref('')
const overview = ref(null)
const series = ref([])
const needsReply = ref([])
const refreshedAt = ref(null)

async function load() {
  loading.value = true
  err.value = ''
  try {
    const [ov, ts, nr] = await Promise.all([
      api('/stats/overview'),
      api('/stats/timeseries?days=30'),
      api('/stats/needs-reply'),
    ])
    overview.value = ov
    series.value = (ts && ts.days) || []
    needsReply.value = (nr && nr.rows) || (Array.isArray(nr) ? nr : [])
    refreshedAt.value = new Date()
  } catch (e) {
    err.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

/* ------------------------------------------------------------------ formatting */
function fmtNum(v) {
  if (v == null) return '0'
  return Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1)
}
function fmtDay(s) {
  if (!s) return ''
  const p = String(s).split('-')
  return p.length === 3 ? `${+p[1]}/${+p[2]}` : s
}
function fmtHours(v) {
  return v == null ? '—' : `${fmtNum(v)}h`
}
function fmtWait(h) {
  if (h == null) return 'waiting'
  const t = Math.max(0, h)
  const d = Math.floor(t / 24)
  const r = Math.round(t - d * 24)
  return d > 0 ? `waiting ${d}d ${r}h` : `waiting ${r}h`
}
function niceCeil(v) {
  if (v <= 1) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  for (const s of [1, 2, 3, 4, 5, 6, 8, 10]) if (v <= s * pow) return s * pow
  return 10 * pow
}

/* ------------------------------------------------------------------ stat tiles */
const tiles = computed(() => {
  const o = overview.value || {}
  return [
    { label: 'Response rate', value: `${o.response_rate ?? 0}%`, sub: `${o.won ?? 0} won · ${o.lost ?? 0} lost` },
    { label: 'Replied', value: String(o.responded ?? 0), sub: `of ${o.proposals_sent ?? 0} proposals sent` },
    { label: 'Waiting on you', value: String(o.waiting_on_us ?? 0), sub: 'threads need a reply', amber: (o.waiting_on_us ?? 0) > 0 },
    { label: 'Unread', value: String(o.unread ?? 0), sub: 'inbound messages' },
    { label: 'Avg. first response', value: fmtHours(o.avg_first_response_hours), sub: 'send → first reply' },
  ]
})

/* ------------------------------------------------------------------ hand-built SVG chart */
const CH = { w: 720, h: 240, padL: 38, padR: 14, padT: 18, padB: 30 }

const chart = computed(() => {
  const days = series.value || []
  const plotW = CH.w - CH.padL - CH.padR
  const plotH = CH.h - CH.padT - CH.padB
  const x0 = CH.padL
  const yBase = CH.padT + plotH
  const n = Math.max(days.length, 1)
  const slotW = plotW / n

  const rawMax = days.reduce((m, d) => Math.max(m, d.proposals_sent || 0, d.replies || 0), 0)
  const empty = rawMax === 0
  const yMax = empty ? 1 : niceCeil(rawMax)
  const sy = (v) => yBase - (v / yMax) * plotH

  const propW = Math.max(2, slotW * 0.6)
  const repW = Math.max(1.5, slotW * 0.34)
  const bars = days.map((d, i) => {
    const cx = x0 + slotW * i + slotW / 2
    const p = d.proposals_sent || 0
    const r = d.replies || 0
    return {
      key: d.date,
      pX: cx - propW / 2, pW: propW, pY: sy(p), pH: Math.max(0, yBase - sy(p)),
      rX: cx - repW / 2, rW: repW, rY: sy(r), rH: Math.max(0, yBase - sy(r)),
    }
  })

  const gridVals = empty ? [0] : [0, yMax / 2, yMax]
  const grid = gridVals.map((v) => ({ y: sy(v), label: fmtNum(v) }))

  const xLabels = days
    .map((d, i) => ({ x: x0 + slotW * i + slotW / 2, label: fmtDay(d.date), i }))
    .filter((l) => l.i % 5 === 0)

  return { ...CH, x0, yBase, bars, grid, xLabels, empty }
})
</script>

<template>
  <div class="crm">
    <div class="crm-top">
      <div class="crm-brand"><span class="dot"></span> Luminus CRM</div>
      <nav class="crm-nav">
        <router-link :to="{ name: 'crm' }">Inbox<span v-if="unreadCount" class="nav-unread-badge">{{ unreadCount }}</span></router-link>
        <router-link :to="{ name: 'crm-leads' }">Leads</router-link>
        <router-link :to="{ name: 'crm-responses' }">Responses</router-link>
        <router-link :to="{ name: 'crm-pipeline' }">Pipeline</router-link>
        <router-link :to="{ name: 'crm-projects' }">Projects</router-link>
        <router-link :to="{ name: 'crm-automation' }">Automation</router-link>
        <router-link :to="{ name: 'crm-orders' }">Orders</router-link>
        <router-link :to="{ name: 'crm-finance' }">Finance</router-link>
        <router-link :to="{ name: 'crm-materials' }">Materials</router-link>
        <router-link :to="{ name: 'crm-vendors' }">Vendors</router-link>
        <router-link :to="{ name: 'crm-templates' }">Templates</router-link>
        <CrmBroadcastLink />
        <CrmTeamLink />
      </nav>
      <button class="crm-theme-toggle" @click="crmTheme.toggle()" :title="crmTheme.theme === 'pro' ? 'Switch to Light theme' : 'Switch to Pro theme'">
        <i class="fas" :class="crmTheme.theme === 'pro' ? 'fa-sun' : 'fa-moon'"></i>
      </button>
      <CrmUserChip />
      <div class="spacer"></div>
      <span v-if="refreshedAt" class="stamp">updated {{ refreshedAt.toLocaleTimeString() }}</span>
      <button class="btn" :disabled="loading" @click="load">{{ loading ? 'Loading…' : 'Refresh' }}</button>
    </div>

    <div class="crm-body">
      <div v-if="err" class="err">Couldn’t load the dashboard: {{ err }}</div>

      <div v-if="!overview && loading" class="loading">Loading dashboard…</div>

      <template v-else-if="overview">
        <!-- stat tiles -->
        <div class="tiles">
          <div v-for="t in tiles" :key="t.label" class="tile" :class="{ amber: t.amber }">
            <div class="tile-label">{{ t.label }}</div>
            <div class="tile-value">{{ t.value }}</div>
            <div class="tile-sub">{{ t.sub }}</div>
          </div>
        </div>

        <!-- proposals vs replies chart -->
        <div class="card">
          <div class="card-head">
            <span class="card-title">Proposals sent vs. replies — last 30 days</span>
            <span class="legend">
              <span class="lg"><i class="sw sw-prop"></i>Proposals sent</span>
              <span class="lg"><i class="sw sw-rep"></i>Replies</span>
            </span>
          </div>
          <svg
            class="chart"
            :viewBox="`0 0 ${chart.w} ${chart.h}`"
            width="100%"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Proposals sent versus replies per day over the last 30 days"
          >
            <!-- gridlines + y labels -->
            <g v-for="(g, gi) in chart.grid" :key="'g' + gi">
              <line
                :x1="chart.x0" :y1="g.y" :x2="chart.w - 14" :y2="g.y"
                stroke="var(--crm-border-header)" stroke-width="1" fill="none"
              />
              <text :x="chart.x0 - 6" :y="g.y + 3" text-anchor="end" fill="var(--crm-text-muted)" class="axis">{{ g.label }}</text>
            </g>

            <!-- bars -->
            <template v-if="!chart.empty">
              <g v-for="b in chart.bars" :key="b.key">
                <rect :x="b.pX" :y="b.pY" :width="b.pW" :height="b.pH" fill="var(--crm-accent)" fill-opacity="0.5" />
                <rect :x="b.rX" :y="b.rY" :width="b.rW" :height="b.rH" fill="var(--crm-success)" />
              </g>
            </template>
            <text
              v-else
              :x="chart.w / 2" :y="chart.yBase - 40"
              text-anchor="middle" fill="var(--crm-text-muted)" class="axis empty-note"
            >No activity yet</text>

            <!-- x axis -->
            <line
              :x1="chart.x0" :y1="chart.yBase" :x2="chart.w - 14" :y2="chart.yBase"
              stroke="var(--crm-border-strong)" stroke-width="1" fill="none"
            />
            <text
              v-for="(l, li) in chart.xLabels" :key="'x' + li"
              :x="l.x" :y="chart.yBase + 16"
              text-anchor="middle" fill="var(--crm-text-muted)" class="axis"
            >{{ l.label }}</text>
          </svg>
        </div>

        <!-- waiting on you -->
        <div class="card">
          <div class="card-head">
            <span class="card-title">Waiting on you</span>
            <span class="count">{{ needsReply.length }}</span>
          </div>

          <div v-if="!needsReply.length" class="empty">Nothing waiting — you’re all caught up.</div>

          <router-link
            v-for="row in needsReply"
            :key="row.thread_id"
            class="wrow"
            :to="{ name: 'crm', query: { thread: row.thread_id } }"
          >
            <div class="wmain">
              <div class="wline1">
                <span class="wname">{{ row.lead_name || row.counterparty || 'Unknown lead' }}</span>
                <span v-if="row.counterparty" class="wcp">{{ row.counterparty }}</span>
              </div>
              <div class="wsnip">{{ row.snippet || row.subject || '—' }}</div>
            </div>
            <div class="wwait" :class="{ hot: (row.waiting_hours || 0) > 48 }">
              {{ fmtWait(row.waiting_hours) }}
            </div>
          </router-link>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.crm {
  position: fixed;
  inset: 0;
  background: var(--crm-bg);
  color: var(--crm-text);
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* top bar */
.crm-top {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--crm-border-header);
  background: var(--crm-header-bg);
  flex: none;
}
.crm-brand { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.crm-brand .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--crm-accent); box-shadow: 0 0 8px rgba(0, 243, 255, .7), 0 0 2px var(--crm-accent); }
.crm-sub { color: var(--crm-text-muted); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
.crm-nav { display: flex; gap: 4px; }
.crm-nav a { font-size: 12.5px; font-weight: 600; color: var(--crm-text-muted); text-decoration: none; padding: 5px 11px; border-radius: 6px; }
.crm-nav a:hover { color: var(--crm-text); background: var(--crm-hover-bg); }
.crm-theme-toggle { background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; flex: none; }
.crm-theme-toggle:hover { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
.crm-nav a.router-link-exact-active { color: var(--crm-accent); background: var(--crm-accent-soft-bg); }
.spacer { flex: 1; }
.stamp { color: var(--crm-text-dim); font-size: 12px; }
.btn {
  background: var(--crm-hover-bg);
  border: 1px solid var(--crm-border-strong);
  color: var(--crm-text-soft);
  border-radius: 6px;
  padding: 6px 13px;
  font-size: 13px;
  cursor: pointer;
}
.btn:hover:not(:disabled) { border-color: var(--crm-accent); }
.btn:disabled { opacity: 0.55; cursor: default; }

/* body */
.crm-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.err {
  background: var(--crm-danger-bg);
  border: 1px solid var(--crm-danger);
  color: var(--crm-danger);
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 13px;
}
.loading { color: var(--crm-text-muted); font-size: 14px; text-align: center; padding: 48px 0; }

/* stat tiles */
.tiles { display: flex; flex-wrap: wrap; gap: 12px; }
.tile {
  flex: 1 1 158px;
  min-width: 158px;
  background: var(--crm-header-bg);
  border-radius: 8px;
  padding: 16px 18px;
}
.tile.amber { background: var(--crm-warn-bg); }
.tile-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--crm-text-muted); }
.tile-value { font-size: 26px; font-weight: 600; margin-top: 6px; line-height: 1.1; }
.tile.amber .tile-value { color: var(--crm-warn); }
.tile-sub { font-size: 12px; color: var(--crm-text-dim); margin-top: 5px; }

/* cards */
.card { background: var(--crm-header-bg); border-radius: 8px; padding: 16px 18px; }
.card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--crm-text-soft); }
.count {
  margin-left: auto;
  background: var(--crm-hover-bg);
  color: var(--crm-text-muted);
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 12px;
}
.legend { margin-left: auto; display: flex; gap: 14px; font-size: 11px; color: var(--crm-text-muted); }
.lg { display: flex; align-items: center; gap: 5px; }
.sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.sw-prop { background: var(--crm-accent); opacity: 0.5; }
.sw-rep { background: var(--crm-success); }

/* chart */
.chart { display: block; width: 100%; height: auto; }
.axis { font-size: 10px; }
.empty-note { font-size: 12px; }

/* waiting-on-you list */
.wrow {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 8px;
  border-top: 1px solid var(--crm-hover-bg);
  text-decoration: none;
  color: inherit;
}
.wrow:first-of-type { border-top: none; }
.wrow:hover { background: var(--crm-panel-bg); }
.wmain { min-width: 0; flex: 1; }
.wline1 { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.wname { font-weight: 600; font-size: 13px; color: var(--crm-text); white-space: nowrap; }
.wcp {
  font-size: 12px;
  color: var(--crm-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wsnip {
  font-size: 12px;
  color: var(--crm-text-dim);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wwait { font-size: 12px; color: var(--crm-text-muted); white-space: nowrap; flex: none; }
.wwait.hot { color: var(--crm-danger); }
.empty { color: var(--crm-text-muted); font-size: 13px; padding: 12px 8px; }
</style>
