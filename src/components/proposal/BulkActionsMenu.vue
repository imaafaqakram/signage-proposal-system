<template>
  <div v-if="isOpen" class="bulk-actions-dropdown">
    <div class="bulk-actions-backdrop" @click="close"></div>
    <div class="bulk-actions-menu">
      <div class="bulk-actions-header">
        <h4><i class="fas fa-magic mr-2"></i>Quick Actions</h4>
        <button @click="close" class="close-btn">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="bulk-actions-list">
        <!-- Copy All Fields -->
        <button @click="handleAction('copy-all-fields')" class="action-item">
          <i class="fas fa-copy"></i>
          <div>
            <div class="action-title">Copy All Fields</div>
            <div class="action-desc">Copy all current page fields to other pages</div>
          </div>
        </button>

        <!-- Copy Pricing -->
        <button @click="handleAction('copy-pricing')" class="action-item">
          <i class="fas fa-dollar-sign"></i>
          <div>
            <div class="action-title">Copy Pricing</div>
            <div class="action-desc">Copy pricing table to all pages</div>
          </div>
        </button>

        <!-- Copy Images -->
        <button @click="handleAction('copy-images')" class="action-item">
          <i class="fas fa-images"></i>
          <div>
            <div class="action-title">Copy Images</div>
            <div class="action-desc">Copy all images to other pages</div>
          </div>
        </button>

        <!-- Duplicate Page -->
        <button @click="handleAction('duplicate-page')" class="action-item">
          <i class="fas fa-clone"></i>
          <div>
            <div class="action-title">Duplicate Page</div>
            <div class="action-desc">Create a copy of current page</div>
          </div>
        </button>

        <!-- Reset Page -->
        <button @click="handleAction('reset-page')" class="action-item danger">
          <i class="fas fa-undo"></i>
          <div>
            <div class="action-title">Reset Page</div>
            <div class="action-desc">Clear all fields on current page</div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue'

defineProps({
  isOpen: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'action'])

const close = () => {
  emit('close')
}

const handleAction = (action) => {
  emit('action', action)
  close()
}
</script>

<style scoped>
.bulk-actions-dropdown {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 100px;
}

.bulk-actions-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.bulk-actions-menu {
  position: relative;
  background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.bulk-actions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.bulk-actions-header h4 {
  color: white;
  font-size: 18px;
  font-weight: 700;
  margin: 0;
}

.close-btn {
  width: 32px;
  height: 32px;
  border-radius: 6px;
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

.bulk-actions-list {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
  width: 100%;
}

.action-item:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(34, 211, 238, 0.5);
  transform: translateX(4px);
}

.action-item i {
  font-size: 20px;
  color: #22d3ee;
  flex-shrink: 0;
}

.action-item.danger i {
  color: #ef4444;
}

.action-item.danger:hover {
  border-color: rgba(239, 68, 68, 0.5);
}

.action-title {
  color: white;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 2px;
}

.action-desc {
  color: #9ca3af;
  font-size: 12px;
}
</style>
