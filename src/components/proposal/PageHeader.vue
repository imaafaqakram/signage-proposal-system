<template>
  <div class="flex justify-between items-end theme-border-b pb-3 mb-4">
    <div class="flex flex-col">
      <h1 class="text-4xl font-extrabold tracking-tight mb-0">
        {{ settings.companyName || 'Signage Crafting' }}
      </h1>
      <div class="text-[10px] font-bold theme-text-muted uppercase tracking-[0.2em] mt-1">
        {{ settings.companyTagline || 'Signage Solutions' }}
      </div>
    </div>
    <div class="flex flex-col items-end">
      <input 
        :value="clientName" 
        @input="$emit('update:clientName', $event.target.value)"
        class="editable-input text-2xl font-bold text-right" 
        placeholder="Client Name"
      />
      <input 
        :value="contactEmail" 
        @input="$emit('update:contactEmail', $event.target.value)"
        class="editable-input text-xs font-mono font-medium theme-text-accent text-right mt-1 w-64" 
        placeholder="client@email.com"
      />
    </div>
  </div>
</template>

<script setup>
defineProps({
  settings: {
    type: Object,
    required: true
  },
  clientName: {
    type: String,
    default: ''
  },
  contactEmail: {
    type: String,
    default: ''
  }
})

defineEmits(['update:clientName', 'update:contactEmail'])
</script>
