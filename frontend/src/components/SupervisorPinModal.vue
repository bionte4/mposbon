<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '../i18n';

defineProps<{
  title: string;
  subtitle?: string;
}>();

const emit = defineEmits<{
  confirm: [pin: string];
  cancel: [];
}>();

const { t } = useI18n();
const pin = ref('');
const localError = ref<string | null>(null);

function submit(): void {
  localError.value = null;
  if (!/^\d{4,8}$/.test(pin.value)) {
    localError.value = t('pin.invalid');
    return;
  }
  emit('confirm', pin.value);
  pin.value = '';
}

function cancel(): void {
  pin.value = '';
  emit('cancel');
}
</script>

<template>
  <Teleport to="body">
  <div class="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/45 p-4 sm:items-center">
    <div class="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
      <h2 class="text-xl font-semibold text-slate-900">{{ title }}</h2>
      <p v-if="subtitle" class="mt-1 text-sm text-slate-600">{{ subtitle }}</p>
      <label class="mt-4 block text-sm font-medium text-slate-700">{{ t('pin.label') }}</label>
      <input
        v-model="pin"
        class="mt-2 min-h-14 w-full rounded-2xl border border-slate-300 px-3 text-center text-3xl tracking-[0.35em]"
        type="password"
        inputmode="numeric"
        maxlength="8"
        autocomplete="off"
        @keyup.enter="submit"
      />
      <p v-if="localError" class="mt-2 text-sm text-red-700">{{ localError }}</p>
      <div class="mt-4 flex gap-2">
        <button
          class="touch-target flex-1 rounded-2xl bg-slate-200 text-base font-semibold"
          type="button"
          @click="cancel"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="touch-target flex-1 rounded-2xl bg-slate-900 text-base font-semibold text-white"
          type="button"
          @click="submit"
        >
          {{ t('common.confirm') }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>
