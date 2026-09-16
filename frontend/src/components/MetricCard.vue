<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
  tone?: 'default' | 'amber' | 'danger';
}>();
</script>

<template>
  <article
    class="rounded-2xl border p-4"
    :class="
      tone === 'amber'
        ? 'border-amber-200 bg-amber-50'
        : tone === 'danger'
          ? 'border-red-200 bg-red-50'
          : 'border-slate-200 bg-white'
    "
  >
    <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ label }}</p>
    <p class="mt-2 text-xl font-semibold tabular-nums text-slate-900">{{ value }}</p>
  </article>
</template>
