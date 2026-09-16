<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
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
  }>(),
  {
    disabled: false,
    rowHeight: 148,
    overscan: 2,
  },
);

const emit = defineEmits<{
  select: [product: CachedProduct];
}>();

const { t } = useI18n();
const scroller = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportH = ref(480);
const cols = ref(2);

const badge = computed(() => props.modifiersBadge ?? t('pos.modifiers.badge'));

function measureCols(): void {
  const w = scroller.value?.clientWidth ?? window.innerWidth;
  if (w >= 1280) cols.value = 6;
  else if (w >= 1024) cols.value = 5;
  else if (w >= 768) cols.value = 4;
  else if (w >= 640) cols.value = 3;
  else cols.value = 2;
}

const rowCount = computed(() => Math.ceil(props.products.length / Math.max(1, cols.value)));

const startRow = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - props.overscan),
);

const endRow = computed(() => {
  const visible = Math.ceil(viewportH.value / props.rowHeight) + props.overscan * 2;
  return Math.min(rowCount.value, startRow.value + visible);
});

const windowed = computed(() => {
  const c = cols.value;
  const start = startRow.value * c;
  const end = endRow.value * c;
  return props.products.slice(start, end).map((product, i) => ({
    product,
    index: start + i,
  }));
});

const padTop = computed(() => startRow.value * props.rowHeight);
const padBottom = computed(() =>
  Math.max(0, (rowCount.value - endRow.value) * props.rowHeight),
);

function onScroll(): void {
  if (!scroller.value) return;
  scrollTop.value = scroller.value.scrollTop;
  viewportH.value = scroller.value.clientHeight;
}

let ro: ResizeObserver | null = null;

onMounted(() => {
  measureCols();
  onScroll();
  ro = new ResizeObserver(() => {
    measureCols();
    onScroll();
  });
  if (scroller.value) ro.observe(scroller.value);
  window.addEventListener('resize', measureCols);
});

onUnmounted(() => {
  ro?.disconnect();
  window.removeEventListener('resize', measureCols);
});

watch(
  () => props.products.length,
  () => {
    if (scroller.value && scroller.value.scrollTop > 0 && props.products.length < 24) {
      scroller.value.scrollTop = 0;
      scrollTop.value = 0;
    }
  },
);
</script>

<template>
  <div
    ref="scroller"
    class="max-h-[min(62vh,36rem)] overflow-auto overscroll-contain sm:max-h-[min(70vh,42rem)]"
    @scroll.passive="onScroll"
  >
    <div :style="{ height: `${padTop}px` }" aria-hidden="true" />
    <div
      class="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 pos:grid-cols-5 kiosk:grid-cols-6"
    >
      <button
        v-for="row in windowed"
        :key="row.product.id"
        class="pos-product-tile"
        type="button"
        :disabled="disabled"
        @click="emit('select', row.product)"
      >
        <p class="text-lg font-semibold leading-snug text-slate-900">{{ row.product.name }}</p>
        <p
          v-if="row.product.modifierGroups?.length"
          class="mt-1 text-xs font-medium text-sky-700"
        >
          {{ badge }}
        </p>
        <p class="mt-3 text-base font-medium tabular-nums text-slate-700">
          {{ formatIdrFromCents(row.product.unitPriceInCents) }}
        </p>
      </button>
    </div>
    <div :style="{ height: `${padBottom}px` }" aria-hidden="true" />
  </div>
</template>
