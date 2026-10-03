<template>
  <!-- Team management is admin-only. Personal employee accounts never see the link; on the
       shared login the page itself asks for the admin password, same as Finance/Orders. -->
  <router-link v-if="!isEmployeeOnly" :to="{ name: 'crm-team' }">Team</router-link>
</template>

<script setup>
import { useCrmUser } from '@/composables/useCrmUser'

const { isEmployeeOnly } = useCrmUser()
</script>
