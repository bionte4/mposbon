<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';
import { useI18n } from '../i18n';
import { useToastStore } from '../stores/toast.store';

const { t } = useI18n();
const crashed = ref(false);
const detail = ref('');
const toast = useToastStore();

onErrorCaptured((err) => {
  crashed.value = true;
  detail.value = err instanceof Error ? err.message : String(err);
  toast.error(t('toast.uiError'), detail.value);
  return false;
});

function recover(): void {
  crashed.value = false;
  detail.value = '';
}
</script>

<template>
  <div>
    <div v-if="crashed" class="m-4 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900">
      <h2 class="text-lg font-semibold">{{ t('error.boundaryTitle') }}</h2>
      <p class="mt-2 text-sm">{{ detail }}</p>
      <button
        class="touch-target mt-4 rounded-xl bg-red-800 px-4 text-sm font-medium text-white"
        type="button"
        @click="recover"
      >
        {{ t('common.retry') }}
      </button>
    </div>
    <slot v-else />
  </div>
</template>
