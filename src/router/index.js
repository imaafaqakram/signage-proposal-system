import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { useCrmThemeStore } from '@/stores/crmThemeStore'

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/ProposalEditor.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/Settings.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/Dashboard.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/views/Admin.vue'),
    // requiresAuth (employee bypass) is an outer gate on top of this page's own separate
    // admin-password gate — reaching /admin at all still requires knowing the shared
    // employee password first, same as every other page in the app.
    meta: { requiresAuth: true }
  },
  {
    path: '/batch-upload',
    name: 'batch-upload',
    component: () => import('@/views/BatchUpload.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/batch-review/:batchId',
    name: 'batch-review',
    component: () => import('@/views/BatchReview.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/pdf-render/:clientId',
    name: 'pdf-render',
    component: () => import('@/views/PdfRenderTemplate.vue'),
    meta: { requiresAuth: false } // Internal route, will be protected by network boundaries in production
  },
  {
    path: '/crm',
    name: 'crm',
    component: () => import('@/views/CrmInbox.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/crm/leads',
    name: 'crm-leads',
    component: () => import('@/views/CrmLeads.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/crm/responses',
    name: 'crm-responses',
    component: () => import('@/views/CrmResponses.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/crm/pipeline',
    name: 'crm-pipeline',
    component: () => import('@/views/CrmPipeline.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/crm/projects',
    name: 'crm-projects',
    component: () => import('@/views/CrmProjects.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/crm/automation',
    name: 'crm-automation',
    component: () => import('@/views/CrmAutomation.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/crm/orders',
    name: 'crm-orders',
    // requiresAuth (employee bypass) is an outer gate here too, same as /admin —
    // the page's own admin-password lock screen is the real gate on the data.
    component: () => import('@/views/CrmOrders.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/crm/finance',
    name: 'crm-finance',
    component: () => import('@/views/CrmFinance.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/crm/templates',
    name: 'crm-templates',
    component: () => import('@/views/CrmTemplates.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/crm/materials',
    name: 'crm-materials',
    // requiresAuth (employee bypass) is an outer gate here too, same as /crm/orders —
    // the page's own admin-password lock screen is the real gate on the data.
    component: () => import('@/views/CrmMaterials.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/crm/vendors',
    name: 'crm-vendors',
    component: () => import('@/views/CrmVendors.vue'),
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Navigation guard
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()

  // Served under the CRM subdomain, the root path lands on the inbox, not the editor.
  const onCrmHost = typeof location !== 'undefined' && /^crm\./i.test(location.hostname)

  if (typeof document !== 'undefined') {
    document.title = onCrmHost ? 'Signage Crafting CRM' : 'Signage Crafting - Proposal System'
    // Only the CRM has a Light/Pro toggle — leave the Proposal Editor's own
    // .theme-* system (style.css, per-proposal-page skins) completely alone.
    if (onCrmHost) useCrmThemeStore().init()
  }

  if (onCrmHost && (to.path === '/' || to.name === 'home')) {
    return next({ name: authStore.isAuthenticated ? 'crm' : 'login' })
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'login' })
  } else if (to.name === 'login' && authStore.isAuthenticated) {
    next({ name: onCrmHost ? 'crm' : 'home' })
  } else {
    next()
  }
})

export default router
