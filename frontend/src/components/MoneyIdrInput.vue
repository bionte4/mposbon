<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from '../i18n';
import { formatIdrFromCents, idrInputDisplay, parseIdrInput } from '../lib/money';

const props = withDefaults(
  defineProps<{
    modelValue: number;
    disabled?: boolean;
    placeholder?: string;
    id?: string;
  }>(),
  {
    disabled: false,
    placeholder: '',
    id: undefined,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: number];
}>();

const { t } = useI18n();
const text = ref(idrInputDisplay(props.modelValue));

watch(
  () => props.modelValue,
  (v) => {
    const parsed = parseIdrInput(text.value);
    if (parsed !== v) {
      text.value = idrInputDisplay(v);
    }
  },
);

function onInput(raw: string): void {
  text.value = raw;
  const n = parseIdrInput(raw);
  if (n != null) {
    emit('update:modelValue', n);
  }
}

function onBlur(): void {
  const n = parseIdrInput(text.value);
  if (n != null) {
    emit('update:modelValue', n);
    text.value = idrInputDisplay(n);
  } else {
    text.value = idrInputDisplay(props.modelValue);
  }
}
</script>

<template>
  <div class="w-full">
    <input
      :id="id"
      class="min-h-11 w-full rounded-xl border border-slate-300 px-3 tabular-nums disabled:bg-slate-100"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      :disabled="disabled"
      :placeholder="placeholder"
      :value="text"
      @input="onInput(($event.target as HTMLInputElement).value)"
      @blur="onBlur"
    />
    <p class="mt-1 text-xs text-slate-500">
      {{ t('admin.money.hint') }}
      <span class="ml-1 font-medium text-slate-700">{{ formatIdrFromCents(modelValue) }}</span>
    </p>
  </div>
</template>
