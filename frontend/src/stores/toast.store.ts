import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export type ToastItem = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  createdAt: number;
};

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([]);

  const visible = computed(() => items.value);

  function push(kind: ToastKind, title: string, message?: string): void {
    const id = crypto.randomUUID();
    items.value = [...items.value, { id, kind, title, message, createdAt: Date.now() }];
    window.setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4000);
  }

  function dismiss(id: string): void {
    items.value = items.value.filter((t) => t.id !== id);
  }

  function error(title: string, message?: string): void {
    push('error', title, message);
  }

  function success(title: string, message?: string): void {
    push('success', title, message);
  }

  function warning(title: string, message?: string): void {
    push('warning', title, message);
  }

  function info(title: string, message?: string): void {
    push('info', title, message);
  }

  return { items, visible, push, dismiss, error, success, warning, info };
});
