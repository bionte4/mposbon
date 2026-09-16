import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth.store';

/**
 * Lazy-load heavy pages (Chart.js dashboard) so POS cold start stays light on tablets.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/pos' },
    {
      path: '/login',
      component: () => import('./pages/LoginPage.vue'),
      meta: { public: true },
    },
    {
      path: '/pos',
      component: () => import('./pages/PosPage.vue'),
      meta: { requiresAuth: true, permission: 'pos.sale.create' as const },
    },
    {
      path: '/dashboard',
      component: () => import('./pages/DashboardPage.vue'),
      meta: { requiresAuth: true, permission: 'dashboard.read' as const },
    },
    {
      path: '/reports',
      component: () => import('./pages/ReportsPage.vue'),
      meta: { requiresAuth: true, permission: 'shift.z_report' as const },
    },
    {
      path: '/hris',
      component: () => import('./pages/HrisPage.vue'),
      meta: { requiresAuth: true, permission: 'hris.employee.read' as const },
    },
    {
      path: '/admin',
      component: () => import('./pages/admin/AdminShell.vue'),
      meta: { requiresAuth: true, permission: 'admin.access' as const },
      children: [
        { path: '', redirect: { path: '/admin/catalog' } },
        {
          path: 'catalog',
          component: () => import('./pages/admin/CatalogHub.vue'),
          meta: { hub: 'catalog' },
        },
        {
          path: 'inventory',
          component: () => import('./pages/admin/InventoryHub.vue'),
          meta: { hub: 'inventory' },
        },
        {
          path: 'outlet',
          component: () => import('./pages/admin/OutletHub.vue'),
          meta: { hub: 'outlet' },
        },
        {
          path: 'team',
          component: () => import('./pages/admin/TeamHub.vue'),
          meta: { hub: 'team' },
        },
        {
          path: 'system',
          component: () => import('./pages/admin/SystemHub.vue'),
          meta: { hub: 'system' },
        },
      ],
    },
    // Legacy/mistaken relative redirect landed here — bounce into Admin hub.
    { path: '/catalog', redirect: '/admin/catalog' },
    { path: '/inventory', redirect: '/admin/inventory' },
    { path: '/outlet', redirect: '/admin/outlet' },
    { path: '/team', redirect: '/admin/team' },
    { path: '/system', redirect: '/admin/system' },
    {
      path: '/kitchen',
      component: () => import('./pages/KitchenPage.vue'),
      meta: { requiresAuth: true, permission: 'kitchen.display' as const },
    },
    {
      path: '/status',
      component: () => import('./pages/StatusPage.vue'),
      meta: { requiresAuth: true },
    },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.bootstrapped) {
    await auth.restoreSession();
  }

  const isPublic = Boolean(to.meta.public);
  if (isPublic) {
    if (auth.isAuthenticated && to.path === '/login') {
      if (auth.has('pos.sale.create')) return { path: '/pos' };
      if (auth.has('kitchen.display')) return { path: '/kitchen' };
      return { path: '/status' };
    }
    return true;
  }

  if (!auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  const permission = to.meta.permission as string | undefined;
  if (permission && !auth.has(permission as 'dashboard.read')) {
    if (auth.has('pos.sale.create')) {
      return { path: '/pos', query: { denied: permission } };
    }
    if (auth.has('kitchen.display')) {
      return { path: '/kitchen', query: { denied: permission } };
    }
    return { path: '/login', query: { denied: permission } };
  }
  return true;
});
