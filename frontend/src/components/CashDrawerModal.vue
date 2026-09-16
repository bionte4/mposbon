<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';

const props = defineProps<{
  mode: 'drop' | 'midCount';
}>();

const emit = defineEmits<{
  confirm: [payload: { amountInCents: number; note?: string }];
  cancel: [];
}>();

const { t } = useI18n();
const amountRupiah = ref(0);
const note = ref('');

const amountInCents = computed(() => Math.max(0, Math.trunc(amountRupiah.value)));
const invalid = computed(() =>
  props.mode === 'drop' ? amountInCents.value < 1 : amountInCents.value < 0,
);

function confirm(): void {
  if (invalid.value) return;
  emit('confirm', {
    amountInCents: amountInCents.value,
    note: note.value.trim() || undefined,
  });
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      @click.self="emit('cancel')"
    >
      <div class="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
      <h2 class="text-xl font-semibold text-slate-900">
        {{ mode === 'drop' ? t('pos.drawer.dropTitle') : t('pos.drawer.midTitle') }}
      </h2>
      <p class="mt-1 text-sm text-slate-500">
        {{ mode === 'drop' ? t('pos.drawer.dropHint') : t('pos.drawer.midHint') }}
      </p>

      <label class="mt-4 block text-sm font-medium text-slate-600">
        {{ mode === 'drop' ? t('pos.drawer.dropAmount') : t('pos.drawer.midAmount') }}
        <input
          v-model.number="amountRupiah"
          class="mt-1 min-h-14 w-full rounded-2xl border border-slate-300 px-3 text-lg tabular-nums"
          type="number"
          step="1"
          min="0"
          inputmode="numeric"
        />
      </label>
      <p class="mt-1 text-sm tabular-nums text-slate-500">
        {{ formatIdrFromCents(amountInCents) }}
      </p>

      <label class="mt-3 block text-sm font-medium text-slate-600">
        {{ t('pos.drawer.note') }}
        <input
          v-model="note"
          class="mt-1 min-h-12 w-full rounded-2xl border border-slate-300 px-3"
          type="text"
          maxlength="120"
        />
      </label>

      <div class="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          class="touch-target rounded-2xl bg-slate-200 text-base font-semibold"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="touch-target rounded-2xl bg-amber-700 text-base font-semibold text-white disabled:opacity-40"
          :disabled="invalid"
          @click="confirm"
        >
          {{ t('common.confirm') }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>
