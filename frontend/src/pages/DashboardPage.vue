<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue';
import MetricCard from '../components/MetricCard.vue';
import PageHeader from '../components/PageHeader.vue';
import UiPanel from '../components/UiPanel.vue';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';
import {
  downloadJournalCsv,
  downloadSalesCsv,
  fetchDashboardOverview,
  fetchShiftWidgets,
  fetchTopProducts,
  type DashboardOverview,
  type ShiftWidgets,
  type TopProductsResponse,
} from '../services/analytics-api.service';
import { fetchAdminStores, type AdminStore } from '../services/admin-api.service';
import { useAuthStore } from '../stores/auth.store';
import { useCatalogStore } from '../stores/catalog.store';
import { useToastStore } from '../stores/toast.store';

/** Defer Chart.js until the chart region scrolls into view. */
const DashboardCharts = defineAsyncComponent(() => import('../components/DashboardCharts.vue'));

const { t } = useI18n();
const auth = useAuthStore();
const catalog = useCatalogStore();
const toast = useToastStore();
const overview = ref<DashboardOverview | null>(null);
const top = ref<TopProductsResponse | null>(null);
const shifts = ref<ShiftWidgets | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const exporting = ref(false);
const chartsVisible = ref(false);
const chartSentinel = ref<HTMLElement | null>(null);
const stores = ref<AdminStore[]>([]);

const canExport = computed(() => auth.has('dashboard.read_store'));
const canFilterStore = computed(() => auth.has('dashboard.read_store'));

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const filterFrom = ref(isoDateDaysAgo(6));
const filterTo = ref(new Date().toISOString().slice(0, 10));
const filterStoreId = ref('');

const queryOpts = computed(() => ({
  from: filterFrom.value || undefined,
  to: filterTo.value || undefined,
  storeId: canFilterStore.value && filterStoreId.value ? filterStoreId.value : undefined,
}));

let chartObserver: IntersectionObserver | null = null;

onMounted(async () => {
  if (canFilterStore.value) {
    try {
      if (catalog.stores.length) {
        stores.value = catalog.stores.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          qrisPayload: null,
        }));
      } else if (auth.has('admin.access')) {
        stores.value = await fetchAdminStores();
      }
    } catch {
      // Store filter optional — overview still loads.
    }
  }
  void load();
  await nextTick();
  chartObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        chartsVisible.value = true;
        chartObserver?.disconnect();
        chartObserver = null;
      }
    },
    { rootMargin: '120px' },
  );
  if (chartSentinel.value) chartObserver.observe(chartSentinel.value);
});

onUnmounted(() => {
  chartObserver?.disconnect();
});

async function load(): Promise<void> {
  if (!auth.has('dashboard.read')) {
    error.value = t('dashboard.denied');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    const opts = queryOpts.value;
    const [o, tData, s] = await Promise.all([
      fetchDashboardOverview(opts),
      fetchTopProducts(opts),
      fetchShiftWidgets(),
    ]);
    overview.value = o;
    top.value = tData;
    shifts.value = s;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('dashboard.loadFailed');
  } finally {
    busy.value = false;
  }
}

function applyPreset(days: number): void {
  filterFrom.value = isoDateDaysAgo(days - 1);
  filterTo.value = new Date().toISOString().slice(0, 10);
  void load();
}

async function exportJournal(): Promise<void> {
  if (!canExport.value) return;
  exporting.value = true;
  try {
    await downloadJournalCsv(queryOpts.value);
    toast.success(t('dashboard.exportOk'));
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('dashboard.exportFailed');
  } finally {
    exporting.value = false;
  }
}

async function exportSales(): Promise<void> {
  if (!canExport.value) return;
  exporting.value = true;
  try {
    await downloadSalesCsv(queryOpts.value);
    toast.success(t('dashboard.exportOk'));
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('dashboard.exportFailed');
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <main class="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-5">
    <PageHeader compact :eyebrow="t('dashboard.eyebrow')" :title="t('dashboard.title')">
      <template #subtitleOnly>
        {{ t('dashboard.source') }}:
        <code class="rounded bg-slate-200 px-1">{{ overview?.source || '…' }}</code>
        · {{ t('dashboard.scope') }} {{ overview?.scope || '…' }}
        <template v-if="overview?.from && overview?.to">
          · {{ overview.from }} → {{ overview.to }}
        </template>
      </template>
      <template #actions>
        <button
          v-if="canExport"
          class="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800"
          type="button"
          :disabled="exporting"
          @click="exportSales"
        >
          {{ t('dashboard.exportSales') }}
        </button>
        <button
          v-if="canExport"
          class="min-h-9 rounded-lg border border-teal-700 bg-teal-700 px-3 text-sm font-semibold text-white"
          type="button"
          :disabled="exporting"
          @click="exportJournal"
        >
          {{ t('dashboard.exportJournal') }}
        </button>
        <button
          class="min-h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white"
          type="button"
          :disabled="busy"
          @click="load"
        >
          {{ t('common.reload') }}
        </button>
      </template>
    </PageHeader>

    <section
      v-if="canFilterStore"
      class="mb-3 grid gap-2 rounded-xl border border-slate-200 bg-white p-2.5 sm:grid-cols-2 lg:grid-cols-5"
    >
      <label class="text-sm font-medium text-slate-600">
        {{ t('dashboard.filterFrom') }}
        <input
          v-model="filterFrom"
          class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
          type="date"
        />
      </label>
      <label class="text-sm font-medium text-slate-600">
        {{ t('dashboard.filterTo') }}
        <input
          v-model="filterTo"
          class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
          type="date"
        />
      </label>
      <label class="text-sm font-medium text-slate-600 sm:col-span-2 lg:col-span-1">
        {{ t('dashboard.filterStore') }}
        <select
          v-model="filterStoreId"
          class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
        >
          <option value="">{{ t('dashboard.filterAllStores') }}</option>
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} · {{ s.name }}</option>
        </select>
      </label>
      <div class="flex flex-wrap items-end gap-2 lg:col-span-1">
        <button
          type="button"
          class="min-h-9 rounded-lg bg-slate-100 px-2.5 text-sm font-semibold"
          @click="applyPreset(7)"
        >
          7d
        </button>
        <button
          type="button"
          class="min-h-9 rounded-lg bg-slate-100 px-2.5 text-sm font-semibold"
          @click="applyPreset(30)"
        >
          30d
        </button>
        <button
          type="button"
          class="min-h-9 flex-1 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-40"
          :disabled="busy"
          @click="load"
        >
          {{ t('dashboard.applyFilters') }}
        </button>
      </div>
    </section>

    <p v-if="error" class="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{{ error }}</p>

    <section v-if="overview" class="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <MetricCard
        dense
        :label="t('dashboard.gross')"
        :value="formatIdrFromCents(overview.metrics.grossSalesInCents)"
      />
      <MetricCard
        dense
        :label="t('dashboard.net')"
        :value="formatIdrFromCents(overview.metrics.netSalesInCents)"
      />
      <MetricCard
        dense
        :label="t('dashboard.transactions')"
        :value="overview.metrics.transactionCount"
      />
      <MetricCard
        dense
        :label="t('dashboard.aov')"
        :value="formatIdrFromCents(overview.metrics.aovInCents)"
      />
      <MetricCard
        dense
        :label="t('dashboard.void')"
        :value="formatIdrFromCents(overview.metrics.voidInCents)"
        tone="danger"
      />
    </section>

    <UiPanel
      v-if="overview?.drawer"
      dense
      class="mb-3 !border-amber-200 !bg-amber-50"
      :title="t('dashboard.drawerTitle')"
    >
      <div class="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <p>{{ t('dashboard.status') }}: {{ overview.drawer.status }}</p>
        <p>
          {{ t('dashboard.float') }}:
          {{ formatIdrFromCents(overview.drawer.openingFloatInCents) }}
        </p>
        <p>
          {{ t('dashboard.expected') }}:
          {{ formatIdrFromCents(overview.drawer.expectedCashInCents) }}
        </p>
        <p>
          {{ t('dashboard.discrepancy') }}:
          {{
            overview.drawer.discrepancyInCents == null
              ? t('common.empty')
              : formatIdrFromCents(overview.drawer.discrepancyInCents)
          }}
        </p>
      </div>
    </UiPanel>

    <div ref="chartSentinel" class="mb-3 min-h-[1px]">
      <DashboardCharts v-if="chartsVisible" :overview="overview" :top="top" />
      <section
        v-else
        class="grid gap-2 lg:grid-cols-2"
        aria-hidden="true"
      >
        <UiPanel dense :title="t('dashboard.salesTrend')">
          <div class="flex h-52 items-center justify-center text-sm text-slate-400">
            {{ t('dashboard.chartsLoading') }}
          </div>
        </UiPanel>
        <UiPanel dense :title="t('dashboard.topProducts')">
          <div class="flex h-52 items-center justify-center text-sm text-slate-400">
            {{ t('dashboard.chartsLoading') }}
          </div>
        </UiPanel>
      </section>
    </div>

    <section class="grid gap-2 lg:grid-cols-2">
      <UiPanel dense :title="t('dashboard.openShifts')">
        <ul class="divide-y divide-slate-100 overflow-hidden rounded-lg ring-1 ring-slate-100">
          <li
            v-for="s in shifts?.openShifts ?? []"
            :key="s.shiftId"
            class="bg-white px-2.5 py-1.5 text-sm"
          >
            <p class="font-medium">{{ s.cashier.displayName }} · {{ s.store.code }}</p>
            <p class="text-slate-600">
              {{
                t('dashboard.shiftLine', {
                  count: s.saleCount,
                  cash: formatIdrFromCents(s.cashSalesInCents),
                  expected: formatIdrFromCents(s.expectedCashInCents),
                })
              }}
            </p>
          </li>
          <li v-if="!(shifts?.openShifts.length)" class="px-2.5 py-2 text-sm text-slate-500">
            {{ t('dashboard.noOpenShifts') }}
          </li>
        </ul>
      </UiPanel>
      <UiPanel dense>
        <div class="mb-2 flex items-center justify-between gap-2">
          <h2 class="text-sm font-semibold text-slate-900">{{ t('dashboard.zReports') }}</h2>
          <span
            v-if="shifts?.discrepancyAlertCount"
            class="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800"
          >
            {{ t('dashboard.discrepancyCount', { count: shifts.discrepancyAlertCount }) }}
          </span>
        </div>
        <ul class="max-h-72 divide-y divide-slate-100 overflow-auto rounded-lg ring-1 ring-slate-100">
          <li
            v-for="z in shifts?.zReports ?? []"
            :key="z.shiftId"
            class="bg-white px-2.5 py-1.5 text-sm"
          >
            <p class="font-medium">{{ z.cashier.displayName }} · {{ z.store.name }}</p>
            <p class="text-slate-600">
              {{
                t('dashboard.zLine', {
                  gross: formatIdrFromCents(z.grossSalesInCents),
                  counted:
                    z.countedCashInCents == null
                      ? t('common.empty')
                      : formatIdrFromCents(z.countedCashInCents),
                  discrepancy:
                    z.discrepancyInCents == null
                      ? t('common.empty')
                      : formatIdrFromCents(z.discrepancyInCents),
                })
              }}
            </p>
          </li>
          <li v-if="!(shifts?.zReports.length)" class="px-2.5 py-2 text-sm text-slate-500">
            {{ t('dashboard.noZReports') }}
          </li>
        </ul>
      </UiPanel>
    </section>
  </main>
</template>
