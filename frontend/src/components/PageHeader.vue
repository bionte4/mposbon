<script setup lang="ts">
withDefaults(
  defineProps<{
    eyebrow?: string;
    title: string;
    subtitle?: string;
    /** Tighter header for dense admin surfaces. */
    compact?: boolean;
  }>(),
  { compact: false },
);
</script>

<template>
  <header
    class="flex flex-wrap items-end justify-between gap-2"
    :class="compact ? 'mb-3' : 'mb-6 gap-3'"
  >
    <div class="min-w-0">
      <p
        v-if="eyebrow"
        class="font-semibold uppercase tracking-wide text-slate-500"
        :class="compact ? 'text-[10px]' : 'text-xs'"
      >
        {{ eyebrow }}
      </p>
      <h1
        class="font-semibold tracking-tight text-slate-900"
        :class="compact ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'"
      >
        {{ title }}
      </h1>
      <p
        v-if="subtitle"
        class="text-slate-600"
        :class="compact ? 'mt-0.5 text-xs sm:text-sm' : 'mt-1 text-sm'"
      >
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>
      <div v-if="$slots.subtitleOnly" class="mt-1 text-sm text-slate-600">
        <slot name="subtitleOnly" />
      </div>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
