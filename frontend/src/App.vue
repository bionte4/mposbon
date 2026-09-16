<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import AppErrorBoundary from './components/AppErrorBoundary.vue';
import ToastHost from './components/ToastHost.vue';
import { setLocale, useI18n, type LocaleCode } from './i18n';
import { useAuthStore } from './stores/auth.store';
import { useCatalogStore } from './stores/catalog.store';
import { useToastStore } from './stores/toast.store';

const { t, locale } = useI18n();
const auth = useAuthStore();
const catalog = useCatalogStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();
const authBusy = ref(false);

const canHris = computed(() => auth.has('hris.employee.read'));
const canDashboard = computed(() => auth.has('dashboard.read'));
const canReports = computed(() => auth.has('shift.z_report'));
const canAdmin = computed(() => auth.has('admin.access'));
const isPos = computed(() => route.path.startsWith('/pos'));
const isLogin = computed(() => route.path.startsWith('/login'));

function onLocaleChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as LocaleCode;
  setLocale(value);
}

async function onLogout(): Promise<void> {
  authBusy.value = true;
  try {
    auth.logout();
    toast.success(t('auth.loggedOut'));
    await router.replace('/login');
  } finally {
    authBusy.value = false;
  }
}

onMounted(async () => {
  if (!auth.bootstrapped) {
    const ok = await auth.restoreSession();
    if (ok) {
      try {
        await catalog.refreshFromApi();
      } catch (e) {
        console.warn(e);
      }
    }
  } else if (auth.isAuthenticated && !catalog.session) {
    try {
      await catalog.refreshFromApi();
    } catch (e) {
      console.warn(e);
    }
  }
});

async function onStoreChange(event: Event): Promise<void> {
  const storeId = (event.target as HTMLSelectElement).value;
  try {
    await catalog.switchStore(storeId);
  } catch (err) {
    toast.error(t('app.storeSwitchFailed'), err instanceof Error ? err.message : undefined);
  }
}
</script>

<template>
  <div class="app-shell">
    <ToastHost />
    <nav
      class="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur sm:gap-3 sm:px-4"
      :class="isPos ? 'shadow-sm' : ''"
    >
      <template v-if="auth.isAuthenticated && !isLogin">
        <RouterLink
          class="touch-target rounded-xl px-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          to="/pos"
        >
          {{ t('app.nav.pos') }}
        </RouterLink>
        <RouterLink
          v-if="canDashboard"
          class="touch-target rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          to="/dashboard"
        >
          {{ t('app.nav.dashboard') }}
        </RouterLink>
        <RouterLink
          v-if="canReports"
          class="touch-target rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          to="/reports"
        >
          {{ t('app.nav.reports') }}
        </RouterLink>
        <RouterLink
          v-if="canHris"
          class="touch-target rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          to="/hris"
        >
          {{ t('app.nav.hris') }}
        </RouterLink>
        <span
          v-else
          class="touch-target rounded-xl px-3 text-sm text-slate-400"
          :title="t('app.nav.hrisDenied')"
        >
          {{ t('app.nav.hris') }}
        </span>
        <RouterLink
          v-if="canAdmin"
          class="touch-target rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          to="/admin"
        >
          {{ t('app.nav.admin') }}
        </RouterLink>
        <span
          v-else
          class="touch-target rounded-xl px-3 text-sm text-slate-400"
          :title="t('app.nav.adminDenied')"
        >
          {{ t('app.nav.admin') }}
        </span>
        <RouterLink
          class="touch-target rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          to="/status"
        >
          {{ t('app.nav.runtime') }}
        </RouterLink>
      </template>
      <RouterLink
        v-else
        class="touch-target rounded-xl px-3 text-sm font-semibold text-slate-900"
        to="/login"
      >
        {{ t('app.name') }}
      </RouterLink>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <label class="hidden text-xs font-medium uppercase tracking-wide text-slate-500 sm:inline">
          {{ t('app.locale') }}
        </label>
        <select
          class="touch-target min-w-[4.5rem] rounded-xl border border-slate-300 bg-white px-2 text-sm"
          :value="locale"
          @change="onLocaleChange"
        >
          <option value="id">ID</option>
          <option value="en">EN</option>
        </select>

        <template v-if="auth.isAuthenticated && !isLogin">
          <label class="hidden text-xs font-medium uppercase tracking-wide text-slate-500 md:inline">
            {{ t('app.store') }}
          </label>
          <select
            v-if="catalog.stores.length"
            class="touch-target max-w-[12rem] rounded-xl border border-slate-300 bg-white px-2 text-sm"
            :value="catalog.session?.storeId"
            @change="onStoreChange"
          >
            <option v-for="s in catalog.stores" :key="s.id" :value="s.id">
              {{ s.code }} · {{ s.name }}
            </option>
          </select>

          <div
            class="hidden max-w-[12rem] truncate rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800 sm:block"
            :title="auth.staff?.email"
          >
            {{ auth.staff?.displayName || auth.staff?.email }}
          </div>
          <button
            type="button"
            class="touch-target rounded-xl bg-white px-3 text-sm font-semibold text-slate-800 ring-1 ring-slate-200"
            :disabled="authBusy"
            @click="onLogout"
          >
            {{ t('auth.logout') }}
          </button>
        </template>
        <RouterLink
          v-else-if="!isLogin"
          class="touch-target rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white"
          to="/login"
        >
          {{ t('auth.login') }}
        </RouterLink>
      </div>
    </nav>
    <AppErrorBoundary>
      <RouterView />
    </AppErrorBoundary>
  </div>
</template>
