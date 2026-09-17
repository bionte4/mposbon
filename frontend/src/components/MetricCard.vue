<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    tone?: 'default' | 'amber' | 'danger';
    /** Tighter padding for dense dashboards. */
    dense?: boolean;
  }>(),
  { tone: 'default', dense: false },
);
</script>

<template>
  <article
    class="border"
    :class="[
      dense ? 'rounded-xl px-3 py-2.5' : 'rounded-2xl p-4',
      tone === 'amber'
        ? 'border-amber-200 bg-amber-50'
        : tone === 'danger'
          ? 'border-red-200 bg-red-50'
          : 'border-slate-200 bg-white',
    ]"
  >
    <p
      class="font-medium uppercase tracking-wide text-slate-500"
      :class="dense ? 'text-[10px]' : 'text-xs'"
    >
      {{ label }}
    </p>
    <p
      class="font-semibold tabular-nums text-slate-900"
      :class="dense ? 'mt-1 text-lg' : 'mt-2 text-xl'"
    >
      {{ value }}
    </p>
  </article>
</template>
