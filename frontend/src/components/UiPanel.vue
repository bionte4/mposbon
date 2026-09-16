<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    padded?: boolean;
  }>(),
  { padded: true },
);
</script>

<template>
  <section
    class="rounded-2xl border border-slate-200 bg-white shadow-sm"
    :class="padded ? 'p-4 sm:p-5' : ''"
  >
    <h2 v-if="title" class="mb-3 text-base font-semibold text-slate-900">{{ title }}</h2>
    <slot />
  </section>
</template>
