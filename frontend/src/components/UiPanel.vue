<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    padded?: boolean;
    /** Less padding / smaller title for dense admin tables. */
    dense?: boolean;
  }>(),
  { padded: true, dense: false },
);
</script>

<template>
  <section
    class="rounded-2xl border border-slate-200 bg-white shadow-sm"
    :class="
      padded
        ? dense
          ? 'p-3 sm:p-3.5'
          : 'p-4 sm:p-5'
        : ''
    "
  >
    <h2
      v-if="title"
      class="font-semibold text-slate-900"
      :class="dense ? 'mb-2 text-sm' : 'mb-3 text-base'"
    >
      {{ title }}
    </h2>
    <slot />
  </section>
</template>
