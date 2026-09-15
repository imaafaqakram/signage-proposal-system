<template>
  <div class="min-h-screen bg-gray-900 p-8">
    <div class="max-w-4xl mx-auto">
      <!-- Header -->
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-3xl font-bold text-white mb-2">Settings</h1>
          <p class="text-gray-400">Customize your proposal system</p>
        </div>
        <router-link
          to="/"
          class="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-700 transition-colors flex items-center gap-2"
        >
          <i class="fas fa-arrow-left"></i>
          Back to Editor
        </router-link>
      </div>

      <!-- Settings Sections -->
      <div class="space-y-6">
        <!-- Branding -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <i class="fas fa-palette text-teal-400"></i>
            Branding
          </h2>
          <div class="space-y-4">
            <div>
              <label class="block text-gray-300 text-sm font-medium mb-2">Company Name</label>
              <input
                v-model="settings.companyName"
                class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-gray-300 text-sm font-medium mb-2">Tagline</label>
              <input
                v-model="settings.companyTagline"
                class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-gray-300 text-sm font-medium mb-2">Contact Email</label>
              <input
                v-model="settings.contactEmail"
                type="email"
                class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <!-- Copyright Text -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <i class="fas fa-copyright text-teal-400"></i>
            Copyright Notice
          </h2>
          <textarea
            v-model="settings.copyrightText"
            rows="3"
            class="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-teal-500 focus:outline-none resize-none"
          ></textarea>
        </div>

        <!-- Trust Bar -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <i class="fas fa-shield-alt text-teal-400"></i>
            Trust Bar Items
          </h2>
          <div class="space-y-3">
            <div
              v-for="(item, index) in settings.trustBarItems"
              :key="index"
              class="flex items-center gap-3 bg-gray-700 p-3 rounded-lg"
            >
              <input
                v-model="item.icon"
                placeholder="fa-tag"
                class="w-1/3 bg-gray-600 text-white px-3 py-2 rounded border border-gray-500 focus:border-teal-500 focus:outline-none text-sm"
              />
              <input
                v-model="item.label"
                placeholder="Label"
                class="flex-1 bg-gray-600 text-white px-3 py-2 rounded border border-gray-500 focus:border-teal-500 focus:outline-none text-sm"
              />
              <button
                @click="removeTrustItem(index)"
                class="text-red-400 hover:text-red-300 px-3"
              >
                <i class="fas fa-trash"></i>
              </button>
            </div>
            <button
              @click="addTrustItem"
              class="w-full bg-gray-700 hover:bg-gray-600 text-teal-400 py-2 rounded-lg border border-gray-600 border-dashed transition-colors"
            >
              <i class="fas fa-plus mr-2"></i>
              Add Item
            </button>
          </div>
        </div>

        <!-- Account -->
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 class="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <i class="fas fa-user text-teal-400"></i>
            Account
          </h2>
          <div class="flex items-center justify-between">
            <div>
              <p class="text-gray-300">{{ authStore.user?.email || 'Admin (Bypass Mode)' }}</p>
              <p class="text-gray-500 text-sm mt-1">Signed in</p>
            </div>
            <button
              @click="handleSignOut"
              class="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg transition-colors"
            >
              <i class="fas fa-sign-out-alt mr-2"></i>
              Sign Out
            </button>
          </div>
        </div>

        <!-- Save Button -->
        <button
          @click="saveSettings"
          class="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          <i class="fas fa-save mr-2"></i>
          Save Settings
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProposalStore } from '@/stores/proposalStore'
import { useAuthStore } from '@/stores/authStore'
import { storeToRefs } from 'pinia'

const router = useRouter()
const proposalStore = useProposalStore()
const authStore = useAuthStore()

const { settings } = storeToRefs(proposalStore)

const addTrustItem = () => {
  settings.value.trustBarItems.push({ icon: 'fa-star', label: 'New Item' })
}

const removeTrustItem = (index) => {
  settings.value.trustBarItems.splice(index, 1)
}

const saveSettings = () => {
  // Settings are automatically saved via Pinia reactivity
  alert('Settings saved successfully!')
}

const handleSignOut = async () => {
  await authStore.signOut()
  router.push({ name: 'login' })
}
</script>
