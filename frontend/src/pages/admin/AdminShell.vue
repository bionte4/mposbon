<script setup lang="ts">
import { computed, provide, ref, type Ref } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import PageHeader from '../../components/PageHeader.vue';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';

export type AdminShellApi = {
  error: Ref<string | null>;
  busy: Ref<boolean>;
  setError: (msg: string | null) => void;
  setBusy: (v: boolean) => void;
};

type HubKey = 'catalog' | 'inventory' | 'outlet' | 'team' | 'system';

const { t } = useI18n();
const auth = useAuthStore();
const route = useRoute();

const error = ref<string | null>(null);
const busy = ref(false);

function setError(msg: string | null): void {
  error.value = msg;
}

function setBusy(v: boolean): void {
  busy.value = v;
}

provide<AdminShellApi>('adminShell', { error, busy, setError, setBusy });

const hubs = computed(() => {
  const all: Array<{ key: HubKey; to: string; visible: boolean }> = [
    { key: 'catalog', to: '/admin/catalog', visible: true },
    {
      key: 'inventory',
      to: '/admin/inventory',
      visible:
        auth.has('admin.inventory.read') ||
        auth.has('admin.inventory.write') ||
        auth.has('admin.purchasing.write'),
    },
    {
      key: 'outlet',
      to: '/admin/outlet',
      visible: auth.has('admin.outlet.write') || auth.has('admin.access'),
    },
    { key: 'team', to: '/admin/team', visible: auth.has('admin.staff.read') },
    {
      key: 'system',
      to: '/admin/system',
      visible: auth.has('admin.finance.read') || auth.has('admin.access'),
    },
  ];
  return all.filter((h) => h.visible);
});

const activeHub = computed(() => (route.meta.hub as HubKey | undefined) ?? 'catalog');

function reloadActive(): void {
  window.dispatchEvent(new CustomEvent('admin:reload'));
}
</script>

<template>
  <main class="mx-auto max-w-6xl px-3 py-3 sm:px-4 sm:py-4">
    <PageHeader
      compact
      :eyebrow="t('admin.eyebrow')"
      :title="t('admin.title')"
      :subtitle="t('admin.subtitle')"
    >
      <template #actions>
        <button
          class="min-h-10 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-40"
          type="button"
          :disabled="busy"
          @click="reloadActive"
        >
          {{ t('common.reload') }}
        </button>
      </template>
    </PageHeader>

    <p v-if="error" class="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{{ error }}</p>

    <template v-if="auth.has('admin.access')">
      <nav class="mb-3 flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Admin hubs">
        <RouterLink
          v-for="hub in hubs"
          :key="hub.key"
          :to="hub.to"
          class="admin-hub-tab shrink-0"
          :class="
            activeHub === hub.key
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 ring-1 ring-slate-200'
          "
        >
          {{ t(`admin.hubs.${hub.key}`) }}
        </RouterLink>
      </nav>

      <RouterView />
    </template>

    <p v-else class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{{ t('admin.denied') }}</p>
  </main>
</template>
