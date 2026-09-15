<template>
  <div class="min-h-screen bg-gray-900 p-8">
    <div class="max-w-4xl mx-auto">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-3xl font-bold text-white mb-2">Dashboard</h1>
          <p class="text-gray-400">Fetch activity, batch history, API usage</p>
        </div>
        <router-link
          to="/"
          class="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-700 transition-colors flex items-center gap-2"
        >
          <i class="fas fa-arrow-left"></i>
          Back to Editor
        </router-link>
      </div>

      <div class="space-y-6">
        <!-- AUTOMATED FETCH SCHEDULE -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <i class="fas fa-clock text-teal-400"></i>
            Automated Fetch Schedule
          </h2>

          <div v-if="scheduleError" class="text-sm text-red-400 mb-3">{{ scheduleError }}</div>

          <div v-if="schedule" class="flex flex-wrap items-center gap-4 mb-4">
            <button @click="toggleScheduleEnabled" :disabled="scheduleSaving"
                    class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                    :class="schedule.enabled ? 'bg-teal-700 hover:bg-teal-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'">
              <i class="fas" :class="schedule.enabled ? 'fa-toggle-on' : 'fa-toggle-off'"></i>
              {{ schedule.enabled ? 'Running' : 'Stopped' }}
            </button>

            <div class="flex items-center gap-2 text-sm text-gray-300">
              <span>Runs daily at</span>
              <select v-model.number="scheduleHour" @change="saveSchedule" :disabled="scheduleSaving"
                      class="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white">
                <option v-for="h in 24" :key="h-1" :value="h-1">{{ String(h-1).padStart(2,'0') }}</option>
              </select>
              <span>:</span>
              <select v-model.number="scheduleMinute" @change="saveSchedule" :disabled="scheduleSaving"
                      class="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white">
                <option v-for="m in [0,5,10,15,20,25,30,35,40,45,50,55]" :key="m" :value="m">{{ String(m).padStart(2,'0') }}</option>
              </select>
              <span class="text-gray-500">ET (America/New_York)</span>
            </div>
          </div>

          <div class="text-sm text-gray-400 space-y-1">
            <div v-if="lastAutomatedBatch">
              Last run: {{ formatTime(lastAutomatedBatch.createdAt) }} — {{ lastAutomatedBatch.total }} lead(s) found and saved.
              <button @click="loadBatch(lastAutomatedBatch.batchId)" class="ml-1 text-teal-400 hover:text-teal-300 underline">Load into Review Queue</button>
            </div>
            <div v-else class="text-gray-500">No automated fetch has run yet.</div>
            <div class="text-xs text-gray-500">Checked every 5 minutes — a schedule change here takes effect on the next check, no restart needed. Pulls the <em>previous</em> day's leads.</div>
          </div>
        </div>

        <!-- BATCH HISTORY -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-semibold text-white flex items-center gap-2">
              <i class="fas fa-layer-group text-teal-400"></i>
              Batch History
            </h2>
            <button @click="loadBatches" :disabled="batchesLoading" class="text-gray-400 hover:text-gray-200" title="Refresh">
              <i class="fas fa-rotate text-sm" :class="{ 'fa-spin': batchesLoading }"></i>
            </button>
          </div>
          <div v-if="batchesError" class="text-sm text-red-400">{{ batchesError }}</div>
          <div v-else-if="batches.length === 0" class="text-sm text-gray-500">No fetches recorded yet.</div>
          <div v-else class="space-y-2">
            <div v-for="b in batches" :key="b.batchId"
                 class="bg-gray-700/60 rounded-lg p-3 flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm text-white flex items-center gap-2">
                  {{ formatTime(b.createdAt) }}
                  <span v-if="b.isAutomated" class="text-[10px] px-1.5 py-0.5 rounded bg-teal-700 text-teal-100">auto</span>
                </div>
                <div class="text-xs text-gray-400 mt-0.5">
                  {{ b.total }} lead(s) —
                  <span v-for="(count, alias) in b.bySource" :key="alias" class="mr-1.5">{{ alias }}: {{ count }}</span>
                </div>
              </div>
              <div class="flex gap-2 flex-shrink-0">
                <button @click="downloadBatch(b.batchId)" class="text-xs px-2.5 py-1 rounded bg-gray-600 hover:bg-gray-500 text-white">
                  Download JSON
                </button>
                <button @click="loadBatch(b.batchId)" class="text-xs px-2.5 py-1 rounded bg-teal-700 hover:bg-teal-600 text-white">
                  Load into Queue
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- API USAGE -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <i class="fas fa-chart-simple text-teal-400"></i>
            API Usage
          </h2>
          <div v-if="usageError" class="text-sm text-red-400">{{ usageError }}</div>
          <table v-else-if="usage" class="w-full text-sm text-gray-300">
            <thead>
              <tr class="text-left text-gray-500">
                <th class="font-normal pb-1"></th>
                <th class="font-normal pb-1 text-right">Airtable</th>
                <th class="font-normal pb-1 text-right">Gemini</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="text-gray-400 py-0.5">Today</td><td class="text-right">{{ usage.today.airtable }}</td><td class="text-right">{{ usage.today.gemini }}</td></tr>
              <tr><td class="text-gray-400 py-0.5">This week</td><td class="text-right">{{ usage.week.airtable }}</td><td class="text-right">{{ usage.week.gemini }}</td></tr>
              <tr><td class="text-gray-400 py-0.5">All time</td><td class="text-right">{{ usage.allTime.airtable }}</td><td class="text-right">{{ usage.allTime.gemini }}</td></tr>
            </tbody>
          </table>
        </div>

        <!-- RECENT API CALLS — every individual call, not just the aggregate counts above -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-semibold text-white flex items-center gap-2">
              <i class="fas fa-list text-teal-400"></i>
              Recent API Calls
              <span class="text-xs font-normal text-gray-500" v-if="callLogTotal">({{ callLogTotal }} total logged)</span>
            </h2>
            <button @click="loadCallLog" :disabled="callLogLoading" class="text-gray-400 hover:text-gray-200" title="Refresh">
              <i class="fas fa-rotate text-sm" :class="{ 'fa-spin': callLogLoading }"></i>
            </button>
          </div>
          <div v-if="callLogError" class="text-sm text-red-400">{{ callLogError }}</div>
          <div v-else-if="callLog.length === 0" class="text-sm text-gray-500">No calls logged yet.</div>
          <div v-else class="max-h-96 overflow-y-auto">
            <table class="w-full text-xs text-gray-300">
              <thead class="sticky top-0 bg-gray-800">
                <tr class="text-left text-gray-500 border-b border-gray-700">
                  <th class="font-normal py-1.5">Time</th>
                  <th class="font-normal py-1.5 text-right">Type</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(call, i) in callLog" :key="i" class="border-b border-gray-800/60">
                  <td class="py-1 text-gray-400 font-mono">{{ formatCallTime(call.ts) }}</td>
                  <td class="py-1 text-right">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                          :class="call.kind === 'gemini' ? 'bg-purple-900/50 text-purple-300' : 'bg-blue-900/50 text-blue-300'">
                      {{ call.kind }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProposalStore } from '@/stores/proposalStore'
import { showToast } from '@/utils/toast'

const router = useRouter()
const proposalStore = useProposalStore()

const batches = ref([])
const batchesLoading = ref(false)
const batchesError = ref('')
const usage = ref(null)
const usageError = ref('')
const callLog = ref([])
const callLogTotal = ref(0)
const callLogLoading = ref(false)
const callLogError = ref('')

const schedule = ref(null)
const scheduleHour = ref(5)
const scheduleMinute = ref(0)
const scheduleSaving = ref(false)
const scheduleError = ref('')

// Most recent automated run ever, not just today's — a schedule that's been off for a
// few days shouldn't make this panel look like automation has never run at all.
const lastAutomatedBatch = computed(() => {
  return batches.value.find((b) => b.isAutomated) || null
})

const formatTime = (iso) => new Date(iso).toLocaleString()
const formatCallTime = (ts) => new Date(ts * 1000).toLocaleString()

const loadBatches = async () => {
  batchesLoading.value = true
  batchesError.value = ''
  try {
    const response = await fetch('/api/leads/batches')
    const result = await response.json()
    if (!response.ok) throw new Error(result.details || result.error || 'Failed to load batches')
    batches.value = result.batches
  } catch (err) {
    batchesError.value = err.message
  } finally {
    batchesLoading.value = false
  }
}

const loadUsage = async () => {
  try {
    const response = await fetch('/api/usage-stats')
    const result = await response.json()
    if (!response.ok) throw new Error(result.details || result.error || 'Failed to load usage')
    usage.value = result
  } catch (err) {
    usageError.value = err.message
  }
}

const loadCallLog = async () => {
  callLogLoading.value = true
  callLogError.value = ''
  try {
    const response = await fetch('/api/usage-log?limit=300')
    const result = await response.json()
    if (!response.ok) throw new Error(result.details || result.error || 'Failed to load call log')
    callLog.value = result.calls
    callLogTotal.value = result.total
  } catch (err) {
    callLogError.value = err.message
  } finally {
    callLogLoading.value = false
  }
}

const loadSchedule = async () => {
  scheduleError.value = ''
  try {
    const response = await fetch('/api/schedule-config')
    const result = await response.json()
    if (!response.ok) throw new Error(result.details || result.error || 'Failed to load schedule')
    schedule.value = result
    scheduleHour.value = result.hour
    scheduleMinute.value = result.minute
  } catch (err) {
    scheduleError.value = err.message
  }
}

const saveSchedule = async (overrides = {}) => {
  scheduleSaving.value = true
  scheduleError.value = ''
  try {
    const body = { hour: scheduleHour.value, minute: scheduleMinute.value, ...overrides }
    const response = await fetch('/api/schedule-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.details || result.error || 'Failed to save schedule')
    schedule.value = result
    showToast('Schedule updated', 'success', 3000)
  } catch (err) {
    scheduleError.value = err.message
    showToast(`Schedule update failed: ${err.message}`, 'error', 6000)
  } finally {
    scheduleSaving.value = false
  }
}

const toggleScheduleEnabled = () => saveSchedule({ enabled: !schedule.value.enabled })

// Full export — images included, for an actual backup/download file.
const fetchBatchExport = async (batchId) => {
  const response = await fetch(`/api/leads/batches/${encodeURIComponent(batchId)}/export`)
  const result = await response.json()
  if (!response.ok) throw new Error(result.details || result.error || 'Failed to export batch')
  return result.leads
}

// Lightweight preview — no images, just what's needed to populate the review queue list.
// A real automated batch can be 50+ leads with several MB of embedded images each; loading
// all of that just to show a list of names is what used to make this request come back as
// a truncated, unparseable JSON error on a big batch.
const fetchBatchQueuePreview = async (batchId) => {
  const response = await fetch(`/api/leads/batches/${encodeURIComponent(batchId)}/queue-preview`)
  const result = await response.json()
  if (!response.ok) throw new Error(result.details || result.error || 'Failed to load batch')
  return result.leads
}

const downloadBatch = async (batchId) => {
  try {
    const leads = await fetchBatchExport(batchId)
    const blob = new Blob([JSON.stringify(leads, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `batch-${batchId}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    showToast(`Download failed: ${err.message}`, 'error', 6000)
  }
}

const loadBatch = async (batchId) => {
  try {
    const leads = await fetchBatchQueuePreview(batchId)
    const result = proposalStore.importBatch(leads)
    showToast(`Loaded ${result.count} client(s) into the review queue`, 'success', 4000)
    router.push('/')
  } catch (err) {
    showToast(`Load failed: ${err.message}`, 'error', 6000)
  }
}

onMounted(() => {
  loadBatches()
  loadUsage()
  loadCallLog()
  loadSchedule()
})
</script>
