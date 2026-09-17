<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import AppErrorBoundary from './components/AppErrorBoundary.vue';
import ToastHost from './components/ToastHost.vue';
import { setLocale, useI18n, type LocaleCode } from './i18n';
import { useAuthStore } from './stores/auth.store';
import { useCatalogStore } from './stores/catalog.store';
import { useKitchenNotifyStore } from './stores/kitchen-notify.store';
import { useToastStore } from './stores/toast.store';

const { t, locale } = useI18n();
const auth = useAuthStore();
const catalog = useCatalogStore();
const kitchenNotify = useKitchenNotifyStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();
const authBusy = ref(false);
const moreOpen = ref(false);

watch(
  () => route.path,
  (path) => {
    moreOpen.value = false;
    kitchenNotify.markViewing(path.startsWith('/kitchen'));
  },
  { immediate: true },
);

const canHris = computed(() => auth.has('hris.employee.read'));
const canDashboard = computed(() => auth.has('dashboard.read'));
const canReports = computed(() => auth.has('shift.z_report'));
const canAdmin = computed(() => auth.has('admin.access'));
const canPos = computed(() => auth.has('pos.sale.create'));
const canKitchen = computed(() => auth.has('kitchen.display'));
const isPos = computed(() => route.path.startsWith('/pos'));
const isLogin = computed(() => route.path.startsWith('/login'));
const hasSecondaryNav = computed(
  () =>
    canKitchen.value ||
    canDashboard.value ||
    canReports.value ||
    canHris.value ||
    canAdmin.value,
);

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
  kitchenNotify.bindAuthWatch();
  catalog.bindLiveRefresh();
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
  <div class="app-shell" :class="isPos ? 'app-shell--pos' : ''">
    <ToastHost />
    <nav
      v-if="!isLogin"
      class="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur sm:gap-3 sm:px-4"
      :class="isPos ? 'pos-topnav shadow-sm' : ''"
    >
      <template v-if="auth.isAuthenticated">
        <RouterLink
          v-if="canPos"
          class="touch-target rounded-xl px-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          to="/pos"
        >
          {{ t('app.nav.pos') }}
        </RouterLink>

        <!-- Full nav outside POS; compact “More” menu on cashier screen -->
        <template v-if="!isPos">
          <RouterLink
            v-if="canKitchen"
            class="touch-target relative rounded-xl px-3 text-sm font-medium text-orange-800 hover:bg-orange-50"
            to="/kitchen"
          >
            <span class="inline-flex items-center gap-1.5">
              <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 1 0-14 0v5l-1.7 1.7A1 1 0 0 0 4 20h16a1 1 0 0 0 .7-1.7L19 16Z" />
              </svg>
              {{ t('app.nav.kitchen') }}
              <span
                v-if="kitchenNotify.hasAlert"
                class="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
              >
                {{ kitchenNotify.bellLabel }}
              </span>
            </span>
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
            to="/admin/catalog"
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

        <div v-else-if="hasSecondaryNav" class="relative">
          <button
            type="button"
            class="touch-target rounded-xl px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            :aria-expanded="moreOpen"
            @click="moreOpen = !moreOpen"
          >
            {{ t('app.nav.more') }}
          </button>
          <div
            v-if="moreOpen"
            class="absolute left-0 top-full z-50 mt-1 min-w-[12rem] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg"
          >
            <RouterLink
              v-if="canKitchen"
              class="relative flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-orange-800 hover:bg-orange-50"
              to="/kitchen"
              @click="moreOpen = false"
            >
              <span class="inline-flex items-center gap-1.5">
                <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 1 0-14 0v5l-1.7 1.7A1 1 0 0 0 4 20h16a1 1 0 0 0 .7-1.7L19 16Z" />
                </svg>
                {{ t('app.nav.kitchen') }}
                <span
                  v-if="kitchenNotify.hasAlert"
                  class="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                >
                  {{ kitchenNotify.bellLabel }}
                </span>
              </span>
            </RouterLink>
            <RouterLink
              v-if="canDashboard"
              class="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              to="/dashboard"
              @click="moreOpen = false"
            >
              {{ t('app.nav.dashboard') }}
            </RouterLink>
            <RouterLink
              v-if="canReports"
              class="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              to="/reports"
              @click="moreOpen = false"
            >
              {{ t('app.nav.reports') }}
            </RouterLink>
            <RouterLink
              v-if="canHris"
              class="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              to="/hris"
              @click="moreOpen = false"
            >
              {{ t('app.nav.hris') }}
            </RouterLink>
            <RouterLink
              v-if="canAdmin"
              class="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              to="/admin/catalog"
              @click="moreOpen = false"
            >
              {{ t('app.nav.admin') }}
            </RouterLink>
            <RouterLink
              class="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              to="/status"
              @click="moreOpen = false"
            >
              {{ t('app.nav.runtime') }}
            </RouterLink>
          </div>
        </div>
      </template>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <label
          v-if="!isPos"
          class="hidden text-xs font-medium uppercase tracking-wide text-slate-500 sm:inline"
        >
          {{ t('app.locale') }}
        </label>
        <select
          class="touch-target min-w-[4.5rem] rounded-xl border border-slate-300 bg-white px-2 text-sm"
          :class="isPos ? 'hidden sm:inline-flex' : ''"
          :value="locale"
          @change="onLocaleChange"
        >
          <option value="id">ID</option>
          <option value="en">EN</option>
        </select>

        <template v-if="auth.isAuthenticated">
          <label
            v-if="!isPos"
            class="hidden text-xs font-medium uppercase tracking-wide text-slate-500 md:inline"
          >
            {{ t('app.store') }}
          </label>
          <select
            v-if="catalog.stores.length"
            class="touch-target max-w-[10rem] rounded-xl border border-slate-300 bg-white px-2 text-sm sm:max-w-[12rem]"
            :value="catalog.session?.storeId"
            @change="onStoreChange"
          >
            <option v-for="s in catalog.stores" :key="s.id" :value="s.id">
              {{ s.code }} · {{ s.name }}
            </option>
          </select>

          <div
            v-if="!isPos"
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
          v-else
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
