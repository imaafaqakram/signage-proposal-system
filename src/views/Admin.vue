<template>
  <div class="min-h-screen bg-gray-900 p-8">
    <div class="max-w-4xl mx-auto">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-3xl font-bold text-white mb-2">Admin</h1>
          <p class="text-gray-400">Owner-only settings — not visible or reachable by employees</p>
        </div>
        <div class="flex items-center gap-3">
          <button v-if="adminAuth.isAuthenticated" @click="handleLogout"
                  class="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-700 transition-colors flex items-center gap-2">
            <i class="fas fa-sign-out-alt"></i>
            Log Out
          </button>
          <router-link to="/" class="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-700 transition-colors flex items-center gap-2">
            <i class="fas fa-arrow-left"></i>
            Back to Editor
          </router-link>
        </div>
      </div>

      <!-- LOGIN GATE -->
      <div v-if="!adminAuth.isAuthenticated" class="bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700 max-w-md mx-auto">
        <div v-if="loginError" class="mb-4 bg-red-900/30 border border-red-700 rounded-lg p-3">
          <p class="text-red-200 text-sm">{{ loginError }}</p>
        </div>
        <form @submit.prevent="handleLogin" class="space-y-4">
          <div>
            <label class="block text-gray-300 text-sm font-medium mb-2">Admin Password</label>
            <div class="flex items-center gap-2">
              <input v-model="loginPassword" :type="showLoginPassword ? 'text' : 'password'" placeholder="Enter admin password" required
                     class="flex-1 bg-gray-700 text-white px-4 py-3 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              <button type="button" @click="showLoginPassword = !showLoginPassword" class="text-gray-400 hover:text-gray-200 px-2">
                <i class="fas" :class="showLoginPassword ? 'fa-eye-slash' : 'fa-eye'"></i>
              </button>
            </div>
          </div>
          <button type="submit" :disabled="adminAuth.loading"
                  class="w-full bg-teal-600 hover:bg-teal-500 disabled:bg-gray-600 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center">
            <i v-if="adminAuth.loading" class="fas fa-spinner fa-spin mr-2"></i>
            {{ adminAuth.loading ? 'Verifying...' : 'Continue' }}
          </button>
        </form>
      </div>

      <!-- ADMIN PANEL -->
      <div v-else class="space-y-6">
        <div v-if="settingsError" class="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-200 text-sm">{{ settingsError }}</div>

        <div v-if="settings" class="space-y-6">
          <!-- ADMIN PASSWORD -->
          <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <i class="fas fa-key text-teal-400"></i>
              Admin Password
            </h2>
            <p class="text-gray-500 text-xs mb-3">This is the password on this page only — separate from the shared employee password used to open the proposal editor.</p>
            <div class="flex items-center gap-3">
              <input v-model="settings.adminPassword" :type="showAdminPassword ? 'text' : 'password'"
                     class="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none font-mono" />
              <button type="button" @click="showAdminPassword = !showAdminPassword" class="text-gray-400 hover:text-gray-200 px-2">
                <i class="fas" :class="showAdminPassword ? 'fa-eye-slash' : 'fa-eye'"></i>
              </button>
            </div>
            <p class="text-gray-500 text-xs mt-2">Minimum 8 characters. Changing this logs out any other admin session next time it checks in.</p>
          </div>

          <!-- NOTIFICATIONS -->
          <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <i class="fas fa-bell text-teal-400"></i>
              Internal Notifications
            </h2>
            <div class="space-y-4">
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">Notify Email (fetch-started, daily summary, crash alerts)</label>
                <input v-model="settings.notifyEmail" type="email"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">"From" Name on Outgoing Emails</label>
                <input v-model="settings.smtpFromName"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
            </div>
          </div>

          <!-- CLIENT CC -->
          <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <i class="fas fa-paper-plane text-teal-400"></i>
              Client Proposal Emails
            </h2>
            <div class="space-y-4">
              <label class="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" v-model="settings.clientCcEnabled" class="w-4 h-4 accent-teal-500" />
                <span class="text-gray-300 text-sm">CC this address on every proposal sent to a client</span>
              </label>
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">CC Email</label>
                <input v-model="settings.clientCcEmail" type="email" :disabled="!settings.clientCcEnabled"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none disabled:opacity-50" />
              </div>
            </div>
          </div>

          <!-- DAILY FETCH TUNING -->
          <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <i class="fas fa-clock-rotate-left text-teal-400"></i>
              Daily Automated Fetch
            </h2>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">Gap (days back)</label>
                <input v-model.number="settings.dailyFetchGapDays" type="number" min="1"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">Chunk Size</label>
                <input v-model.number="settings.dailyFetchChunkSize" type="number" min="1"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">Max / Source (0 = unlimited)</label>
                <input v-model.number="settings.dailyFetchMaxPerSource" type="number" min="0"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
            </div>
            <p class="text-gray-500 text-xs mt-3">The daily fetch script reads these directly on its next scheduled run — no restart needed.</p>
          </div>

          <!-- DISCOUNT PRESETS -->
          <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <i class="fas fa-percent text-teal-400"></i>
              Discount Presets
            </h2>
            <div class="flex flex-wrap items-center gap-2">
              <div v-for="(p, i) in settings.discountPresets" :key="i"
                   class="flex items-center gap-1 bg-gray-700 rounded-lg px-2 py-1">
                <input v-model.number="settings.discountPresets[i]" type="number" min="0" max="100"
                       class="w-14 bg-transparent text-white text-sm focus:outline-none text-right" />
                <span class="text-gray-400 text-sm">%</span>
                <button @click="settings.discountPresets.splice(i, 1)" class="text-red-400 hover:text-red-300 ml-1 text-xs">
                  <i class="fas fa-times"></i>
                </button>
              </div>
              <button @click="settings.discountPresets.push(0)"
                      class="bg-gray-700 hover:bg-gray-600 text-teal-400 text-sm px-3 py-1.5 rounded-lg border border-gray-600 border-dashed">
                <i class="fas fa-plus mr-1"></i>Add
              </button>
            </div>
            <p class="text-gray-500 text-xs mt-3">Shown as quick-pick buttons on every proposal's discount dropdown. "Custom" is always available in addition to these.</p>
          </div>

          <!-- FOLLOW-UP AUTOMATION -->
          <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-xl font-semibold text-white flex items-center gap-2">
                <i class="fas fa-repeat text-teal-400"></i>
                Client Follow-Up Reminders
              </h2>
              <label class="flex items-center gap-2 cursor-pointer">
                <span class="text-xs font-semibold" :class="settings.followUpEnabled ? 'text-teal-400' : 'text-gray-500'">
                  {{ settings.followUpEnabled ? 'ON' : 'OFF' }}
                </span>
                <input type="checkbox" v-model="settings.followUpEnabled" class="w-4 h-4 accent-teal-500" />
              </label>
            </div>
            <p class="text-gray-500 text-xs mb-4">
              Automatically re-emails every client who's already received a proposal, on a repeating schedule, until they reply, convert, or the sequence ends.
              Sent through the same email path (and same CC rule) as the original proposal — never a separate, less reliable one.
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">First reminder — days after original send</label>
                <input v-model.number="settings.followUpFirstDelayDays" type="number" min="1"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
              <div></div>
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">Then repeat every (min days)</label>
                <input v-model.number="settings.followUpIntervalMinDays" type="number" min="1"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">...to (max days)</label>
                <input v-model.number="settings.followUpIntervalMaxDays" type="number" min="1"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">Stop after (days total)</label>
                <input v-model.number="settings.followUpMaxDurationDays" type="number" min="1"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">Stop after (max emails)</label>
                <input v-model.number="settings.followUpMaxCount" type="number" min="1"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
            </div>
            <p class="text-gray-500 text-xs mt-3">
              Whichever limit is hit first — total days or total emails — ends that client's sequence. An employee can also stop it early for one specific client from the Saved Leads panel (the bell-slash icon).
            </p>
          </div>

          <!-- MISC -->
          <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <i class="fas fa-sliders text-teal-400"></i>
              Other
            </h2>
            <div class="space-y-4">
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">Proposal Phone Number</label>
                <input v-model="settings.proposalPhone"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
              <div>
                <label class="block text-gray-300 text-sm font-medium mb-2">Archive Retention (days)</label>
                <input v-model.number="settings.archiveRetentionDays" type="number" min="1"
                       class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none" />
              </div>
              <label class="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" v-model="settings.driveSyncEnabled" class="w-4 h-4 accent-teal-500" />
                <span class="text-gray-300 text-sm">Sync fetched leads' images/PDFs to Google Drive</span>
              </label>
            </div>
          </div>

          <!-- SAVE -->
          <button @click="saveSettings" :disabled="saving"
                  class="w-full bg-teal-600 hover:bg-teal-500 disabled:bg-gray-600 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center">
            <i class="fas mr-2" :class="saving ? 'fa-spinner fa-spin' : 'fa-save'"></i>
            {{ saving ? 'Saving...' : 'Save All Settings' }}
          </button>
        </div>

        <!-- SYSTEM HEALTH -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-semibold text-white flex items-center gap-2">
              <i class="fas fa-heart-pulse text-teal-400"></i>
              System Health
            </h2>
            <button @click="loadHealth" :disabled="healthLoading" class="text-gray-400 hover:text-gray-200" title="Refresh">
              <i class="fas fa-rotate text-sm" :class="{ 'fa-spin': healthLoading }"></i>
            </button>
          </div>
          <div v-if="healthError" class="text-sm text-red-400">{{ healthError }}</div>
          <div v-else-if="health" class="space-y-3 text-sm">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div class="bg-gray-700/60 rounded-lg p-3">
                <div class="text-gray-500 text-xs">Server Uptime</div>
                <div class="text-white">{{ formatUptime(health.uptimeSeconds) }}</div>
              </div>
              <div class="bg-gray-700/60 rounded-lg p-3">
                <div class="text-gray-500 text-xs">Memory Used</div>
                <div class="text-white">{{ health.memory.usedPercent }}% ({{ health.memory.totalMB - health.memory.freeMB }}/{{ health.memory.totalMB }} MB)</div>
              </div>
              <div class="bg-gray-700/60 rounded-lg p-3">
                <div class="text-gray-500 text-xs">Load Avg (1m)</div>
                <div class="text-white">{{ health.loadAvg[0].toFixed(2) }}</div>
              </div>
              <div class="bg-gray-700/60 rounded-lg p-3">
                <div class="text-gray-500 text-xs">Last Daily Fetch</div>
                <div :class="lastFetchClass">{{ lastFetchLabel }}</div>
              </div>
            </div>
            <div v-if="health.lastFetch" class="text-gray-400 text-xs">
              {{ health.lastFetch.date }} — {{ health.lastFetch.total }} lead(s), updated {{ formatTime(health.lastFetch.updatedAt) }}
              <span v-if="health.lastFetch.error"> — {{ health.lastFetch.error }}</span>
            </div>
          </div>
        </div>

        <!-- EMPLOYEE ACTIVITY -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-semibold text-white flex items-center gap-2">
              <i class="fas fa-user-secret text-teal-400"></i>
              Employee Fetch Activity
            </h2>
            <button @click="loadActivity" :disabled="activityLoading" class="text-gray-400 hover:text-gray-200" title="Refresh">
              <i class="fas fa-rotate text-sm" :class="{ 'fa-spin': activityLoading }"></i>
            </button>
          </div>
          <p class="text-gray-500 text-xs mb-3">Everyone shares one login, so there's no name to log — IP address and browser are the only "who did this" signal available.</p>
          <div v-if="activityError" class="text-sm text-red-400">{{ activityError }}</div>
          <div v-else-if="activity.length === 0" class="text-sm text-gray-500">No manual fetches logged yet.</div>
          <div v-else class="max-h-96 overflow-y-auto">
            <table class="w-full text-xs text-gray-300">
              <thead class="sticky top-0 bg-gray-800">
                <tr class="text-left text-gray-500 border-b border-gray-700">
                  <th class="font-normal py-1.5">Time</th>
                  <th class="font-normal py-1.5">Source</th>
                  <th class="font-normal py-1.5 text-right">Count</th>
                  <th class="font-normal py-1.5">IP</th>
                  <th class="font-normal py-1.5">Browser</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(e, i) in activity" :key="i" class="border-b border-gray-800/60">
                  <td class="py-1 text-gray-400 font-mono">{{ formatTime(e.ts) }}</td>
                  <td class="py-1">{{ e.sourceAlias || '—' }}</td>
                  <td class="py-1 text-right">{{ e.count ?? '—' }}</td>
                  <td class="py-1 font-mono">{{ e.ip || '—' }}</td>
                  <td class="py-1 truncate max-w-[220px]" :title="e.userAgent">{{ e.userAgent || '—' }}</td>
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
import { ref, computed, onMounted, watch } from 'vue'
import { useAdminAuthStore } from '@/stores/adminAuthStore'
import { showToast } from '@/utils/toast'

const adminAuth = useAdminAuthStore()

const loginPassword = ref('')
const showLoginPassword = ref(false)
const loginError = ref('')

const settings = ref(null)
const settingsError = ref('')
const saving = ref(false)
const showAdminPassword = ref(false)

const health = ref(null)
const healthLoading = ref(false)
const healthError = ref('')

const activity = ref([])
const activityLoading = ref(false)
const activityError = ref('')

const handleLogin = async () => {
  loginError.value = ''
  try {
    await adminAuth.login(loginPassword.value)
    loginPassword.value = ''
  } catch (err) {
    loginError.value = err.message
  }
}

const handleLogout = async () => {
  await adminAuth.logout()
  settings.value = null
}

const loadSettings = async () => {
  settingsError.value = ''
  try {
    const response = await adminAuth.authedFetch('/api/admin/settings')
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Failed to load settings')
    settings.value = result.settings
  } catch (err) {
    settingsError.value = err.message
  }
}

const saveSettings = async () => {
  saving.value = true
  settingsError.value = ''
  try {
    const response = await adminAuth.authedFetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings.value)
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Failed to save settings')
    settings.value = result.settings
    showToast('Settings saved', 'success', 3000)
  } catch (err) {
    settingsError.value = err.message
    showToast(`Save failed: ${err.message}`, 'error', 6000)
  } finally {
    saving.value = false
  }
}

const loadHealth = async () => {
  healthLoading.value = true
  healthError.value = ''
  try {
    const response = await adminAuth.authedFetch('/api/admin/health')
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Failed to load health')
    health.value = result
  } catch (err) {
    healthError.value = err.message
  } finally {
    healthLoading.value = false
  }
}

const loadActivity = async () => {
  activityLoading.value = true
  activityError.value = ''
  try {
    const response = await adminAuth.authedFetch('/api/admin/employee-activity?limit=200')
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Failed to load activity')
    activity.value = result.entries
  } catch (err) {
    activityError.value = err.message
  } finally {
    activityLoading.value = false
  }
}

const formatTime = (iso) => new Date(iso).toLocaleString()
const formatUptime = (seconds) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

const lastFetchLabel = computed(() => {
  const lf = health.value?.lastFetch
  if (!lf) return 'No run yet'
  if (lf.killed) return 'Interrupted'
  if (lf.error) return 'Failed'
  if (lf.incomplete) return 'Completed with errors'
  return 'Completed'
})
const lastFetchClass = computed(() => {
  const lf = health.value?.lastFetch
  if (!lf || lf.killed || lf.error) return 'text-red-400'
  if (lf.incomplete) return 'text-amber-400'
  return 'text-green-400'
})

watch(() => adminAuth.isAuthenticated, (isAuth) => {
  if (isAuth) {
    loadSettings()
    loadHealth()
    loadActivity()
  }
})

onMounted(async () => {
  await adminAuth.initialize()
  if (adminAuth.isAuthenticated) {
    loadSettings()
    loadHealth()
    loadActivity()
  }
})
</script>
