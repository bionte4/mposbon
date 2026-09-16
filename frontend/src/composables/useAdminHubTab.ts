import { computed, type WritableComputedRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/**
 * Sync hub sub-tab with `?tab=` query (deep-linkable). No cross-hub swipe.
 */
export function useAdminHubTab<T extends string>(
  tabs: readonly T[],
  defaultTab: T,
): { tab: WritableComputedRef<T> } {
  const route = useRoute();
  const router = useRouter();

  const tab = computed({
    get(): T {
      const raw = route.query.tab;
      const q = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
      if (q && (tabs as readonly string[]).includes(q)) {
        return q as T;
      }
      return defaultTab;
    },
    set(next: T) {
      const query = { ...route.query };
      if (next === defaultTab) {
        delete query.tab;
      } else {
        query.tab = next;
      }
      void router.replace({ path: route.path, query });
    },
  });

  return { tab };
}
