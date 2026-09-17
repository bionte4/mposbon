<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { parseApiError } from '../api/parse-error';
import { setLocale, useI18n, type LocaleCode } from '../i18n';
import { fetchPublicBranding, type TenantBranding } from '../services/admin-api.service';
import { useAuthStore } from '../stores/auth.store';
import { useCatalogStore } from '../stores/catalog.store';
import { useToastStore } from '../stores/toast.store';

const { t, locale } = useI18n();
const auth = useAuthStore();
const catalog = useCatalogStore();
const toast = useToastStore();
const router = useRouter();

const email = ref(localStorage.getItem('bonpos.actingEmail') || 'cashier@bonpos.local');
const pin = ref('');
const busy = ref(false);
const error = ref<string | null>(null);
const branding = ref<TenantBranding | null>(null);
const logoBroken = ref(false);

const showDemos =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';

const demos = computed(() => [
  { email: 'cashier@bonpos.local', label: t('app.roles.cashier') },
  { email: 'kitchen@bonpos.local', label: t('app.roles.kitchen') },
  { email: 'bar@bonpos.local', label: t('app.roles.bar') },
  { email: 'manager@bonpos.local', label: t('app.roles.manager') },
  { email: 'admin@bonpos.local', label: t('app.roles.admin') },
]);

const brandName = computed(() => branding.value?.brandName || t('app.name'));
const accent = computed(() => branding.value?.accentColor || '#0f766e');
const hasLogo = computed(() => Boolean(branding.value?.logoUrl && !logoBroken.value));

const loginStyle = computed(() => ({
  '--login-accent': accent.value,
  '--login-accent-soft': `${accent.value}28`,
}));

function fillDemo(demoEmail: string): void {
  email.value = demoEmail;
  pin.value = '1234';
  error.value = null;
}

function onLocaleChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as LocaleCode;
  setLocale(value);
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
    const redirectQuery =
      typeof router.currentRoute.value.query.redirect === 'string'
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

onMounted(async () => {
  try {
    branding.value = await fetchPublicBranding();
    logoBroken.value = false;
  } catch {
    branding.value = null;
  }
});
</script>

<template>
  <main class="login-page relative flex min-h-[100dvh] flex-col overflow-hidden" :style="loginStyle">
    <div class="login-page__wash pointer-events-none absolute inset-0" aria-hidden="true" />

    <div class="login-page__logo-bg pointer-events-none absolute inset-0" aria-hidden="true">
      <img
        v-if="hasLogo"
        :src="branding!.logoUrl!"
        alt=""
        class="login-page__logo-img"
        @error="logoBroken = true"
      />
      <div v-else class="login-page__logo-word" :style="{ color: accent }">
        {{ brandName }}
      </div>
    </div>

    <div class="login-page__veil pointer-events-none absolute inset-0" aria-hidden="true" />

    <div
      class="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 sm:px-6 sm:py-10"
    >
      <section
        class="login-form rounded-3xl border border-white/80 bg-white/95 p-5 text-center shadow-[0_28px_64px_-28px_rgba(15,23,42,0.4)] backdrop-blur-md sm:p-7"
      >
        <!-- Brand + locale inside the card, all centered -->
        <div class="mb-5 flex flex-col items-center sm:mb-6">
          <div
            class="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-200/80 sm:h-[4.5rem] sm:w-[4.5rem]"
          >
            <img
              v-if="hasLogo"
              :src="branding!.logoUrl!"
              :alt="brandName"
              class="max-h-10 max-w-12 object-contain sm:max-h-11 sm:max-w-14"
              @error="logoBroken = true"
            />
            <span
              v-else
              class="font-display text-2xl font-bold sm:text-3xl"
              :style="{ color: accent }"
            >
              {{ brandName.slice(0, 1).toUpperCase() }}
            </span>
          </div>

          <p class="font-display text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
            {{ brandName }}
          </p>

          <label
            class="mt-3 inline-flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            <span>{{ t('app.locale') }}</span>
            <select
              class="min-h-9 rounded-xl border border-slate-300/80 bg-white px-2.5 text-sm font-medium normal-case tracking-normal text-slate-800"
              :value="locale"
              @change="onLocaleChange"
            >
              <option value="id">ID</option>
              <option value="en">EN</option>
            </select>
          </label>
        </div>

        <h1 class="font-display text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          {{ t('auth.title') }}
        </h1>
        <p class="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-slate-500">
          {{ t('auth.subtitle') }}
        </p>

        <form class="mt-6 space-y-4 text-left" @submit.prevent="submit">
          <label class="block text-center text-sm font-medium text-slate-700">
            {{ t('auth.email') }}
            <input
              v-model="email"
              class="mt-1.5 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-center transition focus:border-[color:var(--login-accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--login-accent-soft)]"
              type="email"
              autocomplete="username"
              required
            />
          </label>
          <label class="block text-center text-sm font-medium text-slate-700">
            {{ t('auth.pin') }}
            <input
              v-model="pin"
              class="mt-1.5 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-center tracking-[0.35em] transition focus:border-[color:var(--login-accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--login-accent-soft)]"
              type="password"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="8"
              autocomplete="current-password"
              required
            />
          </label>

          <p
            v-if="error"
            class="rounded-2xl bg-red-50 px-3 py-2 text-center text-sm text-red-800"
            role="alert"
          >
            {{ error }}
          </p>

          <button
            type="submit"
            class="touch-target w-full rounded-2xl text-base font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            :style="{ backgroundColor: accent, boxShadow: `0 14px 28px -12px ${accent}` }"
            :disabled="busy"
          >
            {{ busy ? t('common.loading') : t('auth.login') }}
          </button>
        </form>

        <div v-if="showDemos" class="mt-6 border-t border-slate-100 pt-5">
          <p class="mb-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {{ t('auth.demoHint') }}
          </p>
          <div class="flex flex-wrap justify-center gap-2">
            <button
              v-for="d in demos"
              :key="d.email"
              type="button"
              class="min-h-10 rounded-xl bg-slate-50 px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200/80 transition hover:bg-white hover:ring-slate-300"
              @click="fillDemo(d.email)"
            >
              {{ d.label }}
            </button>
          </div>
        </div>
      </section>

      <p class="mt-5 text-center text-[0.7rem] text-slate-500/80">
        {{ t('auth.poweredBy') }}
      </p>
    </div>
  </main>
</template>

<style scoped>
.login-page__wash {
  background:
    radial-gradient(ellipse 70% 50% at 50% 18%, var(--login-accent-soft), transparent 60%),
    linear-gradient(165deg, #f4f7f6 0%, #e8f0ee 45%, #e4e9ef 100%);
}

.login-page__logo-bg {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 6vh;
}

.login-page__logo-img {
  width: min(68vmin, 26rem);
  height: min(68vmin, 26rem);
  object-fit: contain;
  opacity: 0.12;
  filter: grayscale(0.12);
  animation: logo-bg-in 0.9s ease-out both;
}

.login-page__logo-word {
  max-width: 90vw;
  padding: 0 1rem;
  font-family: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(2.25rem, 11vw, 5.5rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1;
  text-align: center;
  opacity: 0.09;
  user-select: none;
  animation: logo-word-in 0.9s ease-out both;
}

.login-page__veil {
  background: linear-gradient(
    180deg,
    rgba(247, 250, 249, 0.4) 0%,
    rgba(247, 250, 249, 0.58) 50%,
    rgba(247, 250, 249, 0.78) 100%
  );
}

.login-form {
  animation: login-rise 0.55s ease-out both;
}

@keyframes logo-bg-in {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 0.12;
    transform: scale(1);
  }
}

@keyframes logo-word-in {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 0.09;
    transform: scale(1);
  }
}

@keyframes login-rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
