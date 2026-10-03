<template>
  <div class="min-h-screen bg-gray-900 flex items-center justify-center p-4">
    <div class="max-w-md w-full">
      <!-- Logo -->
      <div class="text-center mb-8">
        <h1 class="text-4xl font-extrabold text-white mb-2">
          Signage <span class="text-teal-400">Crafting</span>
        </h1>
        <p class="text-gray-400 text-sm">{{ onCrmHost ? 'Customer Relationship Management' : 'Proposal Management System' }}</p>
      </div>

      <!-- Login Card -->
      <div class="bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700">
        <!-- Tab Switcher -->
        <div v-if="!bypassMode && !showPersonal && !configLoading" class="flex mb-6 bg-gray-900 rounded-lg p-1">
          <button
            @click="activeTab = 'signin'"
            :class="[
              'flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors',
              activeTab === 'signin'
                ? 'bg-teal-600 text-white'
                : 'text-gray-400 hover:text-white'
            ]"
          >
            Sign In
          </button>
          <button
            @click="activeTab = 'signup'"
            :class="[
              'flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors',
              activeTab === 'signup'
                ? 'bg-teal-600 text-white'
                : 'text-gray-400 hover:text-white'
            ]"
          >
            Sign Up
          </button>
        </div>

        <!-- Bypass Mode Notice -->
        <div v-if="bypassMode && !showPersonal && !configLoading" class="mb-6 bg-yellow-900/30 border border-yellow-700 rounded-lg p-4">
          <div class="flex items-start">
            <i class="fas fa-exclamation-triangle text-yellow-500 mt-0.5 mr-3"></i>
            <div>
              <p class="text-yellow-200 text-sm font-semibold">Admin Bypass Mode Enabled</p>
              <p class="text-yellow-300 text-xs mt-1">
                Authentication is disabled. Enter bypass password to continue.
              </p>
            </div>
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="errorMessage" class="mb-4 bg-red-900/30 border border-red-700 rounded-lg p-3">
          <p class="text-red-200 text-sm">{{ errorMessage }}</p>
        </div>

        <!-- Success Message -->
        <div v-if="successMessage" class="mb-4 bg-green-900/30 border border-green-700 rounded-lg p-3">
          <p class="text-green-200 text-sm">{{ successMessage }}</p>
        </div>

        <!-- CRM host: waiting to learn whether personal accounts exist (avoids flashing the wrong form) -->
        <div v-if="configLoading" class="text-center text-gray-400 py-10">
          <i class="fas fa-spinner fa-spin"></i>
        </div>

        <!-- Personal CRM account (CRM host, once at least one account exists) -->
        <form v-else-if="showPersonal" @submit.prevent="handlePersonalLogin" class="space-y-4">
          <div>
            <label class="block text-gray-300 text-sm font-medium mb-2">Username</label>
            <input
              v-model="personalUsername"
              type="text"
              autocomplete="username"
              autocapitalize="off"
              spellcheck="false"
              placeholder="e.g. jordan.smith"
              class="w-full bg-gray-700 text-white px-4 py-3 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none"
              required
            />
          </div>
          <div>
            <label class="block text-gray-300 text-sm font-medium mb-2">Password</label>
            <div class="flex items-center gap-2">
              <input
                v-model="personalPassword"
                :type="showPersonalPassword ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="Your password"
                class="flex-1 bg-gray-700 text-white px-4 py-3 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none"
                required
              />
              <button type="button" @click="showPersonalPassword = !showPersonalPassword" class="text-gray-400 hover:text-gray-200 px-2" aria-label="Show or hide password">
                <i class="fas" :class="showPersonalPassword ? 'fa-eye-slash' : 'fa-eye'"></i>
              </button>
            </div>
          </div>
          <button
            type="submit"
            :disabled="loading"
            class="w-full bg-teal-600 hover:bg-teal-500 disabled:bg-gray-600 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center"
          >
            <i v-if="loading" class="fas fa-spinner fa-spin mr-2"></i>
            {{ loading ? 'Signing in...' : 'Sign in' }}
          </button>
          <p v-if="crmConfig && crmConfig.sharedLoginAllowed" class="text-center text-xs text-gray-500 pt-1">
            <button type="button" class="underline hover:text-gray-300" @click="useShared = true">Use the shared password instead</button>
          </p>
        </form>

        <!-- Bypass Mode Form -->
        <form v-else-if="bypassMode" @submit.prevent="handleBypassLogin" class="space-y-4">
          <div>
            <label class="block text-gray-300 text-sm font-medium mb-2">
              Bypass Password
            </label>
            <div class="flex items-center gap-2">
              <input
                v-model="bypassPassword"
                :type="showBypassPassword ? 'text' : 'password'"
                placeholder="Enter bypass password"
                class="flex-1 bg-gray-700 text-white px-4 py-3 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none"
                required
              />
              <button type="button" @click="showBypassPassword = !showBypassPassword" class="text-gray-400 hover:text-gray-200 px-2">
                <i class="fas" :class="showBypassPassword ? 'fa-eye-slash' : 'fa-eye'"></i>
              </button>
            </div>
          </div>

          <div>
            <label class="block text-gray-300 text-sm font-medium mb-2">
              Your name <span class="text-gray-500 font-normal">(optional, for CRM activity tracking)</span>
            </label>
            <input
              v-model="employeeName"
              type="text"
              placeholder="e.g. Jordan"
              maxlength="80"
              class="w-full bg-gray-700 text-white px-4 py-3 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="w-full bg-teal-600 hover:bg-teal-500 disabled:bg-gray-600 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center"
          >
            <i v-if="loading" class="fas fa-spinner fa-spin mr-2"></i>
            {{ loading ? 'Verifying...' : 'Continue' }}
          </button>
          <p v-if="onCrmHost && crmConfig && crmConfig.personalLoginEnabled" class="text-center text-xs text-gray-500 pt-1">
            <button type="button" class="underline hover:text-gray-300" @click="useShared = false">Back to personal sign-in</button>
          </p>
        </form>

        <!-- Regular Auth Forms -->
        <form v-else @submit.prevent="handleSubmit" class="space-y-4">
          <div>
            <label class="block text-gray-300 text-sm font-medium mb-2">Email</label>
            <input
              v-model="email"
              type="email"
              placeholder="your@email.com"
              class="w-full bg-gray-700 text-white px-4 py-3 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label class="block text-gray-300 text-sm font-medium mb-2">Password</label>
            <div class="flex items-center gap-2">
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="••••••••"
                class="flex-1 bg-gray-700 text-white px-4 py-3 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none"
                required
              />
              <button type="button" @click="showPassword = !showPassword" class="text-gray-400 hover:text-gray-200 px-2">
                <i class="fas" :class="showPassword ? 'fa-eye-slash' : 'fa-eye'"></i>
              </button>
            </div>
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="w-full bg-teal-600 hover:bg-teal-500 disabled:bg-gray-600 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center"
          >
            <i v-if="loading" class="fas fa-spinner fa-spin mr-2"></i>
            {{ loading ? 'Loading...' : (activeTab === 'signin' ? 'Sign In' : 'Create Account') }}
          </button>
        </form>
      </div>

      <!-- Footer Info -->
      <div class="mt-6 text-center text-gray-500 text-xs">
        <p>© 2024-2026 Signage Crafting - Proposal System v2.2 PRO</p>
        <p v-if="!bypassMode && !isSupabaseConfigured" class="mt-2 text-yellow-500">
          ⚠️ Supabase not configured. Enable bypass mode in .env to continue.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { isSupabaseConfigured } from '@/services/supabase'
import { getEmployeeName } from '@/services/crmActivity'

const router = useRouter()
const authStore = useAuthStore()

const activeTab = ref('signin')
const email = ref('')
const password = ref('')
const bypassPassword = ref('')
const showPassword = ref(false)
const showBypassPassword = ref(false)
const employeeName = ref(getEmployeeName())
const errorMessage = ref('')
const successMessage = ref('')
const loading = ref(false)

const bypassMode = computed(() => authStore.bypassMode)

// ── personal CRM accounts (CRM host only; the Proposal System login is untouched) ──
const onCrmHost = typeof location !== 'undefined' && /^crm\./i.test(location.hostname)
const crmConfig = ref(null)
const configLoading = ref(onCrmHost)
const useShared = ref(false)
const personalUsername = ref('')
const personalPassword = ref('')
const showPersonalPassword = ref(false)
const showPersonal = computed(() => onCrmHost && !!crmConfig.value?.personalLoginEnabled && !useShared.value)

onMounted(async () => {
  if (!onCrmHost) return
  try {
    const res = await fetch('/api/crm/auth/config', { signal: AbortSignal.timeout(6000) })
    if (res.ok) crmConfig.value = await res.json()
  } catch {
    // Can't tell — fall back to the regular login form so nobody is ever locked out here.
  } finally {
    configLoading.value = false
  }
})

const handlePersonalLogin = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  loading.value = true
  try {
    const me = await authStore.personalLogin(personalUsername.value, personalPassword.value)
    successMessage.value = `Welcome, ${me.name}!`
    setTimeout(() => { router.push({ name: 'home' }) }, 400)
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    loading.value = false
  }
}

const handleBypassLogin = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  loading.value = true

  try {
    await authStore.bypassLogin(bypassPassword.value, employeeName.value)
    successMessage.value = 'Access granted!'
    setTimeout(() => {
      router.push({ name: 'home' })
    }, 500)
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    loading.value = false
  }
}

const handleSubmit = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  loading.value = true

  try {
    if (activeTab.value === 'signin') {
      await authStore.signIn(email.value, password.value)
      router.push({ name: 'home' })
    } else {
      await authStore.signUp(email.value, password.value)
      successMessage.value = 'Account created! Please check your email to verify.'
    }
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    loading.value = false
  }
}
</script>
