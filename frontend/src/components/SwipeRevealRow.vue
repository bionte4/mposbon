<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    /** Accessible label for the reveal action. */
    actionLabel?: string;
  }>(),
  { disabled: false, actionLabel: 'Remove' },
);

const emit = defineEmits<{
  commit: [];
}>();

const offset = ref(0);
const startX = ref(0);
const startY = ref(0);
const locked = ref<'h' | 'v' | null>(null);
const maxReveal = 96;
const threshold = 64;

function onTouchStart(e: TouchEvent): void {
  if (props.disabled) return;
  const t = e.touches[0];
  if (!t) return;
  startX.value = t.clientX;
  startY.value = t.clientY;
  locked.value = null;
}

function onTouchMove(e: TouchEvent): void {
  if (props.disabled) return;
  const t = e.touches[0];
  if (!t) return;
  const dx = t.clientX - startX.value;
  const dy = t.clientY - startY.value;
  if (locked.value == null) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    locked.value = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
  }
  if (locked.value !== 'h') return;
  offset.value = Math.max(-maxReveal, Math.min(0, dx));
}

function onTouchEnd(): void {
  if (props.disabled) {
    offset.value = 0;
    return;
  }
  if (locked.value === 'h' && offset.value <= -threshold) {
    emit('commit');
  }
  offset.value = 0;
  locked.value = null;
}

watch(
  () => props.disabled,
  (v) => {
    if (v) offset.value = 0;
  },
);
</script>

<template>
  <div class="swipe-row relative overflow-hidden rounded-2xl">
    <div
      class="pointer-events-none absolute inset-y-0 right-0 flex w-24 items-center justify-center bg-red-600 text-sm font-semibold text-white"
      aria-hidden="true"
    >
      {{ actionLabel }}
    </div>
    <div
      class="relative z-[1] touch-pan-y bg-slate-50 transition-transform duration-150 ease-out"
      :style="{ transform: `translateX(${offset}px)` }"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <slot />
    </div>
  </div>
</template>
