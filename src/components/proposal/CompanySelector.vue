<template>
  <div class="company-selector">
    <label class="selector-label">
      <i class="fas fa-building"></i> Active Company
    </label>
    
    <div class="company-grid">
      <div 
        v-for="company in companies" 
        :key="company.id"
        @click="selectCompany(company.id)"
        :class="['company-card', { active: activeCompanyId === company.id }]"
        :style="{ '--company-primary': company.theme.primary, '--company-glow': company.theme.glow }"
      >
        <div class="company-icon" :style="{ background: company.theme.background }">
          <i class="fas fa-building-columns"></i>
        </div>
        <div class="company-info">
          <input 
            v-model="company.name" 
            @input="handleNameChange(company.id, company.name)"
            @click.stop
            class="company-name-input"
            :style="{ color: company.theme.primary }"
          />
          <span class="company-tagline">{{ company.tagline }}</span>
        </div>
        <div class="theme-badge" :style="{ background: company.theme.primary }">
          {{ company.theme.name }}
        </div>
        <div v-if="activeCompanyId === company.id" class="active-indicator">
          <i class="fas fa-check-circle"></i>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useProposalStore } from '@/stores/proposalStore'
import { showToast } from '@/utils/toast'

const proposalStore = useProposalStore()
const { companies, activeCompanyId } = storeToRefs(proposalStore)

const selectCompany = (companyId) => {
  proposalStore.switchCompany(companyId)
  const company = companies.value.find(c => c.id === companyId)
  showToast(`Switched to ${company.name}`, 'success')
}

const handleNameChange = (companyId, newName) => {
  proposalStore.updateCompanyName(companyId, newName)
}
</script>

<style scoped>
.company-selector {
  padding: 16px 0;
}

.selector-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 12px;
}

.selector-label i {
  color: #22d3ee;
}

.company-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.company-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.company-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--company-primary);
}

.company-card.active {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--company-primary);
  box-shadow: var(--company-glow);
}

.company-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 16px;
  flex-shrink: 0;
}

.company-info {
  flex: 1;
  min-width: 0;
}

.company-name-input {
  display: block;
  width: 100%;
  background: transparent;
  border: none;
  font-size: 14px;
  font-weight: 600;
  padding: 0;
  cursor: text;
  outline: none;
}

.company-name-input:focus {
  outline: none;
  border-bottom: 1px dashed currentColor;
}

.company-tagline {
  font-size: 11px;
  color: #64748b;
  display: block;
  margin-top: 2px;
}

.theme-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.active-indicator {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--company-primary);
  font-size: 14px;
}
</style>
