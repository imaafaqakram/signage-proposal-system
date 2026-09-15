<template>
  <div v-if="isOpen" class="settings-modal-overlay">
    <div class="settings-modal-backdrop" @click="$emit('close')"></div>
    
    <div class="settings-modal-content">
      <div class="settings-modal-header">
        <h3><i class="fas fa-cog mr-2"></i>Quick Settings</h3>
        <button @click="$emit('close')" class="close-btn">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="settings-modal-body">
        <p class="settings-info">
          For full settings, visit the <router-link to="/settings" class="settings-link">Settings Page</router-link>
        </p>

        <div class="settings-section">
          <label>Company Name</label>
          <input v-model="localSettings.companyName" type="text" />
        </div>

        <div class="settings-section">
          <label>Tagline</label>
          <input v-model="localSettings.companyTagline" type="text" />
        </div>

        <div class="settings-section">
          <label>Contact Email</label>
          <input v-model="localSettings.contactEmail" type="email" />
        </div>

        <button @click="saveSettings" class="save-btn">
          <i class="fas fa-save mr-2"></i>
          Save Settings
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useProposalStore } from '@/stores/proposalStore'
import { storeToRefs } from 'pinia'
import { showToast } from '@/utils/toast'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close'])

const proposalStore = useProposalStore()
const { settings } = storeToRefs(proposalStore)

const localSettings = ref({ ...settings.value })

watch(() => settings.value, (newSettings) => {
  localSettings.value = { ...newSettings }
}, { deep: true })

const saveSettings = () => {
  proposalStore.updateSettings(localSettings.value)
  showToast('Settings saved!', 'success')
  emit('close')
}
</script>

<style scoped>
.settings-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10003;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.settings-modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.settings-modal-content {
  position: relative;
  background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  width: 100%;
  max-width: 500px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.settings-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.settings-modal-header h3 {
  color: white;
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

.close-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #9ca3af;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.settings-modal-body {
  padding: 24px;
}

.settings-info {
  color: #9ca3af;
  font-size: 14px;
  margin-bottom: 20px;
}

.settings-link {
  color: #22d3ee;
  text-decoration: underline;
}

.settings-section {
  margin-bottom: 16px;
}

.settings-section label {
  display: block;
  color: #e5e7eb;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}

.settings-section input {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 10px 12px;
  color: white;
  font-size: 14px;
}

.settings-section input:focus {
  outline: none;
  border-color: #22d3ee;
}

.save-btn {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #22d3ee, #0ea5e9);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.save-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(34, 211, 238, 0.4);
}
</style>
