import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { ApiError } from '../api/errors';
import {
  clockIn as apiClockIn,
  clockOut as apiClockOut,
  fetchActiveShift,
  fetchZReport,
  postCashDrop,
  postMidCount,
  type ActiveShift,
  type ZReport,
} from '../services/pos-api.service';
import { useCatalogStore } from './catalog.store';

export const useShiftStore = defineStore('shift', () => {
  const active = ref<ActiveShift | null>(null);
  const lastZReport = ref<ZReport | null>(null);
  const lastMidVariance = ref<number | null>(null);
  const error = ref<string | null>(null);

  const isOpen = computed(() => active.value?.status === 'OPEN');

  async function refresh(): Promise<void> {
    active.value = await fetchActiveShift();
  }

  async function clockIn(openingFloatInCents: number): Promise<void> {
    error.value = null;
    const catalog = useCatalogStore();
    const storeId = catalog.session?.storeId;
    if (!storeId) {
      throw new Error('Store belum siap');
    }
    if (!Number.isInteger(openingFloatInCents) || openingFloatInCents < 0) {
      throw new Error('Modal awal harus integer >= 0');
    }
    try {
      active.value = await apiClockIn(storeId, openingFloatInCents);
    } catch (err) {
      // Already open elsewhere / race: adopt server shift instead of blocking POS.
      if (err instanceof ApiError && err.status === 409) {
        active.value = await fetchActiveShift();
        if (active.value?.status === 'OPEN') {
          if (active.value.storeId !== storeId) {
            await catalog.switchStore(active.value.storeId);
          } else {
            await catalog.bindShiftId(active.value.id);
          }
          return;
        }
      }
      throw err;
    }
    await catalog.bindShiftId(active.value.id);
  }

  async function clockOut(countedCashInCents: number): Promise<ZReport> {
    error.value = null;
    if (!active.value) {
      throw new Error('Tidak ada shift aktif');
    }
    if (!Number.isInteger(countedCashInCents) || countedCashInCents < 0) {
      throw new Error('Hitungan kas harus integer >= 0');
    }
    const closed = await apiClockOut(active.value.id, countedCashInCents);
    const report = await fetchZReport(closed.id);
    lastZReport.value = report;
    active.value = null;
    const catalog = useCatalogStore();
    await catalog.bindShiftId(null);
    return report;
  }

  async function cashDrop(amountInCents: number, note?: string) {
    if (!active.value) throw new Error('Tidak ada shift aktif');
    const result = await postCashDrop(active.value.id, amountInCents, note);
    active.value = await fetchActiveShift();
    return result;
  }

  async function midCount(countedCashInCents: number, note?: string) {
    if (!active.value) throw new Error('Tidak ada shift aktif');
    const result = await postMidCount(active.value.id, countedCashInCents, note);
    lastMidVariance.value = result.varianceInCents;
    return result;
  }

  return {
    active,
    lastZReport,
    lastMidVariance,
    error,
    isOpen,
    refresh,
    clockIn,
    clockOut,
    cashDrop,
    midCount,
  };
});
