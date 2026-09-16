/// <reference lib="webworker" />
/**
 * BonPOS service worker — precache app shell + Background Sync hook.
 * Dexie lives in the page; SW asks open clients to flush the IndexedDB queue
 * when the browser fires a `sync` event (or a client requests a flush).
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.skipWaiting();
clientsClaim();

registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly());

const offlineHandler = createHandlerBoundToURL('/index.html');
registerRoute(
  new NavigationRoute(offlineHandler, {
    denylist: [/^\/api\//],
  }),
);

const SYNC_TAG = 'bonpos-pos-sync';

async function notifyClientsToFlush(): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    client.postMessage({ type: 'BONPOS_FLUSH_SYNC', tag: SYNC_TAG });
  }
}

self.addEventListener('sync', (event) => {
  const syncEvent = event as ExtendableEvent & { tag: string };
  if (syncEvent.tag === SYNC_TAG) {
    syncEvent.waitUntil(notifyClientsToFlush());
  }
});

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | undefined;
  if (data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
  if (data?.type === 'BONPOS_REQUEST_FLUSH') {
    event.waitUntil(notifyClientsToFlush());
  }
});
