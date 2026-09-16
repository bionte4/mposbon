<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { parseApiError } from '../api/parse-error';
import { useI18n } from '../i18n';
import { useAuthStore } from '../stores/auth.store';
import { useCatalogStore } from '../stores/catalog.store';
import { useToastStore } from '../stores/toast.store';

const { t } = useI18n();
const auth = useAuthStore();
const catalog = useCatalogStore();
const toast = useToastStore();
const router = useRouter();

const email = ref(localStorage.getItem('bonpos.actingEmail') || 'cashier@bonpos.local');
const pin = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

const demos = computed(() => [
  { email: 'cashier@bonpos.local', label: t('app.roles.cashier') },
  { email: 'kitchen@bonpos.local', label: t('app.roles.kitchen') },
  { email: 'bar@bonpos.local', label: t('app.roles.bar') },
  { email: 'manager@bonpos.local', label: t('app.roles.manager') },
  { email: 'admin@bonpos.local', label: t('app.roles.admin') },
]);

function fillDemo(demoEmail: string): void {
  email.value = demoEmail;
  pin.value = '1234';
  error.value = null;
}

async function submit(): Promise<void> {
  if (!email.value.trim() || !pin.value) {
    error.value = t('auth.formRequired');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await auth.login(email.value, pin.value);
    await catalog.refreshFromApi();
    toast.success(t('auth.welcome'), auth.staff?.displayName);
    const redirectQuery = typeof router.currentRoute.value.query.redirect === 'string'
      ? router.currentRoute.value.query.redirect
      : null;
    const home = auth.has('pos.sale.create')
      ? '/pos'
      : auth.has('kitchen.display')
        ? '/kitchen'
        : '/status';
    const redirect = redirectQuery?.startsWith('/') ? redirectQuery : home;
    await router.replace(redirect);
  } catch (err) {
    error.value = parseApiError(err).message || t('app.loginFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-4 py-10">
    <div class="mb-8 text-center">
      <p class="text-sm font-semibold uppercase tracking-wide text-teal-800">{{ t('app.name') }}</p>
      <h1 class="mt-2 text-3xl font-bold text-slate-900">{{ t('auth.title') }}</h1>
      <p class="mt-2 text-sm text-slate-600">{{ t('auth.subtitle') }}</p>
    </div>

    <form class="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" @submit.prevent="submit">
      <label class="block text-sm font-medium text-slate-700">
        {{ t('auth.email') }}
        <input
          v-model="email"
          class="mt-1 min-h-12 w-full rounded-2xl border border-slate-300 px-3"
          type="email"
          autocomplete="username"
          required
        />
      </label>
      <label class="block text-sm font-medium text-slate-700">
        {{ t('auth.pin') }}
        <input
          v-model="pin"
          class="mt-1 min-h-12 w-full rounded-2xl border border-slate-300 px-3 tracking-[0.35em]"
          type="password"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="8"
          autocomplete="current-password"
          required
        />
      </label>

      <p v-if="error" class="rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-800">{{ error }}</p>

      <button
        type="submit"
        class="touch-target w-full rounded-2xl bg-slate-900 text-base font-semibold text-white disabled:opacity-50"
        :disabled="busy"
      >
        {{ busy ? t('common.loading') : t('auth.login') }}
      </button>
    </form>

    <div class="mt-6">
      <p class="mb-2 text-center text-xs font-medium uppercase tracking-wide text-slate-500">
        {{ t('auth.demoHint') }}
      </p>
      <div class="flex flex-wrap justify-center gap-2">
        <button
          v-for="d in demos"
          :key="d.email"
          type="button"
          class="touch-target rounded-2xl bg-white px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200"
          @click="fillDemo(d.email)"
        >
          {{ d.label }}
        </button>
      </div>
    </div>
  </main>
</template>
