import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { playKitchenChime, unlockKitchenChime } from '../lib/kitchen-chime';
import { fetchKitchenTickets } from '../services/kitchen-api.service';
import { useAuthStore } from './auth.store';
import { useCatalogStore } from './catalog.store';

/**
 * Polls kitchen tickets for nav badge + audible alert on new routed lines.
 * Scoped strictly to the active tenant + store (never cross-outlet).
 */
export const useKitchenNotifyStore = defineStore('kitchenNotify', () => {
  const pendingCount = ref(0);
  const unseenCount = ref(0);
  const soundEnabled = ref(true);
  const viewingKitchen = ref(false);
  /** `tenantId:storeId` currently being polled */
  const activeScopeKey = ref<string | null>(null);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let knownLineIds = new Set<string>();
  let primed = false;
  let bound = false;

  const bellLabel = computed(() => {
    if (unseenCount.value > 0) return unseenCount.value > 99 ? '99+' : String(unseenCount.value);
    if (pendingCount.value > 0) return String(Math.min(pendingCount.value, 99));
    return '';
  });

  const hasAlert = computed(() => unseenCount.value > 0 || pendingCount.value > 0);

  function scopeKey(tenantId: string, storeId: string): string {
    return `${tenantId}:${storeId}`;
  }

  function soundStorageKey(tenantId: string, storeId: string): string {
    return `bonpos.kitchen.sound.${tenantId}.${storeId}`;
  }

  function loadSoundPref(tenantId: string, storeId: string): void {
    if (typeof localStorage === 'undefined') {
      soundEnabled.value = true;
      return;
    }
    soundEnabled.value = localStorage.getItem(soundStorageKey(tenantId, storeId)) !== '0';
  }

  function setSoundEnabled(on: boolean): void {
    soundEnabled.value = on;
    const catalog = useCatalogStore();
    const tenantId = catalog.session?.tenantId;
    const storeId = catalog.session?.storeId;
    if (tenantId && storeId && typeof localStorage !== 'undefined') {
      localStorage.setItem(soundStorageKey(tenantId, storeId), on ? '1' : '0');
    }
    if (on) void unlockKitchenChime();
  }

  function markViewing(on: boolean): void {
    viewingKitchen.value = on;
    if (on) {
      unseenCount.value = 0;
    }
  }

  function resetScope(): void {
    knownLineIds = new Set();
    primed = false;
    pendingCount.value = 0;
    unseenCount.value = 0;
  }

  function stop(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function poll(): Promise<void> {
    const auth = useAuthStore();
    const catalog = useCatalogStore();
    if (!auth.isAuthenticated || !auth.has('kitchen.display')) {
      pendingCount.value = 0;
      unseenCount.value = 0;
      return;
    }
    const tenantId = catalog.session?.tenantId;
    const storeId = catalog.session?.storeId;
    if (!tenantId || !storeId) return;

    const key = scopeKey(tenantId, storeId);
    if (activeScopeKey.value !== key) {
      // Tenant or store switched — never carry counts/lines across outlets.
      activeScopeKey.value = key;
      resetScope();
      loadSoundPref(tenantId, storeId);
    }

    try {
      // Backend enforces tenant RLS + storeId + kitchen station ACL.
      const tickets = await fetchKitchenTickets(storeId);
      const activeLines: Array<{ id: string; status: string }> = [];
      for (const ticket of tickets) {
        // Ignore tickets that somehow lack matching store (defense in depth).
        if (ticket.storeId && ticket.storeId !== storeId) continue;
        for (const line of ticket.lines) {
          if (line.status !== 'DONE' && line.status !== 'CANCELLED') {
            activeLines.push({ id: line.id, status: line.status });
          }
        }
      }
      pendingCount.value = activeLines.filter((l) => l.status === 'PENDING').length;

      const nextIds = new Set(activeLines.map((l) => l.id));
      if (!primed) {
        knownLineIds = nextIds;
        primed = true;
        return;
      }

      const freshPending = activeLines.filter(
        (l) => l.status === 'PENDING' && !knownLineIds.has(l.id),
      );
      knownLineIds = nextIds;

      if (freshPending.length > 0) {
        if (!viewingKitchen.value) {
          unseenCount.value += freshPending.length;
        }
        if (soundEnabled.value) {
          playKitchenChime();
        }
      }
    } catch {
      /* keep last counts; transient network */
    }
  }

  function start(): void {
    stop();
    const catalog = useCatalogStore();
    const tenantId = catalog.session?.tenantId;
    const storeId = catalog.session?.storeId;
    if (tenantId && storeId) {
      activeScopeKey.value = scopeKey(tenantId, storeId);
      loadSoundPref(tenantId, storeId);
    }
    resetScope();
    void poll();
    pollTimer = setInterval(() => void poll(), 5_000);
  }

  function bindAuthWatch(): void {
    if (bound) return;
    bound = true;
    const auth = useAuthStore();
    const catalog = useCatalogStore();
    watch(
      () =>
        [
          auth.isAuthenticated,
          auth.has('kitchen.display'),
          catalog.session?.tenantId ?? null,
          catalog.session?.storeId ?? null,
        ] as const,
      ([ok, can, tenantId, storeId]) => {
        if (ok && can && tenantId && storeId) {
          start();
        } else {
          stop();
          activeScopeKey.value = null;
          resetScope();
        }
      },
      { immediate: true },
    );
  }

  return {
    pendingCount,
    unseenCount,
    soundEnabled,
    viewingKitchen,
    activeScopeKey,
    bellLabel,
    hasAlert,
    setSoundEnabled,
    markViewing,
    poll,
    start,
    stop,
    bindAuthWatch,
  };
});
