<script setup lang="ts">
/**
 * On-screen thermal receipt preview after checkout.
 * Print only happens on explicit user action (required for Web Serial/USB gestures).
 */
import { computed, ref } from 'vue';
import { useI18n } from '../i18n';
import { formatSaleReceiptText, type ReceiptData } from '../lib/escpos';

const props = defineProps<{
  receipt: ReceiptData;
  printing?: boolean;
}>();

const emit = defineEmits<{
  print: [];
  skip: [];
}>();

const { t } = useI18n();
const previewText = computed(() => formatSaleReceiptText(props.receipt));
const busy = computed(() => props.printing === true);
const copied = ref(false);

async function copyPreview(): Promise<void> {
  try {
    await navigator.clipboard.writeText(previewText.value);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // Clipboard may be denied — ignore; print/skip still work.
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-white">
    <div class="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2.5 sm:px-4">
      <div class="min-w-0">
        <h2 class="text-lg font-semibold text-slate-900">{{ t('pos.receipt.title') }}</h2>
        <p class="truncate text-xs text-slate-500">{{ t('pos.receipt.subtitle') }}</p>
      </div>
      <button
        type="button"
        class="min-h-10 rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-800 disabled:opacity-40"
        :disabled="busy"
        @click="emit('skip')"
      >
        {{ t('common.close') }}
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-100 px-3 py-4 sm:px-4">
      <div
        class="mx-auto max-w-[20rem] rounded-sm bg-white px-4 py-5 shadow-sm ring-1 ring-slate-200"
        aria-label="Receipt preview"
      >
        <pre
          class="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-slate-900 sm:text-xs"
          >{{ previewText }}</pre
        >
      </div>
    </div>

    <div class="shrink-0 space-y-2 border-t border-slate-200 px-3 py-3 sm:px-4">
      <button
        type="button"
        class="touch-target w-full rounded-2xl bg-emerald-700 text-base font-semibold text-white disabled:opacity-40"
        :disabled="busy"
        @click="emit('print')"
      >
        {{ busy ? t('pos.receipt.printing') : t('pos.receipt.print') }}
      </button>
      <div class="grid grid-cols-2 gap-2">
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
