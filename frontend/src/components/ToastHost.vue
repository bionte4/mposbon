<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useI18n } from '../i18n';
import { useToastStore } from '../stores/toast.store';

const { t } = useI18n();
const toast = useToastStore();
const { visible } = storeToRefs(toast);

function tone(kind: string): string {
  if (kind === 'error') return 'border-red-300 bg-red-50 text-red-900';
  if (kind === 'success') return 'border-emerald-300 bg-emerald-50 text-emerald-900';
  if (kind === 'warning') return 'border-amber-300 bg-amber-50 text-amber-950';
  return 'border-slate-300 bg-white text-slate-900';
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3"
    aria-live="polite"
  >
    <div
      v-for="item in visible"
      :key="item.id"
      class="pointer-events-auto w-full max-w-md rounded-2xl border px-4 py-3 shadow-lg"
      :class="tone(item.kind)"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="font-semibold">{{ item.title }}</p>
          <p v-if="item.message" class="mt-0.5 text-sm opacity-90">{{ item.message }}</p>
        </div>
        <button
          class="touch-target rounded-xl px-3 text-sm opacity-70 hover:opacity-100"
          type="button"
          @click="toast.dismiss(item.id)"
        >
          {{ t('common.close') }}
        </button>
      </div>
    </div>
  </div>
</template>
