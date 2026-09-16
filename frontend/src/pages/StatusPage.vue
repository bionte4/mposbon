<script setup lang="ts">
import { onMounted, ref } from 'vue';
import MetricCard from '../components/MetricCard.vue';
import PageHeader from '../components/PageHeader.vue';
import UiPanel from '../components/UiPanel.vue';
import { apiGet } from '../api/client';
import { env, tenantSlugForRequest } from '../config/env';
import { useI18n } from '../i18n';

type Health = {
  ok: boolean;
  deploymentMode: string;
  licenseValidationMode: string;
};

type Tenant = { id: string; slug: string; name: string };
type Store = { id: string; code: string; name: string };

const { t } = useI18n();
const health = ref<Health | null>(null);
const tenant = ref<Tenant | null>(null);
const stores = ref<Store[]>([]);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    health.value = await apiGet<Health>('/health');
    tenant.value = await apiGet<Tenant>('/tenants/current');
    stores.value = await apiGet<Store[]>('/tenants/current/stores');
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('status.loadFailed');
  }
});
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
    <PageHeader :eyebrow="t('status.eyebrow')" :title="t('status.title')">
      <template #subtitleOnly>
        {{ t('status.tenantSlug') }}
        <code class="rounded bg-slate-200 px-1">{{ tenantSlugForRequest() }}</code>
        · {{ t('status.mode') }}
        <code class="rounded bg-slate-200 px-1">{{ env.deploymentMode }}</code>
      </template>
    </PageHeader>

    <p v-if="error" class="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
      {{ error }}
    </p>

    <section v-if="health" class="mb-6 grid gap-3 sm:grid-cols-2">
      <MetricCard :label="t('status.apiHealth')" :value="health.deploymentMode" />
      <MetricCard
        v-if="tenant"
        :label="t('status.resolvedTenant')"
        :value="tenant.name"
      />
    </section>

    <UiPanel v-if="stores.length" :padded="false">
      <ul>
        <li
          v-for="store in stores"
          :key="store.id"
          class="border-b border-slate-100 px-4 py-3 last:border-0"
        >
          {{ store.code }} — {{ store.name }}
        </li>
      </ul>
    </UiPanel>
  </main>
</template>
