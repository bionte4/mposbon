<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { CachedProduct } from '../db/pos-types';
import { formatIdrFromCents } from '../lib/money';
import { useI18n } from '../i18n';

const props = withDefaults(
  defineProps<{
    products: CachedProduct[];
    disabled?: boolean;
    /** Approx tile height incl. gap (px) for window math. */
    rowHeight?: number;
    /** Extra rows above/below viewport. */
    overscan?: number;
    modifiersBadge?: string;
    /** Skip windowing below this count (avoids empty/blank tile bugs). */
    virtualizeAbove?: number;
  }>(),
  {
    disabled: false,
    rowHeight: 112,
    overscan: 2,
    virtualizeAbove: 48,
  },
);

const emit = defineEmits<{
  select: [product: CachedProduct];
}>();

const { t } = useI18n();
const scroller = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportH = ref(400);
const cols = ref(2);

const badge = computed(() => props.modifiersBadge ?? t('pos.modifiers.badge'));
const useWindow = computed(() => props.products.length > props.virtualizeAbove);

/** Denser than before: more columns earlier for tablet POS density. */
function measureCols(): void {
  const w = scroller.value?.clientWidth ?? window.innerWidth;
  if (w >= 1400) cols.value = 6;
  else if (w >= 1100) cols.value = 5;
  else if (w >= 820) cols.value = 4;
  else if (w >= 560) cols.value = 3;
  else cols.value = 2;
}

function measureViewport(): void {
  if (!scroller.value) return;
  scrollTop.value = scroller.value.scrollTop;
  const h = scroller.value.clientHeight;
  // Flex layouts often report 0 on first paint — keep a usable fallback.
  viewportH.value = h > 40 ? h : Math.max(240, window.innerHeight * 0.35);
}

const rowCount = computed(() => Math.ceil(props.products.length / Math.max(1, cols.value)));

const startRow = computed(() => {
  if (!useWindow.value) return 0;
  return Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - props.overscan);
});

const endRow = computed(() => {
  if (!useWindow.value) return rowCount.value;
  const visible = Math.ceil(viewportH.value / props.rowHeight) + props.overscan * 2;
  return Math.min(rowCount.value, startRow.value + Math.max(visible, 1));
});

const windowed = computed(() => {
  if (!useWindow.value) {
    return props.products.map((product, index) => ({ product, index }));
  }
  const c = cols.value;
  const start = startRow.value * c;
  const end = endRow.value * c;
  return props.products.slice(start, end).map((product, i) => ({
    product,
    index: start + i,
  }));
});

const padTop = computed(() => (useWindow.value ? startRow.value * props.rowHeight : 0));
const padBottom = computed(() =>
  useWindow.value ? Math.max(0, (rowCount.value - endRow.value) * props.rowHeight) : 0,
);

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${cols.value}, minmax(0, 1fr))`,
}));

function onScroll(): void {
  measureViewport();
}

let ro: ResizeObserver | null = null;

async function remasure(): Promise<void> {
  measureCols();
  await nextTick();
  measureViewport();
}

function onWindowResize(): void {
  void remasure();
}

onMounted(() => {
  void remasure();
  requestAnimationFrame(() => {
    void remasure();
  });
  ro = new ResizeObserver(() => {
    void remasure();
  });
  if (scroller.value) ro.observe(scroller.value);
  window.addEventListener('resize', onWindowResize);
});

onUnmounted(() => {
  ro?.disconnect();
  window.removeEventListener('resize', onWindowResize);
});

watch(
  () => props.products.length,
  async () => {
    if (scroller.value && scroller.value.scrollTop > 0 && props.products.length < 24) {
      scroller.value.scrollTop = 0;
      scrollTop.value = 0;
    }
    await remasure();
  },
);
</script>

<template>
  <div
    ref="scroller"
    class="min-h-0 flex-1 overflow-auto overscroll-contain"
    @scroll.passive="onScroll"
  >
    <p
      v-if="!products.length"
      class="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-10 text-center text-sm text-slate-500"
    >
      {{ t('pos.emptyProducts') }}
    </p>
    <template v-else>
      <div :style="{ height: `${padTop}px` }" aria-hidden="true" />
      <div class="grid gap-1.5 sm:gap-2" :style="gridStyle">
        <button
          v-for="row in windowed"
          :key="row.product.id"
          class="pos-product-tile"
          type="button"
          :disabled="disabled"
          @click="emit('select', row.product)"
        >
          <p class="line-clamp-2 text-sm font-semibold leading-snug text-slate-900 sm:text-base">
            {{ row.product.name || '—' }}
          </p>
          <p
            v-if="row.product.modifierGroups?.length"
            class="mt-0.5 text-[11px] font-medium text-sky-700"
          >
            {{ badge }}
          </p>
          <p class="mt-1 text-sm font-semibold tabular-nums text-slate-700 sm:text-[0.95rem]">
            {{ formatIdrFromCents(row.product.unitPriceInCents) }}
          </p>
        </button>
      </div>
      <div :style="{ height: `${padBottom}px` }" aria-hidden="true" />
    </template>
  </div>
</template>
