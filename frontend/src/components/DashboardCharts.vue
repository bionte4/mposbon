<script setup lang="ts">
/**
 * Chart.js is heavy — keep it out of the Dashboard page's critical path.
 * Parent mounts this only after IntersectionObserver sees the chart region.
 */
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { computed } from 'vue';
import { Bar, Line } from 'vue-chartjs';
import UiPanel from './UiPanel.vue';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';
import type { DashboardOverview, TopProductsResponse } from '../services/analytics-api.service';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
);

const props = defineProps<{
  overview: DashboardOverview | null;
  top: TopProductsResponse | null;
}>();

const { t } = useI18n();

const moneyTick = {
  callback(value: string | number) {
    const n = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return String(value);
    }
    return formatIdrFromCents(n);
  },
};

const salesChart = computed(() => {
  const series = props.overview?.series ?? [];
  return {
    labels: series.map((r) => r.date),
    datasets: [
      {
        label: t('dashboard.chartGross'),
        data: series.map((r) => r.grossSalesInCents),
        borderColor: '#0f766e',
        backgroundColor: 'rgba(15, 118, 110, 0.15)',
        tension: 0.3,
      },
      {
        label: t('dashboard.chartNet'),
        data: series.map((r) => r.netSalesInCents),
        borderColor: '#1d4ed8',
        backgroundColor: 'rgba(29, 78, 216, 0.12)',
        tension: 0.3,
      },
    ],
  };
});

const topChart = computed(() => {
  const items = props.top?.items ?? [];
  return {
    labels: items.map((i) => i.productName),
    datasets: [
      {
        label: t('dashboard.chartQty'),
        data: items.map((i) => i.quantitySold),
        backgroundColor: '#0f766e',
      },
    ],
  };
});

const salesChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' as const },
    tooltip: {
      callbacks: {
        label(ctx: { dataset: { label?: string }; parsed: { y: number | null } }) {
          const y = ctx.parsed.y ?? 0;
          return `${ctx.dataset.label ?? ''}: ${formatIdrFromCents(Math.trunc(y))}`;
        },
      },
    },
  },
  scales: {
    y: { ticks: moneyTick },
  },
}));

const topChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom' as const } },
  indexAxis: 'y' as const,
};
</script>

<template>
  <section class="mb-3 grid gap-2 lg:grid-cols-2">
    <UiPanel dense :title="t('dashboard.salesTrend')">
      <div class="h-52">
        <Line
          v-if="overview?.scope === 'store' && (overview.series?.length ?? 0) > 0"
          :data="salesChart"
          :options="salesChartOptions"
        />
        <p v-else class="text-sm text-slate-500">
          {{
            overview?.scope === 'cashier'
              ? t('dashboard.cashierScopeHint')
              : t('dashboard.noSeries')
          }}
        </p>
      </div>
    </UiPanel>
    <UiPanel dense :title="t('dashboard.topProducts')">
      <div class="h-52">
        <Bar
          v-if="(top?.items.length ?? 0) > 0"
          :data="topChart"
          :options="topChartOptions"
        />
        <p v-else class="text-sm text-slate-500">{{ t('dashboard.noTop') }}</p>
      </div>
    </UiPanel>
  </section>
</template>
