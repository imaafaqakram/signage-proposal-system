<template>
  <!-- Emailing every client is admin-only, so personal employee accounts never see the link;
       on the shared login the page itself asks for the admin password, like Finance/Orders. -->
  <router-link v-if="!isEmployeeOnly" :to="{ name: 'crm-broadcast' }">Announcements</router-link>
</template>

<script setup>
import { useCrmUser } from '@/composables/useCrmUser'

const { isEmployeeOnly } = useCrmUser()
</script>
