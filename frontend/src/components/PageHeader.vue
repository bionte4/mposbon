<script setup lang="ts">
defineProps<{
  eyebrow?: string;
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <header class="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0">
      <p v-if="eyebrow" class="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {{ eyebrow }}
      </p>
      <h1 class="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
        {{ title }}
      </h1>
      <p v-if="subtitle" class="mt-1 text-sm text-slate-600">
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
