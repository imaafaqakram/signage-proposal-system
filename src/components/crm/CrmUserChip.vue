<template>
  <div class="uc" ref="root">
    <button class="uc-btn" type="button" :aria-expanded="open" aria-haspopup="menu" :title="isPersonal ? `Signed in as ${displayName}` : 'Account'" @click="open = !open">
      <span class="uc-avatar" :class="{ shared: !isPersonal }">
        <template v-if="displayName">{{ initials(displayName) }}</template>
        <i v-else class="fas fa-user"></i>
      </span>
      <span class="uc-name">{{ displayName || 'Account' }}</span>
      <i class="fas fa-chevron-down uc-caret"></i>
    </button>

    <div v-if="open" class="uc-menu" role="menu">
      <div class="uc-who">
        <div class="uc-who-name">{{ displayName || 'Shared login' }}</div>
        <template v-if="isPersonal">
          <div class="uc-who-sub">@{{ user.username }}</div>
          <span class="uc-role" :class="user.role">{{ user.role === 'admin' ? 'Admin' : 'Employee' }}</span>
        </template>
        <p v-else class="uc-hint">
          You're using the shared password, so your actions can't be tied to a verified person.
          Ask an admin to create your personal account on the Team page.
        </p>
      </div>
      <router-link v-if="!isEmployeeOnly" class="uc-item" role="menuitem" :to="{ name: 'crm-team' }" @click="open = false"><i class="fas fa-users"></i> Team &amp; activity history</router-link>
      <button v-if="isPersonal" class="uc-item" type="button" role="menuitem" @click="openPassword"><i class="fas fa-key"></i> Change password</button>
      <button class="uc-item" type="button" role="menuitem" @click="signOut"><i class="fas fa-right-from-bracket"></i> Sign out</button>
    </div>

    <div v-if="pwOpen" class="uc-bg" @click.self="pwOpen = false">
      <form class="uc-modal" @submit.prevent="changePassword">
        <h3>Change password</h3>
        <label>Current password<input v-model="pw.current" type="password" autocomplete="current-password" required /></label>
        <label>New password <span class="uc-min">(at least 8 characters)</span><input v-model="pw.next" type="password" autocomplete="new-password" minlength="8" required /></label>
        <label>Confirm new password<input v-model="pw.confirm" type="password" autocomplete="new-password" minlength="8" required /></label>
        <p v-if="pwError" class="uc-err">{{ pwError }}</p>
        <p v-if="pwDone" class="uc-ok">Password changed. Your other sessions have been signed out.</p>
        <div class="uc-actions">
          <button class="uc-primary" type="submit" :disabled="pwBusy">{{ pwBusy ? 'Saving…' : 'Save password' }}</button>
          <button class="uc-ghost" type="button" @click="pwOpen = false">Close</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { useCrmUser, initials } from '@/composables/useCrmUser'
import { crmJson } from '@/services/crmApi'

const router = useRouter()
const authStore = useAuthStore()
const { user, isPersonal, isEmployeeOnly, displayName, logout } = useCrmUser()

const open = ref(false)
const root = ref(null)

function onDocClick(e) { if (open.value && root.value && !root.value.contains(e.target)) open.value = false }
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

async function signOut() {
  open.value = false
  await logout()
  authStore.$patch({ user: null })
  router.push({ name: 'login' })
}

const pwOpen = ref(false)
const pwBusy = ref(false)
const pwError = ref('')
const pwDone = ref(false)
const pw = reactive({ current: '', next: '', confirm: '' })

function openPassword() {
  open.value = false
  Object.assign(pw, { current: '', next: '', confirm: '' })
  pwError.value = ''; pwDone.value = false; pwOpen.value = true
}

async function changePassword() {
  pwError.value = ''; pwDone.value = false
  if (pw.next !== pw.confirm) { pwError.value = 'The new passwords don\'t match.'; return }
  pwBusy.value = true
  try {
    await crmJson('/auth/change-password', { method: 'POST', body: { currentPassword: pw.current, newPassword: pw.next } })
    pwDone.value = true
    Object.assign(pw, { current: '', next: '', confirm: '' })
  } catch (e) {
    pwError.value = e.message || 'Could not change the password.'
  } finally {
    pwBusy.value = false
  }
}
</script>

<style scoped>
.uc { position: relative; flex: none; }
.uc-btn { display: flex; align-items: center; gap: 8px; background: var(--crm-hover-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text-soft); height: 32px; padding: 0 10px 0 4px; border-radius: 16px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; }
.uc-btn:hover { background: var(--crm-hover-bg-strong); border-color: var(--crm-accent); color: var(--crm-text); }
.uc-avatar { width: 24px; height: 24px; border-radius: 50%; background: var(--crm-accent); color: var(--crm-accent-contrast); font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.uc-avatar.shared { background: var(--crm-badge-bg); color: var(--crm-text-muted); }
.uc-name { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uc-caret { font-size: 9px; opacity: .6; }
.uc-menu { position: absolute; right: 0; top: calc(100% + 8px); width: 250px; background: var(--crm-header-bg); border: 1px solid var(--crm-border-header); border-radius: 12px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); z-index: 60; overflow: hidden; }
.uc-who { padding: 14px 16px 12px; border-bottom: 1px solid var(--crm-border); display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.uc-who-name { font-size: 14px; font-weight: 700; color: var(--crm-text); }
.uc-who-sub { font-size: 11.5px; color: var(--crm-text-muted); }
.uc-role { margin-top: 5px; font-size: 9.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; background: var(--crm-badge-bg); color: var(--crm-text-secondary); }
.uc-role.admin { background: var(--crm-accent-soft-bg); color: var(--crm-accent); }
.uc-hint { margin: 4px 0 0; font-size: 11.5px; line-height: 1.5; color: var(--crm-text-muted); }
.uc-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: none; border: 0; color: var(--crm-text-secondary); font: inherit; font-size: 12.5px; font-weight: 600; padding: 11px 16px; cursor: pointer; }
.uc-item i { width: 14px; color: var(--crm-text-dim); }
a.uc-item { text-decoration: none; box-sizing: border-box; }
.uc-item:hover { background: var(--crm-hover-bg); color: var(--crm-text); }

.uc-bg { position: fixed; inset: 0; background: rgba(0, 0, 0, .6); display: flex; align-items: center; justify-content: center; z-index: 90; padding: 20px; }
.uc-modal { background: var(--crm-header-bg); border: 1px solid var(--crm-border-header); border-radius: 14px; padding: 24px 26px; width: 380px; max-width: 100%; display: flex; flex-direction: column; gap: 14px; color: var(--crm-text); }
.uc-modal h3 { font-family: 'Syne', sans-serif; font-size: 18px; margin: 0 0 2px; }
.uc-modal label { display: flex; flex-direction: column; gap: 5px; font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--crm-text-muted); }
.uc-min { text-transform: none; letter-spacing: 0; font-weight: 500; }
.uc-modal input { background: var(--crm-input-bg); border: 1px solid var(--crm-border-strong); color: var(--crm-text); border-radius: 7px; padding: 8px 10px; font: inherit; font-size: 13px; text-transform: none; letter-spacing: 0; font-weight: 400; }
.uc-modal input:focus { outline: none; border-color: var(--crm-accent); }
.uc-err { margin: 0; color: var(--crm-danger); font-size: 12px; }
.uc-ok { margin: 0; color: var(--crm-success); font-size: 12px; }
.uc-actions { display: flex; gap: 10px; margin-top: 4px; }
.uc-primary { background: var(--crm-accent); color: var(--crm-accent-contrast); border: 1px solid var(--crm-accent); border-radius: 6px; font-size: 12px; font-weight: 700; padding: 8px 14px; cursor: pointer; }
.uc-primary:disabled { opacity: .6; cursor: default; }
.uc-ghost { background: var(--crm-hover-bg); color: var(--crm-text-soft); border: 1px solid var(--crm-border-strong); border-radius: 6px; font-size: 12px; font-weight: 600; padding: 8px 14px; cursor: pointer; }

@media (max-width: 1280px) { .uc-name, .uc-caret { display: none; } .uc-btn { padding: 0 4px; } }
</style>
