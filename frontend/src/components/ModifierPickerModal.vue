<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';
import type { CachedProduct, ModifierSnapshot } from '../db/pos-types';

const props = defineProps<{
  product: CachedProduct;
}>();

const emit = defineEmits<{
  confirm: [modifiers: ModifierSnapshot[]];
  cancel: [];
}>();

const { t } = useI18n();
/** groupId → selected option ids */
const selected = reactive<Record<string, string[]>>({});

watch(
  () => props.product.id,
  () => {
    for (const key of Object.keys(selected)) {
      delete selected[key];
    }
    for (const group of props.product.modifierGroups) {
      selected[group.id] = [];
      if (group.minSelect >= 1 && group.options[0]) {
        selected[group.id] = [group.options[0].id];
      }
    }
  },
  { immediate: true },
);

const previewUnit = computed(() => {
  let delta = 0;
  for (const group of props.product.modifierGroups) {
    for (const id of selected[group.id] ?? []) {
      const opt = group.options.find((o) => o.id === id);
      if (opt) delta += opt.priceDeltaInCents;
    }
  }
  return props.product.unitPriceInCents + delta;
});

const valid = computed(() =>
  props.product.modifierGroups.every((g) => {
    const n = (selected[g.id] ?? []).length;
    return n >= g.minSelect && n <= g.maxSelect;
  }),
);

function toggle(groupId: string, optionId: string, maxSelect: number): void {
  const current = selected[groupId] ?? [];
  if (maxSelect === 1) {
    selected[groupId] = [optionId];
    return;
  }
  if (current.includes(optionId)) {
    selected[groupId] = current.filter((id) => id !== optionId);
  } else if (current.length < maxSelect) {
    selected[groupId] = [...current, optionId];
  }
}

function confirm(): void {
  if (!valid.value) return;
  const mods: ModifierSnapshot[] = [];
  for (const group of props.product.modifierGroups) {
    for (const id of selected[group.id] ?? []) {
      const opt = group.options.find((o) => o.id === id);
      if (opt) {
        mods.push({
          optionId: opt.id,
          name: opt.name,
          priceDeltaInCents: opt.priceDeltaInCents,
        });
      }
    }
  }
  emit('confirm', mods);
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
    <div class="max-h-[90dvh] w-full max-w-md overflow-auto rounded-3xl bg-white p-5">
      <h2 class="text-xl font-semibold">{{ product.name }}</h2>
      <p class="mt-1 text-sm text-slate-500">{{ t('pos.modifiers.subtitle') }}</p>
      <p class="mt-2 text-lg font-bold tabular-nums">{{ formatIdrFromCents(previewUnit) }}</p>

      <div v-for="group in product.modifierGroups" :key="group.id" class="mt-4">
        <p class="text-sm font-semibold text-slate-700">
          {{ group.name }}
          <span class="font-normal text-slate-400">
            ({{ group.minSelect }}–{{ group.maxSelect }})
          </span>
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="opt in group.options"
            :key="opt.id"
            type="button"
            class="rounded-2xl px-3 py-2 text-sm font-semibold"
            :class="
              (selected[group.id] ?? []).includes(opt.id)
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-800'
            "
            @click="toggle(group.id, opt.id, group.maxSelect)"
          >
            {{ opt.name }}
            <span v-if="opt.priceDeltaInCents" class="opacity-80">
              +{{ formatIdrFromCents(opt.priceDeltaInCents) }}
            </span>
          </button>
        </div>
      </div>

      <div class="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          class="touch-target rounded-2xl bg-slate-200 font-semibold"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="touch-target rounded-2xl bg-emerald-700 font-semibold text-white disabled:opacity-40"
          :disabled="!valid"
          @click="confirm"
        >
          {{ t('pos.modifiers.add') }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>
