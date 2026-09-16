/**
 * Bridges Service Worker Background Sync ↔ Dexie flush in the page.
 * When the tab is closed, the browser still wakes the SW on reconnect;
 * the SW pings any open client (or the next open) to drain IndexedDB.
 */

export const BONPOS_SYNC_TAG = 'bonpos-pos-sync';

type SyncManagerLike = {
  register: (tag: string) => Promise<void>;
};

function getSyncManager(
  registration: ServiceWorkerRegistration,
): SyncManagerLike | null {
  const sync = (registration as ServiceWorkerRegistration & { sync?: SyncManagerLike }).sync;
  return sync ?? null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Ask the browser to fire a Background Sync event when connectivity returns.
 * Never block checkout — `serviceWorker.ready` can hang if the SW never activates.
 */
export async function requestBackgroundSync(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false;
  }
  try {
    const registration = await withTimeout(navigator.serviceWorker.ready, 1500);
    const sync = getSyncManager(registration);
    if (!sync) {
      return false;
    }
    await withTimeout(sync.register(BONPOS_SYNC_TAG), 1500);
    return true;
  } catch {
    // Private mode / unsupported / SW not ready — online listener still flushes.
    return false;
  }
}

/** Listen for SW messages that request a Dexie queue flush. */
export function bindServiceWorkerFlush(onFlush: () => void | Promise<void>): () => void {
  if (!('serviceWorker' in navigator)) {
    return () => undefined;
  }

  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string } | undefined;
    if (data?.type === 'BONPOS_FLUSH_SYNC') {
      void onFlush();
    }
  };

  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
