<script setup lang="ts">
/**
 * Shift report archive — reopen X (open) / Z (closed) reports, export CSV, reprint ESC/POS.
 */
import { computed, onMounted, ref } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import UiPanel from '../components/UiPanel.vue';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';
import { buildZReportReceipt, sendToThermalPrinter } from '../lib/escpos';
import {
  fetchShiftArchive,
  fetchXReport,
  fetchZReport,
  type ShiftArchiveItem,
  type ZReport,
} from '../services/pos-api.service';
import { useAuthStore } from '../stores/auth.store';
import { useCatalogStore } from '../stores/catalog.store';
import { useToastStore } from '../stores/toast.store';

const { t } = useI18n();
const auth = useAuthStore();
const catalog = useCatalogStore();
const toast = useToastStore();

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const filterFrom = ref(isoDaysAgo(29));
const filterTo = ref(new Date().toISOString().slice(0, 10));
const filterStoreId = ref('');
const filterStatus = ref<'CLOSED' | 'OPEN' | 'ALL'>('ALL');
const items = ref<ShiftArchiveItem[]>([]);
const scope = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const detail = ref<ZReport | null>(null);
const detailBusy = ref(false);

const stores = computed(() => catalog.stores);
const canFilterStore = computed(() => auth.has('shift.view_all'));

onMounted(() => {
  void load();
});

async function load(): Promise<void> {
  if (!auth.has('shift.z_report')) {
    error.value = t('reports.denied');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    const data = await fetchShiftArchive({
      from: filterFrom.value || undefined,
      to: filterTo.value || undefined,
      storeId: canFilterStore.value && filterStoreId.value ? filterStoreId.value : undefined,
      status: filterStatus.value,
    });
    items.value = data.items;
    scope.value = data.scope;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('reports.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function openReport(row: ShiftArchiveItem): Promise<void> {
  detailBusy.value = true;
  error.value = null;
  try {
    detail.value =
      row.status === 'OPEN' ? await fetchXReport(row.shiftId) : await fetchZReport(row.shiftId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('reports.loadFailed');
  } finally {
    detailBusy.value = false;
  }
}

async function reprint(): Promise<void> {
  if (!detail.value) return;
  const r = detail.value;
  try {
    const bytes = buildZReportReceipt({
      storeName: r.shift.store.name,
      cashierName: r.shift.cashier.displayName,
      shiftId: r.shift.id,
      clockInAt: r.shift.clockInAt,
      clockOutAt: r.shift.clockOutAt,
      saleCount: r.sales.count,
      cashInCents: r.sales.cashInCents,
      cardInCents: r.sales.cardInCents,
      qrisInCents: r.sales.qrisInCents,
      grossInCents: r.sales.grossInCents,
      openingFloatInCents: r.drawer.openingFloatInCents,
      expectedCashInCents: r.drawer.expectedCashInCents,
      countedCashInCents: r.drawer.countedCashInCents ?? 0,
      discrepancyInCents: r.drawer.discrepancyInCents ?? 0,
      title: r.reportType === 'X' ? 'X-REPORT' : 'Z-REPORT',
    });
    const sent = await sendToThermalPrinter(bytes, { prompt: true });
    if (sent.ok) {
      toast.success(t('reports.printOk'), sent.method);
    } else {
      toast.warning(t('pos.toast.printerPreview'), t('pos.toast.printerPreviewBody'));
    }
  } catch (err) {
    toast.error(t('reports.printFailed'), err instanceof Error ? err.message : undefined);
  }
}

function exportCsv(): void {
  const headers = [
    'shift_id',
    'status',
    'store',
    'cashier',
    'clock_in',
    'clock_out',
    'sale_count',
    'gross_cents',
    'expected_cash_cents',
    'counted_cash_cents',
    'discrepancy_cents',
  ];
  const rows = items.value.map((i) =>
    [
      i.shiftId,
      i.status,
      i.store.code,
      i.cashier.displayName,
      i.clockInAt,
      i.clockOutAt ?? '',
      i.saleCount,
      i.grossSalesInCents,
      i.expectedCashInCents,
      i.countedCashInCents ?? '',
      i.discrepancyInCents ?? '',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const blob = new Blob([[headers.join(','), ...rows].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bonpos-shift-archive-${filterFrom.value}-${filterTo.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(t('reports.exportOk'));
}
</script>

<template>
  <main class="mx-auto max-w-6xl px-3 py-5 sm:px-4 sm:py-8">
    <PageHeader :eyebrow="t('reports.eyebrow')" :title="t('reports.title')">
      <template #subtitleOnly>
        {{ t('reports.subtitle') }}
        <span v-if="scope"> · {{ t('reports.scope') }} {{ scope }}</span>
      </template>
      <template #actions>
        <button
          type="button"
          class="touch-target rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold"
          :disabled="!items.length"
          @click="exportCsv"
        >
          {{ t('reports.exportCsv') }}
        </button>
        <button
          type="button"
          class="touch-target rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
          :disabled="busy"
          @click="load"
        >
          {{ t('common.reload') }}
        </button>
      </template>
    </PageHeader>

    <section class="mb-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
      <label class="text-sm font-medium text-slate-600">
        {{ t('reports.filterFrom') }}
        <input v-model="filterFrom" class="mt-1 min-h-11 w-full rounded-xl border px-3" type="date" />
      </label>
      <label class="text-sm font-medium text-slate-600">
        {{ t('reports.filterTo') }}
        <input v-model="filterTo" class="mt-1 min-h-11 w-full rounded-xl border px-3" type="date" />
      </label>
      <label v-if="canFilterStore" class="text-sm font-medium text-slate-600">
        {{ t('reports.filterStore') }}
        <select v-model="filterStoreId" class="mt-1 min-h-11 w-full rounded-xl border px-3">
          <option value="">{{ t('reports.allStores') }}</option>
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} · {{ s.name }}</option>
        </select>
      </label>
      <label class="text-sm font-medium text-slate-600">
        {{ t('reports.filterStatus') }}
        <select v-model="filterStatus" class="mt-1 min-h-11 w-full rounded-xl border px-3">
          <option value="ALL">{{ t('reports.statusAll') }}</option>
          <option value="CLOSED">{{ t('reports.statusClosed') }}</option>
          <option value="OPEN">{{ t('reports.statusOpen') }}</option>
        </select>
      </label>
      <div class="flex items-end">
        <button
          type="button"
          class="touch-target w-full rounded-xl bg-emerald-700 text-sm font-semibold text-white"
          :disabled="busy"
          @click="load"
        >
          {{ t('reports.apply') }}
        </button>
      </div>
    </section>

    <p v-if="error" class="mb-4 rounded-2xl bg-red-50 p-3 text-red-800">{{ error }}</p>

    <div class="grid gap-4 lg:grid-cols-2">
      <UiPanel :title="t('reports.listTitle')" :padded="false">
        <ul class="max-h-[32rem] divide-y divide-slate-100 overflow-auto">
          <li
            v-for="row in items"
            :key="row.shiftId"
            class="cursor-pointer px-4 py-3 hover:bg-slate-50"
            @click="openReport(row)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-medium text-slate-900">
                  {{ row.cashier.displayName }} · {{ row.store.code }}
                </p>
                <p class="text-xs text-slate-500">
                  {{ new Date(row.clockInAt).toLocaleString() }}
                  <template v-if="row.clockOutAt">
                    → {{ new Date(row.clockOutAt).toLocaleString() }}
                  </template>
                </p>
              </div>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                :class="
                  row.status === 'OPEN'
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-slate-200 text-slate-800'
                "
              >
                {{ row.status === 'OPEN' ? 'X' : 'Z' }}
              </span>
            </div>
            <p class="mt-1 text-sm text-slate-600">
              {{
                t('reports.rowLine', {
                  count: row.saleCount,
                  gross: formatIdrFromCents(row.grossSalesInCents),
                  disc:
                    row.discrepancyInCents == null
                      ? t('common.empty')
                      : formatIdrFromCents(row.discrepancyInCents),
                })
              }}
            </p>
          </li>
          <li v-if="!items.length" class="px-4 py-8 text-sm text-slate-500">
            {{ t('reports.empty') }}
          </li>
        </ul>
      </UiPanel>

      <UiPanel :title="t('reports.detailTitle')">
        <p v-if="detailBusy" class="text-sm text-slate-500">{{ t('common.loading') }}</p>
        <div v-else-if="detail" class="space-y-4 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="text-lg font-semibold">
                {{ detail.reportType === 'X' ? t('reports.xReport') : t('reports.zReport') }}
              </p>
              <p class="text-slate-600">
                {{ detail.shift.cashier.displayName }} · {{ detail.shift.store.name }}
              </p>
            </div>
            <button
              type="button"
              class="touch-target rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
              @click="reprint"
            >
              {{ t('reports.reprint') }}
            </button>
          </div>

          <div class="grid gap-2 sm:grid-cols-2">
            <p>{{ t('reports.salesCount') }}: <strong>{{ detail.sales.count }}</strong></p>
            <p>
              {{ t('reports.gross') }}:
              <strong class="tabular-nums">{{ formatIdrFromCents(detail.sales.grossInCents) }}</strong>
            </p>
            <p>
              {{ t('reports.cash') }}:
              <span class="tabular-nums">{{ formatIdrFromCents(detail.sales.cashInCents) }}</span>
            </p>
            <p>
              {{ t('reports.card') }}:
              <span class="tabular-nums">{{ formatIdrFromCents(detail.sales.cardInCents) }}</span>
            </p>
            <p>
              {{ t('reports.qris') }}:
              <span class="tabular-nums">{{ formatIdrFromCents(detail.sales.qrisInCents) }}</span>
            </p>
            <p>
              {{ t('reports.net') }}:
              <span class="tabular-nums">{{ formatIdrFromCents(detail.sales.netInCents) }}</span>
            </p>
          </div>

          <div class="rounded-2xl bg-slate-50 px-4 py-3">
            <p class="mb-2 font-semibold">{{ t('reports.drawer') }}</p>
            <p>
              {{ t('reports.float') }}:
              {{ formatIdrFromCents(detail.drawer.openingFloatInCents) }}
            </p>
            <p>
              {{ t('reports.expected') }}:
              {{ formatIdrFromCents(detail.drawer.expectedCashInCents) }}
            </p>
            <p>
              {{ t('reports.counted') }}:
              {{
                detail.drawer.countedCashInCents == null
                  ? t('common.empty')
                  : formatIdrFromCents(detail.drawer.countedCashInCents)
              }}
            </p>
            <p>
              {{ t('reports.discrepancy') }}:
              <strong
                :class="
                  detail.drawer.discrepancyInCents && detail.drawer.discrepancyInCents !== 0
                    ? 'text-red-700'
                    : ''
                "
              >
                {{
                  detail.drawer.discrepancyInCents == null
                    ? t('common.empty')
                    : formatIdrFromCents(detail.drawer.discrepancyInCents)
                }}
              </strong>
            </p>
          </div>
        </div>
        <p v-else class="text-sm text-slate-500">{{ t('reports.detailHint') }}</p>
      </UiPanel>
    </div>
  </main>
</template>
