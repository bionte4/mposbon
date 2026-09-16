<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import UiPanel from '../../components/UiPanel.vue';
import { useAdminHubTab } from '../../composables/useAdminHubTab';
import { useI18n } from '../../i18n';
import type { AdminShellApi } from './AdminShell.vue';
import {
  createAdminStore,
  fetchAdminProducts,
  fetchAdminStores,
  updateAdminProduct,
  updateAdminStore,
  type AdminProduct,
  type AdminStore,
} from '../../services/admin-api.service';
import {
  createDiningTable,
  createTableArea,
  fetchDiningTables,
  fetchTableAreas,
  updateDiningTable,
  updateTableArea,
  type DiningTable,
  type TableArea,
} from '../../services/tables-api.service';
import {
  createKitchenStation,
  fetchKitchenStations,
  updateKitchenStation,
  type KitchenStation,
} from '../../services/kitchen-api.service';
import { useAuthStore } from '../../stores/auth.store';
import { useCatalogStore } from '../../stores/catalog.store';
import { useToastStore } from '../../stores/toast.store';

type SubTab = 'stores' | 'tables' | 'kitchen';
const SUB_TABS = ['stores', 'tables', 'kitchen'] as const;

const { t } = useI18n();
const auth = useAuthStore();
const catalog = useCatalogStore();
const toast = useToastStore();
const shell = inject<AdminShellApi>('adminShell')!;
const { tab } = useAdminHubTab<SubTab>(SUB_TABS, 'stores');

const canWrite = computed(() => auth.has('admin.outlet.write'));
const busy = computed(() => shell.busy.value);

const stores = ref<AdminStore[]>([]);
const products = ref<AdminProduct[]>([]);
const storeDraft = ref<
  Record<
    string,
    {
      name: string;
      address: string;
      phone: string;
      timezone: string;
      receiptHeader: string;
      receiptFooter: string;
      qrisPayload: string;
      isActive: boolean;
    }
  >
>({});
const newStore = ref({
  code: '',
  name: '',
  address: '',
  phone: '',
  timezone: 'Asia/Jakarta',
});

const tableAreas = ref<TableArea[]>([]);
const diningTables = ref<DiningTable[]>([]);
const tablesStoreId = ref('');
const newTableArea = ref({ name: '', sortOrder: 0 });
const newDiningTable = ref({ code: '', name: '', capacity: 4, areaId: '', sortOrder: 0 });
const areaDraft = ref<Record<string, { name: string; sortOrder: number }>>({});
const tableDraft = ref<Record<string, { name: string; capacity: number; code: string }>>({});

const kitchenStations = ref<KitchenStation[]>([]);
const kitchenStoreId = ref('');
const newKitchenStation = ref({ code: '', name: '', sortOrder: 0 });
const stationDraft = ref<Record<string, { name: string; sortOrder: number }>>({});
const kitchenAssignProductId = ref('');
const kitchenAssignStationId = ref('');

onMounted(() => {
  void refresh();
  window.addEventListener('admin:reload', onReload);
});
onUnmounted(() => window.removeEventListener('admin:reload', onReload));
function onReload(): void {
  void refresh();
}

async function refresh(): Promise<void> {
  shell.setBusy(true);
  shell.setError(null);
  try {
    const [storeRows, prods] = await Promise.all([fetchAdminStores(), fetchAdminProducts()]);
    stores.value = storeRows;
    products.value = prods;
    for (const s of storeRows) {
      storeDraft.value[s.id] = {
        name: s.name,
        address: s.address ?? '',
        phone: s.phone ?? '',
        timezone: s.timezone ?? 'Asia/Jakarta',
        receiptHeader: s.receiptHeader ?? '',
        receiptFooter: s.receiptFooter ?? '',
        qrisPayload: s.qrisPayload ?? '',
        isActive: s.isActive ?? true,
      };
    }
    if (!tablesStoreId.value && storeRows[0]) tablesStoreId.value = storeRows[0].id;
    if (!kitchenStoreId.value && storeRows[0]) kitchenStoreId.value = storeRows[0].id;
    if (tablesStoreId.value) await loadTablesAdmin(tablesStoreId.value);
    if (kitchenStoreId.value) await loadKitchenAdmin(kitchenStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveStore(store: AdminStore): Promise<void> {
  if (!canWrite.value) return;
  const d = storeDraft.value[store.id];
  if (!d || !d.name.trim()) return;
  shell.setBusy(true);
  shell.setError(null);
  try {
    const rawQris = d.qrisPayload.trim();
    await updateAdminStore(store.id, {
      name: d.name.trim(),
      address: d.address.trim() || null,
      phone: d.phone.trim() || null,
      timezone: d.timezone.trim() || null,
      receiptHeader: d.receiptHeader.trim() || null,
      receiptFooter: d.receiptFooter.trim() || null,
      qrisPayload: rawQris.length ? rawQris : null,
      isActive: d.isActive,
    });
    toast.success(t('admin.stores.saved'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function addStore(): Promise<void> {
  if (!canWrite.value) return;
  const code = newStore.value.code.trim().toUpperCase();
  const name = newStore.value.name.trim();
  if (!code || !name) return;
  shell.setBusy(true);
  shell.setError(null);
  try {
    await createAdminStore({
      code,
      name,
      address: newStore.value.address.trim() || null,
      phone: newStore.value.phone.trim() || null,
      timezone: newStore.value.timezone.trim() || 'Asia/Jakarta',
    });
    newStore.value = { code: '', name: '', address: '', phone: '', timezone: 'Asia/Jakarta' };
    toast.success(t('admin.stores.created'));
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function loadTablesAdmin(storeId: string): Promise<void> {
  tableAreas.value = await fetchTableAreas(storeId);
  diningTables.value = await fetchDiningTables(storeId);
  for (const a of tableAreas.value) {
    areaDraft.value[a.id] = { name: a.name, sortOrder: a.sortOrder };
  }
  for (const tbl of diningTables.value) {
    tableDraft.value[tbl.id] = { name: tbl.name, capacity: tbl.capacity, code: tbl.code };
  }
}

async function addTableAreaRow(): Promise<void> {
  if (!canWrite.value || !tablesStoreId.value || !newTableArea.value.name.trim()) return;
  shell.setBusy(true);
  try {
    await createTableArea({
      storeId: tablesStoreId.value,
      name: newTableArea.value.name.trim(),
      sortOrder: newTableArea.value.sortOrder,
    });
    toast.success(t('admin.tables.areaCreated'));
    newTableArea.value = { name: '', sortOrder: 0 };
    await loadTablesAdmin(tablesStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveTableArea(row: TableArea): Promise<void> {
  if (!canWrite.value) return;
  const d = areaDraft.value[row.id];
  if (!d || !d.name.trim()) return;
  shell.setBusy(true);
  try {
    await updateTableArea(row.id, { name: d.name.trim(), sortOrder: d.sortOrder });
    toast.success(t('admin.saved'));
    await loadTablesAdmin(tablesStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function addDiningTableRow(): Promise<void> {
  if (!canWrite.value || !tablesStoreId.value) return;
  if (!newDiningTable.value.code.trim() || !newDiningTable.value.name.trim()) return;
  shell.setBusy(true);
  try {
    await createDiningTable({
      storeId: tablesStoreId.value,
      areaId: newDiningTable.value.areaId || null,
      code: newDiningTable.value.code.trim(),
      name: newDiningTable.value.name.trim(),
      capacity: newDiningTable.value.capacity,
      sortOrder: newDiningTable.value.sortOrder,
    });
    toast.success(t('admin.tables.tableCreated'));
    newDiningTable.value = { code: '', name: '', capacity: 4, areaId: '', sortOrder: 0 };
    await loadTablesAdmin(tablesStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveDiningTable(row: DiningTable): Promise<void> {
  if (!canWrite.value) return;
  const d = tableDraft.value[row.id];
  if (!d || !d.name.trim() || !d.code.trim()) return;
  shell.setBusy(true);
  try {
    await updateDiningTable(row.id, {
      name: d.name.trim(),
      code: d.code.trim(),
      capacity: d.capacity,
    });
    toast.success(t('admin.saved'));
    await loadTablesAdmin(tablesStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function toggleTableArea(row: TableArea): Promise<void> {
  if (!canWrite.value) return;
  shell.setBusy(true);
  try {
    await updateTableArea(row.id, { isActive: !row.isActive });
    await loadTablesAdmin(tablesStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function toggleDiningTable(row: DiningTable): Promise<void> {
  if (!canWrite.value) return;
  shell.setBusy(true);
  try {
    await updateDiningTable(row.id, { isActive: !row.isActive });
    await loadTablesAdmin(tablesStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function loadKitchenAdmin(storeId: string): Promise<void> {
  kitchenStations.value = await fetchKitchenStations(storeId);
  for (const st of kitchenStations.value) {
    stationDraft.value[st.id] = { name: st.name, sortOrder: st.sortOrder };
  }
}

async function addKitchenStationRow(): Promise<void> {
  if (!canWrite.value || !kitchenStoreId.value) return;
  if (!newKitchenStation.value.code.trim() || !newKitchenStation.value.name.trim()) return;
  shell.setBusy(true);
  try {
    await createKitchenStation({
      storeId: kitchenStoreId.value,
      code: newKitchenStation.value.code.trim(),
      name: newKitchenStation.value.name.trim(),
      sortOrder: newKitchenStation.value.sortOrder,
    });
    toast.success(t('admin.kitchen.stationCreated'));
    newKitchenStation.value = { code: '', name: '', sortOrder: 0 };
    await loadKitchenAdmin(kitchenStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveKitchenStation(st: KitchenStation): Promise<void> {
  if (!canWrite.value) return;
  const d = stationDraft.value[st.id];
  if (!d || !d.name.trim()) return;
  shell.setBusy(true);
  try {
    await updateKitchenStation(st.id, { name: d.name.trim(), sortOrder: d.sortOrder });
    toast.success(t('admin.saved'));
    await loadKitchenAdmin(kitchenStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function assignKitchenStation(): Promise<void> {
  if (!canWrite.value || !kitchenAssignProductId.value) return;
  shell.setBusy(true);
  try {
    await updateAdminProduct(kitchenAssignProductId.value, {
      kitchenStationId: kitchenAssignStationId.value || null,
      productType: 'MENU',
    });
    toast.success(t('admin.kitchen.assigned'));
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}
</script>

<template>
  <div>
    <div class="mb-4 flex gap-2 overflow-x-auto pb-1">
      <button
        v-for="key in SUB_TABS"
        :key="key"
        type="button"
        class="touch-target shrink-0 rounded-2xl px-4 text-sm font-semibold"
        :class="tab === key ? 'bg-teal-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'"
        @click="tab = key"
      >
        {{ t(`admin.tabs.${key}`) }}
      </button>
    </div>

    <UiPanel v-if="tab === 'stores'" :title="t('admin.tabs.stores')">
      <p class="mb-3 text-sm text-slate-600">{{ t('admin.stores.hint') }}</p>
      <div
        v-if="canWrite"
        class="mb-4 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <input v-model="newStore.code" class="min-h-11 rounded-xl border px-3" :placeholder="t('admin.code')" />
        <input v-model="newStore.name" class="min-h-11 rounded-xl border px-3" :placeholder="t('admin.name')" />
        <input v-model="newStore.phone" class="min-h-11 rounded-xl border px-3" :placeholder="t('admin.stores.phone')" />
        <input
          v-model="newStore.address"
          class="min-h-11 rounded-xl border px-3 sm:col-span-2"
          :placeholder="t('admin.stores.address')"
        />
        <input v-model="newStore.timezone" class="min-h-11 rounded-xl border px-3" :placeholder="t('admin.stores.timezone')" />
        <button
          type="button"
          class="touch-target rounded-xl bg-emerald-600 text-sm font-semibold text-white sm:col-span-2 lg:col-span-3"
          :disabled="busy"
          @click="addStore"
        >
          {{ t('admin.stores.add') }}
        </button>
      </div>
      <ul class="space-y-4">
        <li v-for="s in stores" :key="s.id" class="rounded-2xl bg-slate-50 px-4 py-4">
          <p class="font-medium text-slate-900">{{ s.code }} — {{ s.name }}</p>
          <p class="mt-1 text-xs text-slate-500">
            {{ s.qrisPayload ? t('admin.qrisConfigured') : t('admin.qrisEmpty') }}
          </p>
          <div v-if="canWrite && storeDraft[s.id]" class="mt-3 grid gap-3 sm:grid-cols-2">
            <label class="text-sm font-medium text-slate-600">
              {{ t('admin.name') }}
              <input v-model="storeDraft[s.id]!.name" class="mt-1 min-h-11 w-full rounded-xl border px-3" />
            </label>
            <label class="text-sm font-medium text-slate-600">
              {{ t('admin.stores.phone') }}
              <input v-model="storeDraft[s.id]!.phone" class="mt-1 min-h-11 w-full rounded-xl border px-3" />
            </label>
            <label class="text-sm font-medium text-slate-600 sm:col-span-2">
              {{ t('admin.stores.address') }}
              <input v-model="storeDraft[s.id]!.address" class="mt-1 min-h-11 w-full rounded-xl border px-3" />
            </label>
            <label class="text-sm font-medium text-slate-600">
              {{ t('admin.stores.timezone') }}
              <input v-model="storeDraft[s.id]!.timezone" class="mt-1 min-h-11 w-full rounded-xl border px-3" />
            </label>
            <label class="inline-flex items-center gap-2 self-end text-sm">
              <input v-model="storeDraft[s.id]!.isActive" type="checkbox" class="h-4 w-4" />
              {{ storeDraft[s.id]!.isActive ? t('admin.active') : t('admin.inactive') }}
            </label>
            <label class="text-sm font-medium text-slate-600 sm:col-span-2">
              {{ t('admin.stores.receiptHeader') }}
              <textarea v-model="storeDraft[s.id]!.receiptHeader" class="mt-1 min-h-16 w-full rounded-xl border px-3 py-2 text-sm" rows="2" />
            </label>
            <label class="text-sm font-medium text-slate-600 sm:col-span-2">
              {{ t('admin.stores.receiptFooter') }}
              <textarea v-model="storeDraft[s.id]!.receiptFooter" class="mt-1 min-h-16 w-full rounded-xl border px-3 py-2 text-sm" rows="2" />
            </label>
            <label class="text-sm font-medium text-slate-600 sm:col-span-2">
              {{ t('admin.qrisPayload') }}
              <textarea
                v-model="storeDraft[s.id]!.qrisPayload"
                class="mt-1 min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs"
                rows="3"
                :placeholder="t('admin.qrisPlaceholder')"
                spellcheck="false"
              />
            </label>
            <button
              type="button"
              class="touch-target rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40 sm:col-span-2"
              :disabled="busy"
              @click="saveStore(s)"
            >
              {{ t('admin.stores.save') }}
            </button>
          </div>
        </li>
        <li v-if="!stores.length" class="text-sm text-slate-500">{{ t('admin.emptyStores') }}</li>
      </ul>
    </UiPanel>

    <UiPanel v-else-if="tab === 'tables'" :title="t('admin.tabs.tables')">
      <p class="mb-4 text-sm text-slate-600">{{ t('admin.tables.hint') }}</p>
      <label class="mb-4 block text-sm font-medium text-slate-600">
        {{ t('admin.inventory.store') }}
        <select v-model="tablesStoreId" class="mt-1 min-h-11 w-full max-w-md rounded-xl border px-3" @change="loadTablesAdmin(tablesStoreId)">
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
        </select>
      </label>
      <div v-if="canWrite" class="mb-4 grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-3">
        <input v-model="newTableArea.name" class="min-h-11 rounded-xl border px-3" :placeholder="t('admin.tables.areaName')" />
        <input v-model.number="newTableArea.sortOrder" class="min-h-11 rounded-xl border px-3" type="number" :placeholder="t('admin.sortOrder')" />
        <button type="button" class="touch-target rounded-xl bg-slate-900 text-sm font-semibold text-white" :disabled="busy" @click="addTableAreaRow">
          {{ t('admin.tables.addArea') }}
        </button>
      </div>
      <ul class="mb-6 space-y-2 text-sm">
        <li v-for="a in tableAreas" :key="a.id" class="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
          <div v-if="canWrite && areaDraft[a.id]" class="grid gap-2 sm:grid-cols-[1fr_5rem_auto_auto]">
            <input v-model="areaDraft[a.id]!.name" class="min-h-10 rounded-lg border px-2" />
            <input v-model.number="areaDraft[a.id]!.sortOrder" class="min-h-10 rounded-lg border px-2" type="number" />
            <button type="button" class="text-xs font-semibold text-sky-800 underline" @click="saveTableArea(a)">{{ t('admin.save') }}</button>
            <button type="button" class="text-xs font-semibold underline" @click="toggleTableArea(a)">
              {{ a.isActive ? t('admin.inactive') : t('admin.active') }}
            </button>
          </div>
          <span v-else>{{ a.name }} · #{{ a.sortOrder }}</span>
        </li>
      </ul>
      <div v-if="canWrite" class="mb-4 grid gap-2 rounded-2xl bg-violet-50 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <input v-model="newDiningTable.code" class="min-h-11 rounded-xl border px-3 uppercase" :placeholder="t('admin.code')" />
        <input v-model="newDiningTable.name" class="min-h-11 rounded-xl border px-3" :placeholder="t('admin.name')" />
        <select v-model="newDiningTable.areaId" class="min-h-11 rounded-xl border px-3">
          <option value="">{{ t('admin.tables.noArea') }}</option>
          <option v-for="a in tableAreas.filter((x) => x.isActive)" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <input v-model.number="newDiningTable.capacity" class="min-h-11 rounded-xl border px-3" type="number" min="1" :placeholder="t('admin.tables.capacity')" />
        <input v-model.number="newDiningTable.sortOrder" class="min-h-11 rounded-xl border px-3" type="number" :placeholder="t('admin.sortOrder')" />
        <button type="button" class="touch-target rounded-xl bg-violet-700 text-sm font-semibold text-white" :disabled="busy" @click="addDiningTableRow">
          {{ t('admin.tables.addTable') }}
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th class="px-3 py-2.5">{{ t('admin.code') }}</th>
              <th class="px-3 py-2.5">{{ t('admin.name') }}</th>
              <th class="px-3 py-2.5">{{ t('admin.tables.capacity') }}</th>
              <th class="px-3 py-2.5">{{ t('admin.status') }}</th>
              <th v-if="canWrite" class="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="tbl in diningTables" :key="tbl.id" class="border-b border-slate-100 last:border-0">
              <td class="px-3 py-2.5">
                <input v-if="canWrite && tableDraft[tbl.id]" v-model="tableDraft[tbl.id]!.code" class="min-h-10 w-20 rounded-lg border px-2 uppercase" />
                <span v-else class="font-semibold">{{ tbl.code }}</span>
              </td>
              <td class="px-3 py-2.5">
                <input v-if="canWrite && tableDraft[tbl.id]" v-model="tableDraft[tbl.id]!.name" class="min-h-10 w-full rounded-lg border px-2" />
                <span v-else>{{ tbl.name }}</span>
              </td>
              <td class="px-3 py-2.5">
                <input v-if="canWrite && tableDraft[tbl.id]" v-model.number="tableDraft[tbl.id]!.capacity" class="min-h-10 w-16 rounded-lg border px-2" type="number" min="1" />
                <span v-else>{{ tbl.capacity }}</span>
              </td>
              <td class="px-3 py-2.5">
                <button v-if="canWrite" type="button" class="text-xs font-semibold underline" @click="toggleDiningTable(tbl)">
                  {{ tbl.isActive ? t('admin.active') : t('admin.inactive') }}
                </button>
                <span v-else>{{ tbl.isActive ? t('admin.active') : t('admin.inactive') }}</span>
              </td>
              <td v-if="canWrite" class="px-3 py-2.5">
                <button type="button" class="text-xs font-semibold text-sky-800 underline" @click="saveDiningTable(tbl)">{{ t('admin.save') }}</button>
              </td>
            </tr>
            <tr v-if="!diningTables.length">
              <td colspan="5" class="px-3 py-4 text-slate-500">{{ t('admin.tables.empty') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiPanel>

    <UiPanel v-else :title="t('admin.tabs.kitchen')">
      <p class="mb-4 text-sm text-slate-600">{{ t('admin.kitchen.hint') }}</p>
      <label class="mb-4 block text-sm font-medium text-slate-700">
        {{ t('admin.inventory.store') }}
        <select v-model="kitchenStoreId" class="mt-1 min-h-11 w-full max-w-md rounded-xl border px-3" @change="loadKitchenAdmin(kitchenStoreId)">
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
        </select>
      </label>
      <div v-if="canWrite" class="mb-4 grid gap-2 rounded-xl bg-orange-50 p-3 sm:grid-cols-4">
        <input v-model="newKitchenStation.code" class="min-h-11 rounded-xl border px-3 uppercase" :placeholder="t('admin.code')" />
        <input v-model="newKitchenStation.name" class="min-h-11 rounded-xl border px-3" :placeholder="t('admin.name')" />
        <input v-model.number="newKitchenStation.sortOrder" type="number" class="min-h-11 rounded-xl border px-3" :placeholder="t('admin.sortOrder')" />
        <button type="button" class="touch-target rounded-xl bg-orange-600 font-semibold text-white" :disabled="busy" @click="addKitchenStationRow">
          {{ t('admin.kitchen.addStation') }}
        </button>
      </div>
      <ul class="mb-6 space-y-2 text-sm">
        <li v-for="st in kitchenStations" :key="st.id" class="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
          <div v-if="canWrite && stationDraft[st.id]" class="grid gap-2 sm:grid-cols-[auto_1fr_5rem_auto_auto]">
            <span class="self-center font-mono text-xs">{{ st.code }}</span>
            <input v-model="stationDraft[st.id]!.name" class="min-h-10 rounded-lg border px-2" />
            <input v-model.number="stationDraft[st.id]!.sortOrder" class="min-h-10 rounded-lg border px-2" type="number" />
            <button type="button" class="text-xs font-semibold text-sky-800 underline" @click="saveKitchenStation(st)">{{ t('admin.save') }}</button>
            <button
              type="button"
              class="text-xs underline"
              @click="updateKitchenStation(st.id, { isActive: !st.isActive }).then(() => loadKitchenAdmin(kitchenStoreId))"
            >
              {{ st.isActive ? t('admin.inactive') : t('admin.active') }}
            </button>
          </div>
          <span v-else>{{ st.code }} · {{ st.name }}</span>
        </li>
      </ul>
      <div v-if="canWrite" class="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
        <select v-model="kitchenAssignProductId" class="min-h-11 rounded-xl border px-3">
          <option value="">{{ t('admin.recipes.menuProduct') }}</option>
          <option v-for="p in products" :key="p.id" :value="p.id">{{ p.sku }} — {{ p.name }}</option>
        </select>
        <select v-model="kitchenAssignStationId" class="min-h-11 rounded-xl border px-3">
          <option value="">{{ t('admin.kitchen.noStation') }}</option>
          <option v-for="st in kitchenStations.filter((s) => s.isActive)" :key="st.id" :value="st.id">{{ st.code }} — {{ st.name }}</option>
        </select>
        <button type="button" class="touch-target rounded-xl bg-slate-900 font-semibold text-white" :disabled="busy" @click="assignKitchenStation">
          {{ t('admin.kitchen.assign') }}
        </button>
      </div>
    </UiPanel>
  </div>
</template>
