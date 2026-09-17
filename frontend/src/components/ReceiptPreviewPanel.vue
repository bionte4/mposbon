<script setup lang="ts">
/**
 * Tactile thermal-printer style receipt preview (inspired by Flutter receipt_printer UX).
 * Real ESC/POS print still happens via parent @print — this UI is preview + tear + PNG share.
 */
import QRCode from 'qrcode';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from '../i18n';
import { formatSaleReceiptText, type ReceiptData } from '../lib/escpos';
import { formatIdrFromCents } from '../lib/money';

const props = defineProps<{
  receipt: ReceiptData;
  printing?: boolean;
}>();

const emit = defineEmits<{
  print: [];
  skip: [];
}>();

const { t } = useI18n();
const busy = computed(() => props.printing === true);
const copied = ref(false);
const qrDataUrl = ref<string | null>(null);
const paperEl = ref<HTMLElement | null>(null);

const pullY = ref(0);
const tearing = ref(false);
const torn = ref(false);
const showConfetti = ref(false);
const dragging = ref(false);
const dragStartY = ref(0);
const dragStartPull = ref(0);

const TEAR_THRESHOLD = 88;
const MAX_PULL = 140;
const reduceMotion = ref(false);

const previewText = computed(() => formatSaleReceiptText(props.receipt));
const saleShort = computed(() => props.receipt.saleId.slice(0, 8).toUpperCase());
const createdLabel = computed(() => {
  const d =
    typeof props.receipt.createdAt === 'string'
      ? new Date(props.receipt.createdAt)
      : props.receipt.createdAt;
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
});

const paperStyle = computed(() => {
  if (torn.value) {
    return {
      transform: 'translateY(160%) rotate(2deg)',
      opacity: '0',
      transition: reduceMotion.value ? 'none' : 'transform 420ms ease-in, opacity 320ms ease-in',
    };
  }
  return {
    transform: `translateY(${pullY.value}px)`,
    transition: dragging.value || reduceMotion.value ? 'none' : 'transform 180ms ease-out',
  };
});

watch(
  () => props.receipt.saleId,
  async (id) => {
    try {
      qrDataUrl.value = await QRCode.toDataURL(`BONPOS:${id}`, {
        width: 128,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
    } catch {
      qrDataUrl.value = null;
    }
  },
  { immediate: true },
);

onMounted(() => {
  reduceMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
});

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
});

function onPointerDown(e: PointerEvent): void {
  if (busy.value || torn.value || tearing.value) return;
  dragging.value = true;
  dragStartY.value = e.clientY;
  dragStartPull.value = pullY.value;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging.value) return;
  const dy = e.clientY - dragStartY.value;
  pullY.value = Math.max(0, Math.min(MAX_PULL, dragStartPull.value + dy));
}

function onPointerUp(): void {
  if (!dragging.value) return;
  dragging.value = false;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  if (pullY.value >= TEAR_THRESHOLD) {
    void completeTear();
  } else {
    pullY.value = 0;
  }
}

async function completeTear(): Promise<void> {
  tearing.value = true;
  torn.value = true;
  if (!reduceMotion.value) {
    showConfetti.value = true;
    window.setTimeout(() => {
      showConfetti.value = false;
    }, 900);
  }
  window.setTimeout(() => {
    torn.value = false;
    pullY.value = 0;
    tearing.value = false;
  }, reduceMotion.value ? 50 : 520);
}

async function copyPreview(): Promise<void> {
  try {
    await navigator.clipboard.writeText(previewText.value);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // ignore
  }
}

/** Rasterize paper node via SVG foreignObject (no extra deps). */
async function sharePng(): Promise<void> {
  const node = paperEl.value;
  if (!node) return;
  const rect = node.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const scale = 2;
  const clone = node.cloneNode(true) as HTMLElement;
  clone.style.transform = 'none';
  clone.style.opacity = '1';
  const serializer = new XMLSerializer();
  const xhtml = serializer.serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}">
    <foreignObject width="100%" height="100%" transform="scale(${scale})">
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;background:#fff;">${xhtml}</div>
    </foreignObject>
  </svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('png'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const png = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = png;
    a.download = `bonpos-struk-${saleShort.value}.png`;
    a.click();
  } catch {
    await copyPreview();
  } finally {
    URL.revokeObjectURL(url);
  }
}
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-gradient-to-b from-sky-100 to-slate-200">
    <div class="flex shrink-0 items-center justify-between px-3 py-2.5 sm:px-4">
      <div class="min-w-0">
        <h2 class="text-lg font-semibold text-slate-900">{{ t('pos.receipt.title') }}</h2>
        <p class="truncate text-xs text-slate-600">{{ t('pos.receipt.tearHint') }}</p>
      </div>
      <button
        type="button"
        class="min-h-10 rounded-xl bg-white/80 px-3 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 disabled:opacity-40"
        :disabled="busy"
        @click="emit('skip')"
      >
        {{ t('common.close') }}
      </button>
    </div>

    <div class="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-2 sm:px-4">
      <div class="relative mx-auto w-full max-w-[22rem]">
        <div
          class="relative z-20 rounded-[1.75rem] bg-slate-900 px-4 pb-5 pt-4 shadow-xl ring-1 ring-slate-700"
          aria-hidden="true"
        >
          <div class="mb-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span class="h-2.5 w-2.5 rounded-full bg-sky-400/80" />
              <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                BonPOS Thermal
              </span>
            </div>
            <div class="h-6 w-10 rounded-md bg-sky-500/90 shadow-inner" />
          </div>
          <div class="relative h-3 overflow-hidden rounded-sm bg-slate-950 ring-1 ring-slate-700">
            <div class="absolute inset-x-2 top-0 h-1 rounded-b bg-slate-700/80" />
          </div>
        </div>

        <div
          v-if="showConfetti"
          class="pointer-events-none absolute inset-x-0 top-24 z-30 flex justify-center gap-1"
          aria-hidden="true"
        >
          <span
            v-for="n in 12"
            :key="n"
            class="receipt-confetti h-2 w-2 rounded-sm"
            :style="{
              background: ['#0ea5e9', '#22c55e', '#f59e0b', '#f43f5e', '#a855f7'][n % 5],
              animationDelay: `${n * 28}ms`,
            }"
          />
        </div>

        <div
          ref="paperEl"
          class="relative z-10 mx-auto -mt-1 w-[88%] origin-top cursor-grab touch-none select-none active:cursor-grabbing"
          :style="paperStyle"
          role="img"
          :aria-label="t('pos.receipt.title')"
          @pointerdown="onPointerDown"
        >
          <div
            class="receipt-paper rounded-b-sm bg-[#f8f6f1] px-4 pb-5 pt-3 text-slate-900 shadow-md ring-1 ring-slate-300/80"
          >
            <div class="text-center">
              <p class="text-sm font-bold tracking-tight">{{ receipt.storeName }}</p>
              <p class="mt-0.5 text-[10px] text-slate-500">{{ createdLabel }}</p>
              <p class="text-[10px] text-slate-500">
                {{ t('pos.cashier') }}: {{ receipt.cashierName }}
              </p>
              <p class="mt-1 font-mono text-[10px] text-slate-400">#{{ saleShort }}</p>
            </div>

            <div class="my-3 border-t border-dashed border-slate-300" />

            <ul class="space-y-1.5 text-[11px]">
              <li
                v-for="(line, idx) in receipt.lines"
                :key="idx"
                class="grid grid-cols-[1fr_auto] gap-x-2"
              >
                <div class="min-w-0">
                  <p class="truncate font-medium leading-tight">{{ line.name }}</p>
                  <p class="text-[10px] text-slate-500">
                    {{ line.quantity }} × {{ formatIdrFromCents(line.unitPriceInCents) }}
                  </p>
                </div>
                <p class="tabular-nums font-semibold">
                  {{ formatIdrFromCents(line.lineTotalInCents) }}
                </p>
              </li>
            </ul>

            <div class="my-3 border-t border-dashed border-slate-300" />

            <dl class="space-y-1 text-[11px]">
              <div class="flex justify-between gap-2">
                <dt class="text-slate-500">{{ t('pos.subtotal') }}</dt>
                <dd class="tabular-nums">{{ formatIdrFromCents(receipt.subtotalInCents) }}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-slate-500">{{ t('pos.tax') }}</dt>
                <dd class="tabular-nums">{{ formatIdrFromCents(receipt.taxInCents) }}</dd>
              </div>
              <div
                v-if="(receipt.discountInCents ?? 0) > 0"
                class="flex justify-between gap-2"
              >
                <dt class="text-slate-500">{{ t('pos.discount') }}</dt>
                <dd class="tabular-nums">
                  −{{ formatIdrFromCents(receipt.discountInCents ?? 0) }}
                </dd>
              </div>
              <div class="flex justify-between gap-2 pt-1 text-sm font-bold">
                <dt>{{ t('pos.total') }}</dt>
                <dd class="tabular-nums">{{ formatIdrFromCents(receipt.totalInCents) }}</dd>
              </div>
              <div class="flex justify-between gap-2 text-[10px] text-slate-500">
                <dt>{{ t('pos.pay') }}</dt>
                <dd>{{ receipt.paymentMethod }}</dd>
              </div>
              <div
                v-if="receipt.changeInCents != null"
                class="flex justify-between gap-2 text-[10px]"
              >
                <dt class="text-slate-500">{{ t('pos.change') }}</dt>
                <dd class="tabular-nums font-semibold">
                  {{ formatIdrFromCents(receipt.changeInCents) }}
                </dd>
              </div>
            </dl>

            <div v-if="qrDataUrl" class="mt-4 flex flex-col items-center gap-1">
              <img :src="qrDataUrl" alt="" class="h-24 w-24 rounded-sm bg-white p-1" />
              <p class="text-[9px] uppercase tracking-wide text-slate-400">
                {{ t('pos.receipt.scanRef') }}
              </p>
            </div>

            <p class="mt-4 text-center text-[10px] text-slate-400">
              {{ t('pos.receipt.thanks') }}
            </p>

            <div class="mt-3 flex items-center gap-1" aria-hidden="true">
              <span
                v-for="i in 18"
                :key="i"
                class="h-1 flex-1 rounded-full bg-slate-300/90"
              />
            </div>
            <p class="mt-1 text-center text-[9px] font-medium uppercase tracking-wider text-slate-400">
              {{ t('pos.receipt.pull') }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="shrink-0 space-y-2 border-t border-slate-200/80 bg-white/90 px-3 py-3 backdrop-blur sm:px-4">
      <button
        type="button"
        class="touch-target w-full rounded-2xl bg-emerald-700 text-base font-semibold text-white disabled:opacity-40"
        :disabled="busy"
        @click="emit('print')"
      >
        {{ busy ? t('pos.receipt.printing') : t('pos.receipt.print') }}
      </button>
      <div class="grid grid-cols-3 gap-2">
        <button
          type="button"
          class="touch-target rounded-2xl bg-slate-100 text-sm font-semibold text-slate-800 disabled:opacity-40"
          :disabled="busy"
          @click="copyPreview"
        >
          {{ copied ? t('pos.receipt.copied') : t('pos.receipt.copy') }}
        </button>
        <button
          type="button"
          class="touch-target rounded-2xl bg-sky-50 text-sm font-semibold text-sky-900 ring-1 ring-sky-200 disabled:opacity-40"
          :disabled="busy"
          @click="sharePng"
        >
          {{ t('pos.receipt.savePng') }}
        </button>
        <button
          type="button"
          class="touch-target rounded-2xl bg-slate-200 text-sm font-semibold text-slate-900 disabled:opacity-40"
          :disabled="busy"
          @click="emit('skip')"
        >
          {{ t('pos.receipt.skip') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.receipt-paper {
  background-image: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 27px,
    rgba(15, 23, 42, 0.03) 28px
  );
}
.receipt-confetti {
  animation: receipt-pop 0.85s ease-out forwards;
}
@keyframes receipt-pop {
  0% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
  100% {
    transform: translateY(48px) scale(0.4);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .receipt-confetti {
    animation: none;
    display: none;
  }
}
</style>
