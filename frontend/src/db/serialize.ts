import { toRaw } from 'vue';

/**
 * IndexedDB uses the structured clone algorithm — Vue reactive Proxies,
 * functions, and some host objects throw DataCloneError.
 * Always pass a plain JSON-safe snapshot into Dexie put/bulkPut/add.
 */
export function cloneForIdb<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value as object))) as T;
}
