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
      meta: { requiresAuth: true },
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
      component: () => import('./pages/AdminPage.vue'),
      meta: { requiresAuth: true, permission: 'admin.access' as const },
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
      return { path: '/pos' };
    }
    return true;
  }

  if (!auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  const permission = to.meta.permission as string | undefined;
  if (permission && !auth.has(permission as 'dashboard.read')) {
    return { path: '/pos', query: { denied: permission } };
  }
  return true;
});
