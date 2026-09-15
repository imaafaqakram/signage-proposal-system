<template>
  <div id="app" class="min-h-screen">
    <router-view />
  </div>
</template>

<script setup>
// Auth is initialized in main.js, before the router's first navigation guard runs —
// see that file for why this can't happen here in onMounted anymore (too late: the
// guard already ran by the time this component mounts).
</script>

<style scoped>
/* App-specific styles can go here */
</style>
