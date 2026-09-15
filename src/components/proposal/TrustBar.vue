<template>
  <div class="trust-bar">
    <template v-for="(item, index) in items" :key="index">
      <div class="trust-item">
        <i :class="['fas', item.icon]"></i>
        <span class="trust-label">{{ item.label }}</span>
      </div>
      <div v-if="index < items.length - 1" class="trust-divider"></div>
    </template>
  </div>
</template>

<script setup>
defineProps({
  items: {
    type: Array,
    default: () => [
      { icon: 'fa-tag', label: 'Best Price' },
      { icon: 'fa-shield-alt', label: 'Warranty' },
      { icon: 'fa-truck', label: 'Free Ship' },
      { icon: 'fa-headset', label: '24/7 Help' },
      { icon: 'fa-certificate', label: 'UL Listed' }
    ]
  }
})
</script>
