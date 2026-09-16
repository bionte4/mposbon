<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import MoneyIdrInput from '../../components/MoneyIdrInput.vue';
import UiPanel from '../../components/UiPanel.vue';
import { useAdminHubTab } from '../../composables/useAdminHubTab';
import { useI18n } from '../../i18n';
import { formatIdrFromCents } from '../../lib/money';
import type { AdminShellApi } from './AdminShell.vue';
import {
  createAdminCategory,
  createAdminProduct,
  createModifierGroup,
  createModifierOption,
  createProductVariant,
  deleteAdminCategory,
  deleteModifierGroup,
  deleteModifierOption,
  fetchAdminCategories,
  fetchAdminProducts,
  fetchAdminStores,
  updateAdminCategory,
  updateAdminProduct,
  updateModifierOption,
  updateProductVariant,
  type AdminCategory,
  type AdminModifierGroup,
  type AdminProduct,
  type ProductVariant,
} from '../../services/admin-api.service';
import { fetchKitchenStations, type KitchenStation } from '../../services/kitchen-api.service';
import { createPromo, fetchPromos, updatePromo, type Promo } from '../../services/promo-api.service';
import { useAuthStore } from '../../stores/auth.store';
import { useCatalogStore } from '../../stores/catalog.store';
import { useToastStore } from '../../stores/toast.store';

type SubTab = 'products' | 'categories' | 'modifiers' | 'promos';
const SUB_TABS = ['products', 'categories', 'modifiers', 'promos'] as const;

const { t } = useI18n();
const auth = useAuthStore();
const catalog = useCatalogStore();
const toast = useToastStore();
const shell = inject<AdminShellApi>('adminShell')!;
const { tab } = useAdminHubTab<SubTab>(SUB_TABS, 'products');

const canWrite = computed(() => auth.has('admin.catalog.write'));
const busy = computed(() => shell.busy.value);

const categories = ref<AdminCategory[]>([]);
const products = ref<AdminProduct[]>([]);
const kitchenStations = ref<KitchenStation[]>([]);
const promos = ref<Promo[]>([]);

const newCategoryName = ref('');
const catDraftName = ref<Record<string, string>>({});
const catDraftSort = ref<Record<string, number>>({});

const modifierProductId = ref('');
const newGroup = ref({ name: '', minSelect: 0, maxSelect: 1 });
const newOption = ref<Record<string, { name: string; priceDeltaInCents: number }>>({});

const expandedProductId = ref<string | null>(null);
const productDraft = ref<Record<
  string,
  {
    name: string;
    sku: string;
    barcode: string;
    categoryId: string;
    unitPriceInCents: number;
    taxBps: number;
    stockQty: number;
    productType: 'RETAIL' | 'MENU' | 'INGREDIENT';
    kitchenStationId: string;
    isActive: boolean;
  }
>>({});

const newProduct = ref({
  name: '',
  sku: '',
  barcode: '',
  categoryId: '',
  unitPriceInCents: 0,
  taxBps: 1100,
  stockQty: 0,
  productType: 'RETAIL' as 'RETAIL' | 'MENU' | 'INGREDIENT',
  kitchenStationId: '',
  isActive: true,
});

const variantDraft = ref<
  Record<string, { sku: string; name: string; barcode: string; unitPriceInCents: number; isActive: boolean }>
>({});
const newVariant = ref({
  sku: '',
  name: '',
  barcode: '',
  unitPriceInCents: 0,
});

const newPromo = ref({
  code: '',
  name: '',
  type: 'PERCENT' as 'PERCENT' | 'FIXED',
  percentBps: 1000,
  amountInCents: 5000,
  usageLimit: null as number | null,
  minSubtotalInCents: 0,
  maxDiscountInCents: null as number | null,
});
const promoDraft = ref<
  Record<
    string,
    {
      usageLimit: number | null;
      minSubtotalInCents: number;
      maxDiscountInCents: number | null;
      amountInCents: number | null;
      percentBps: number | null;
    }
  >
>({});

const selectedModifierProduct = computed(
  () => products.value.find((p) => p.id === modifierProductId.value) ?? null,
);
const selectedModifierGroups = computed(
  () => selectedModifierProduct.value?.modifierGroups ?? ([] as AdminModifierGroup[]),
);

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
    const [cats, prods, promoRows, storeRows] = await Promise.all([
      fetchAdminCategories(),
      fetchAdminProducts(),
      fetchPromos().catch(() => [] as Promo[]),
      fetchAdminStores().catch(() => []),
    ]);
    categories.value = cats;
    for (const c of cats) {
      catDraftName.value[c.id] = c.name;
      catDraftSort.value[c.id] = c.sortOrder;
    }
    products.value = prods;
    if (!modifierProductId.value && prods[0]) modifierProductId.value = prods[0].id;
    if (!newProduct.value.categoryId && cats[0]) newProduct.value.categoryId = cats[0].id;
    for (const p of prods) {
      seedProductDraft(p);
      for (const v of p.variants ?? []) {
        variantDraft.value[v.id] = {
          sku: v.sku,
          name: v.name,
          barcode: v.barcode ?? '',
          unitPriceInCents: v.unitPriceInCents,
          isActive: v.isActive,
        };
      }
    }
    promos.value = promoRows;
    for (const p of promoRows) {
      promoDraft.value[p.id] = {
        usageLimit: p.usageLimit,
        minSubtotalInCents: p.minSubtotalInCents,
        maxDiscountInCents: p.maxDiscountInCents,
        amountInCents: p.amountInCents,
        percentBps: p.percentBps,
      };
    }
    if (storeRows[0]) {
      kitchenStations.value = await fetchKitchenStations(storeRows[0].id).catch(() => []);
    }
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

function seedProductDraft(p: AdminProduct): void {
  productDraft.value[p.id] = {
    name: p.name,
    sku: p.sku,
    barcode: p.barcode ?? '',
    categoryId: p.categoryId,
    unitPriceInCents: p.unitPriceInCents,
    taxBps: p.taxBps,
    stockQty: p.stockQty,
    productType: p.productType ?? 'RETAIL',
    kitchenStationId: p.kitchenStationId ?? '',
    isActive: p.isActive,
  };
}

function toggleExpand(p: AdminProduct): void {
  expandedProductId.value = expandedProductId.value === p.id ? null : p.id;
  seedProductDraft(p);
}

async function addCategory(): Promise<void> {
  if (!canWrite.value || !newCategoryName.value.trim()) return;
  shell.setBusy(true);
  try {
    await createAdminCategory({ name: newCategoryName.value.trim() });
    newCategoryName.value = '';
    toast.success(t('admin.saved'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveCategory(cat: AdminCategory): Promise<void> {
  if (!canWrite.value) return;
  const name = (catDraftName.value[cat.id] ?? '').trim();
  const sortOrder = catDraftSort.value[cat.id];
  if (!name || !Number.isInteger(sortOrder)) return;
  shell.setBusy(true);
  shell.setError(null);
  try {
    await updateAdminCategory(cat.id, { name, sortOrder });
    toast.success(t('admin.saved'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function removeCategory(cat: AdminCategory): Promise<void> {
  if (!canWrite.value) return;
  if ((cat._count?.products ?? 0) > 0) {
    shell.setError(t('admin.categoryHasProducts'));
    return;
  }
  shell.setBusy(true);
  shell.setError(null);
  try {
    await deleteAdminCategory(cat.id);
    toast.success(t('admin.categoryDeleted'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function addModifierGroup(): Promise<void> {
  if (!canWrite.value || !modifierProductId.value || !newGroup.value.name.trim()) return;
  shell.setBusy(true);
  shell.setError(null);
  try {
    await createModifierGroup(modifierProductId.value, {
      name: newGroup.value.name.trim(),
      minSelect: newGroup.value.minSelect,
      maxSelect: newGroup.value.maxSelect,
    });
    toast.success(t('admin.modifiers.groupCreated'));
    newGroup.value = { name: '', minSelect: 0, maxSelect: 1 };
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function removeModifierGroup(groupId: string): Promise<void> {
  if (!canWrite.value) return;
  shell.setBusy(true);
  shell.setError(null);
  try {
    await deleteModifierGroup(groupId);
    toast.success(t('admin.modifiers.groupDeleted'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function addModifierOption(groupId: string): Promise<void> {
  if (!canWrite.value) return;
  const draft = newOption.value[groupId] ?? { name: '', priceDeltaInCents: 0 };
  if (!draft.name.trim()) return;
  if (!Number.isInteger(draft.priceDeltaInCents)) {
    shell.setError(t('admin.modifiers.priceInvalid'));
    return;
  }
  shell.setBusy(true);
  shell.setError(null);
  try {
    await createModifierOption(groupId, {
      name: draft.name.trim(),
      priceDeltaInCents: draft.priceDeltaInCents,
    });
    toast.success(t('admin.modifiers.optionCreated'));
    newOption.value = { ...newOption.value, [groupId]: { name: '', priceDeltaInCents: 0 } };
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function toggleOptionActive(optionId: string, isActive: boolean): Promise<void> {
  if (!canWrite.value) return;
  shell.setBusy(true);
  try {
    await updateModifierOption(optionId, { isActive });
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function removeModifierOptionRow(optionId: string): Promise<void> {
  if (!canWrite.value) return;
  shell.setBusy(true);
  shell.setError(null);
  try {
    await deleteModifierOption(optionId);
    toast.success(t('admin.modifiers.optionDeleted'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function addProduct(): Promise<void> {
  if (!canWrite.value) return;
  const body = newProduct.value;
  if (!body.name.trim() || !body.sku.trim() || !body.categoryId) return;
  if (!Number.isInteger(body.unitPriceInCents) || body.unitPriceInCents < 0) return;
  shell.setBusy(true);
  try {
    await createAdminProduct({
      name: body.name.trim(),
      sku: body.sku.trim(),
      barcode: body.barcode.trim() || null,
      categoryId: body.categoryId,
      unitPriceInCents: body.unitPriceInCents,
      taxBps: body.taxBps,
      stockQty: body.stockQty,
      isActive: body.isActive,
      productType: body.productType,
      kitchenStationId: body.kitchenStationId || null,
    });
    newProduct.value = {
      name: '',
      sku: '',
      barcode: '',
      categoryId: categories.value[0]?.id ?? '',
      unitPriceInCents: 0,
      taxBps: 1100,
      stockQty: 0,
      productType: 'RETAIL',
      kitchenStationId: '',
      isActive: true,
    };
    toast.success(t('admin.saved'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveProductFull(product: AdminProduct): Promise<void> {
  if (!canWrite.value) return;
  const d = productDraft.value[product.id];
  if (!d) return;
  if (!d.name.trim() || !d.sku.trim()) return;
  if (!Number.isInteger(d.unitPriceInCents) || d.unitPriceInCents < 0) return;
  if (!Number.isInteger(d.stockQty) || !Number.isInteger(d.taxBps)) return;
  shell.setBusy(true);
  try {
    await updateAdminProduct(product.id, {
      name: d.name.trim(),
      sku: d.sku.trim(),
      barcode: d.barcode.trim() || null,
      categoryId: d.categoryId,
      unitPriceInCents: d.unitPriceInCents,
      taxBps: d.taxBps,
      stockQty: d.stockQty,
      isActive: d.isActive,
      productType: d.productType,
      kitchenStationId: d.kitchenStationId || null,
    });
    toast.success(t('admin.saved'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function addVariant(productId: string): Promise<void> {
  if (!canWrite.value) return;
  const v = newVariant.value;
  if (!v.sku.trim() || !v.name.trim()) return;
  if (!Number.isInteger(v.unitPriceInCents) || v.unitPriceInCents < 0) return;
  shell.setBusy(true);
  try {
    await createProductVariant(productId, {
      sku: v.sku.trim(),
      name: v.name.trim(),
      barcode: v.barcode.trim() || null,
      unitPriceInCents: v.unitPriceInCents,
    });
    newVariant.value = { sku: '', name: '', barcode: '', unitPriceInCents: 0 };
    toast.success(t('admin.variants.created'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveVariant(v: ProductVariant): Promise<void> {
  if (!canWrite.value) return;
  const d = variantDraft.value[v.id];
  if (!d || !d.name.trim()) return;
  if (!Number.isInteger(d.unitPriceInCents) || d.unitPriceInCents < 0) return;
  shell.setBusy(true);
  try {
    await updateProductVariant(v.id, {
      name: d.name.trim(),
      barcode: d.barcode.trim() || null,
      unitPriceInCents: d.unitPriceInCents,
      isActive: d.isActive,
    });
    toast.success(t('admin.saved'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function addPromo(): Promise<void> {
  if (!canWrite.value) return;
  if (!newPromo.value.code.trim() || !newPromo.value.name.trim()) return;
  shell.setBusy(true);
  shell.setError(null);
  try {
    await createPromo({
      code: newPromo.value.code.trim(),
      name: newPromo.value.name.trim(),
      type: newPromo.value.type,
      scope: 'ALL',
      percentBps: newPromo.value.type === 'PERCENT' ? newPromo.value.percentBps : null,
      amountInCents: newPromo.value.type === 'FIXED' ? newPromo.value.amountInCents : null,
      usageLimit: newPromo.value.usageLimit,
      minSubtotalInCents: newPromo.value.minSubtotalInCents,
      maxDiscountInCents: newPromo.value.maxDiscountInCents,
      isActive: true,
    });
    toast.success(t('admin.promos.created'));
    newPromo.value = {
      code: '',
      name: '',
      type: 'PERCENT',
      percentBps: 1000,
      amountInCents: 5000,
      usageLimit: null,
      minSubtotalInCents: 0,
      maxDiscountInCents: null,
    };
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function togglePromo(row: Promo): Promise<void> {
  if (!canWrite.value) return;
  shell.setBusy(true);
  try {
    await updatePromo(row.id, { isActive: !row.isActive });
    toast.success(t('admin.promos.saved'));
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function savePromoLimits(row: Promo): Promise<void> {
  if (!canWrite.value) return;
  const d = promoDraft.value[row.id];
  if (!d) return;
  shell.setBusy(true);
  try {
    await updatePromo(row.id, {
      usageLimit: d.usageLimit,
      minSubtotalInCents: d.minSubtotalInCents,
      maxDiscountInCents: d.maxDiscountInCents,
      ...(row.type === 'FIXED' ? { amountInCents: d.amountInCents } : { percentBps: d.percentBps }),
    });
    toast.success(t('admin.promos.saved'));
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

    <UiPanel v-if="tab === 'products'" :title="t('admin.tabs.products')">
      <div
        v-if="canWrite"
        class="mb-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <input v-model="newProduct.name" class="min-h-12 rounded-xl border border-slate-300 px-3" :placeholder="t('admin.name')" />
        <input v-model="newProduct.sku" class="min-h-12 rounded-xl border border-slate-300 px-3" :placeholder="t('admin.sku')" />
        <input v-model="newProduct.barcode" class="min-h-12 rounded-xl border border-slate-300 px-3" :placeholder="t('admin.barcode')" />
        <select v-model="newProduct.categoryId" class="min-h-12 rounded-xl border border-slate-300 px-3">
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <MoneyIdrInput v-model="newProduct.unitPriceInCents" :placeholder="t('admin.price')" />
        <input v-model.number="newProduct.taxBps" class="min-h-12 rounded-xl border border-slate-300 px-3" type="number" step="1" :placeholder="t('admin.taxBps')" />
        <input v-model.number="newProduct.stockQty" class="min-h-12 rounded-xl border border-slate-300 px-3" type="number" step="1" :placeholder="t('admin.stock')" />
        <select v-model="newProduct.productType" class="min-h-12 rounded-xl border border-slate-300 px-3">
          <option value="RETAIL">RETAIL</option>
          <option value="MENU">MENU</option>
          <option value="INGREDIENT">INGREDIENT</option>
        </select>
        <label class="inline-flex items-center gap-2 text-sm">
          <input v-model="newProduct.isActive" type="checkbox" class="h-4 w-4" />
          {{ t('admin.active') }}
        </label>
        <button class="touch-target rounded-xl bg-emerald-600 font-semibold text-white" type="button" :disabled="busy" @click="addProduct">
          {{ t('admin.addProduct') }}
        </button>
      </div>

      <div class="space-y-3">
        <div
          v-for="p in products"
          :key="p.id"
          class="rounded-2xl border border-slate-200 bg-white"
        >
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            @click="toggleExpand(p)"
          >
            <div>
              <p class="font-medium text-slate-900">{{ p.name }}</p>
              <p class="text-xs text-slate-500">
                {{ p.sku }} · {{ p.category?.name || '—' }} · {{ formatIdrFromCents(p.unitPriceInCents) }}
                · {{ p.isActive ? t('admin.active') : t('admin.inactive') }}
                <span v-if="(p.variants ?? []).length"> · {{ (p.variants ?? []).length }} {{ t('admin.variants.label') }}</span>
              </p>
            </div>
            <span class="text-slate-400">{{ expandedProductId === p.id ? '▾' : '▸' }}</span>
          </button>

          <div v-if="expandedProductId === p.id && productDraft[p.id]" class="border-t border-slate-100 px-4 py-4">
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label class="text-sm">
                {{ t('admin.name') }}
                <input v-model="productDraft[p.id]!.name" class="mt-1 min-h-11 w-full rounded-xl border px-3" :disabled="!canWrite" />
              </label>
              <label class="text-sm">
                {{ t('admin.sku') }}
                <input v-model="productDraft[p.id]!.sku" class="mt-1 min-h-11 w-full rounded-xl border px-3" :disabled="!canWrite" />
              </label>
              <label class="text-sm">
                {{ t('admin.barcode') }}
                <input v-model="productDraft[p.id]!.barcode" class="mt-1 min-h-11 w-full rounded-xl border px-3" :disabled="!canWrite" />
              </label>
              <label class="text-sm">
                {{ t('admin.category') }}
                <select v-model="productDraft[p.id]!.categoryId" class="mt-1 min-h-11 w-full rounded-xl border px-3" :disabled="!canWrite">
                  <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </label>
              <label class="text-sm">
                {{ t('admin.price') }}
                <MoneyIdrInput v-model="productDraft[p.id]!.unitPriceInCents" :disabled="!canWrite" />
              </label>
              <label class="text-sm">
                {{ t('admin.taxBps') }}
                <input v-model.number="productDraft[p.id]!.taxBps" class="mt-1 min-h-11 w-full rounded-xl border px-3" type="number" step="1" :disabled="!canWrite" />
              </label>
              <label class="text-sm">
                {{ t('admin.stock') }}
                <input v-model.number="productDraft[p.id]!.stockQty" class="mt-1 min-h-11 w-full rounded-xl border px-3" type="number" step="1" :disabled="!canWrite" />
              </label>
              <label class="text-sm">
                {{ t('admin.productType') }}
                <select v-model="productDraft[p.id]!.productType" class="mt-1 min-h-11 w-full rounded-xl border px-3" :disabled="!canWrite">
                  <option value="RETAIL">RETAIL</option>
                  <option value="MENU">MENU</option>
                  <option value="INGREDIENT">INGREDIENT</option>
                </select>
              </label>
              <label class="text-sm">
                {{ t('admin.kitchenStation') }}
                <select v-model="productDraft[p.id]!.kitchenStationId" class="mt-1 min-h-11 w-full rounded-xl border px-3" :disabled="!canWrite">
                  <option value="">{{ t('admin.kitchen.noStation') }}</option>
                  <option v-for="st in kitchenStations.filter((s) => s.isActive)" :key="st.id" :value="st.id">
                    {{ st.code }} — {{ st.name }}
                  </option>
                </select>
              </label>
              <label class="inline-flex items-center gap-2 self-end text-sm">
                <input v-model="productDraft[p.id]!.isActive" type="checkbox" class="h-4 w-4" :disabled="!canWrite" />
                {{ productDraft[p.id]!.isActive ? t('admin.active') : t('admin.inactive') }}
              </label>
            </div>
            <button
              v-if="canWrite"
              type="button"
              class="touch-target mt-3 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
              :disabled="busy"
              @click="saveProductFull(p)"
            >
              {{ t('admin.save') }}
            </button>

            <div class="mt-6 border-t border-slate-100 pt-4">
              <h4 class="mb-2 text-sm font-semibold text-slate-800">{{ t('admin.variants.title') }}</h4>
              <ul class="space-y-2">
                <li
                  v-for="v in p.variants ?? []"
                  :key="v.id"
                  class="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-5"
                >
                  <template v-if="variantDraft[v.id]">
                    <input v-model="variantDraft[v.id]!.name" class="min-h-10 rounded-lg border px-2" :disabled="!canWrite" :placeholder="t('admin.name')" />
                    <span class="flex items-center text-xs text-slate-500">{{ v.sku }}</span>
                    <input v-model="variantDraft[v.id]!.barcode" class="min-h-10 rounded-lg border px-2" :disabled="!canWrite" :placeholder="t('admin.barcode')" />
                    <MoneyIdrInput v-model="variantDraft[v.id]!.unitPriceInCents" :disabled="!canWrite" />
                    <div class="flex items-center gap-2">
                      <label class="inline-flex items-center gap-1 text-xs">
                        <input v-model="variantDraft[v.id]!.isActive" type="checkbox" class="h-3.5 w-3.5" :disabled="!canWrite" />
                        {{ t('admin.active') }}
                      </label>
                      <button
                        v-if="canWrite"
                        type="button"
                        class="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white"
                        :disabled="busy"
                        @click="saveVariant(v)"
                      >
                        {{ t('admin.save') }}
                      </button>
                    </div>
                  </template>
                </li>
              </ul>
              <div v-if="canWrite" class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <input v-model="newVariant.sku" class="min-h-10 rounded-lg border px-2" :placeholder="t('admin.sku')" />
                <input v-model="newVariant.name" class="min-h-10 rounded-lg border px-2" :placeholder="t('admin.name')" />
                <input v-model="newVariant.barcode" class="min-h-10 rounded-lg border px-2" :placeholder="t('admin.barcode')" />
                <MoneyIdrInput v-model="newVariant.unitPriceInCents" :placeholder="t('admin.price')" />
                <button type="button" class="rounded-xl bg-emerald-600 text-sm font-semibold text-white" :disabled="busy" @click="addVariant(p.id)">
                  {{ t('admin.variants.add') }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <p v-if="!products.length" class="text-sm text-slate-500">{{ t('admin.emptyProducts') }}</p>
      </div>
    </UiPanel>

    <UiPanel v-else-if="tab === 'categories'" :title="t('admin.tabs.categories')">
      <div v-if="canWrite" class="mb-4 flex flex-wrap gap-2">
        <input v-model="newCategoryName" class="min-h-12 min-w-[12rem] flex-1 rounded-xl border border-slate-300 px-3" :placeholder="t('admin.name')" />
        <button class="touch-target rounded-xl bg-emerald-600 px-4 font-semibold text-white" type="button" :disabled="busy" @click="addCategory">
          {{ t('admin.addCategory') }}
        </button>
      </div>
      <ul class="space-y-3">
        <li v-for="c in categories" :key="c.id" class="rounded-2xl bg-slate-50 px-4 py-3">
          <div v-if="canWrite" class="grid gap-2 sm:grid-cols-[1fr_6rem_auto_auto]">
            <input v-model="catDraftName[c.id]" class="min-h-11 rounded-xl border px-3" type="text" />
            <input v-model.number="catDraftSort[c.id]" class="min-h-11 rounded-xl border px-3 tabular-nums" type="number" step="1" />
            <button type="button" class="min-h-11 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-40" :disabled="busy" @click="saveCategory(c)">
              {{ t('admin.save') }}
            </button>
            <button type="button" class="min-h-11 rounded-xl bg-red-100 px-3 text-sm font-semibold text-red-800 disabled:opacity-40" :disabled="busy || (c._count?.products ?? 0) > 0" @click="removeCategory(c)">
              {{ t('common.delete') }}
            </button>
          </div>
          <div v-else class="flex items-center justify-between">
            <span class="font-medium">{{ c.name }}</span>
            <span class="text-sm text-slate-500">#{{ c.sortOrder }}</span>
          </div>
          <p class="mt-1 text-xs text-slate-500">{{ t('admin.categoryProductCount', { count: c._count?.products ?? 0 }) }}</p>
        </li>
        <li v-if="!categories.length" class="text-sm text-slate-500">{{ t('admin.emptyCategories') }}</li>
      </ul>
    </UiPanel>

    <UiPanel v-else-if="tab === 'modifiers'" :title="t('admin.tabs.modifiers')">
      <p class="mb-3 text-sm text-slate-600">{{ t('admin.modifiers.hint') }}</p>
      <label class="mb-4 block text-sm font-medium text-slate-600">
        {{ t('admin.modifiers.product') }}
        <select v-model="modifierProductId" class="mt-1 min-h-12 w-full max-w-md rounded-xl border px-3">
          <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }} ({{ p.sku }})</option>
        </select>
      </label>
      <div v-if="canWrite && modifierProductId" class="mb-4 grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-4">
        <input v-model="newGroup.name" class="min-h-11 rounded-xl border px-3 sm:col-span-2" type="text" :placeholder="t('admin.modifiers.groupName')" />
        <input v-model.number="newGroup.minSelect" class="min-h-11 rounded-xl border px-3 tabular-nums" type="number" min="0" step="1" />
        <div class="flex gap-2">
          <input v-model.number="newGroup.maxSelect" class="min-h-11 w-full rounded-xl border px-3 tabular-nums" type="number" min="1" step="1" />
          <button type="button" class="touch-target shrink-0 rounded-xl bg-emerald-700 px-3 text-sm font-semibold text-white" :disabled="busy" @click="addModifierGroup">
            {{ t('admin.modifiers.addGroup') }}
          </button>
        </div>
      </div>
      <div v-if="selectedModifierGroups.length" class="space-y-4">
        <section v-for="g in selectedModifierGroups" :key="g.id" class="rounded-2xl border border-slate-200 p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 class="font-semibold text-slate-900">{{ g.name }}</h3>
              <p class="text-xs text-slate-500">{{ t('admin.modifiers.bounds', { min: g.minSelect, max: g.maxSelect }) }}</p>
            </div>
            <button v-if="canWrite" type="button" class="rounded-xl bg-red-100 px-3 py-2 text-xs font-semibold text-red-800" :disabled="busy" @click="removeModifierGroup(g.id)">
              {{ t('admin.modifiers.deleteGroup') }}
            </button>
          </div>
          <ul class="space-y-2">
            <li v-for="opt in g.options" :key="opt.id" class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <span :class="opt.isActive ? '' : 'text-slate-400 line-through'">
                {{ opt.name }}
                <span class="tabular-nums text-slate-500">· {{ formatIdrFromCents(opt.priceDeltaInCents) }}</span>
              </span>
              <div v-if="canWrite" class="flex items-center gap-2">
                <label class="inline-flex items-center gap-1 text-xs">
                  <input type="checkbox" class="h-4 w-4" :checked="opt.isActive" @change="toggleOptionActive(opt.id, ($event.target as HTMLInputElement).checked)" />
                  {{ t('admin.active') }}
                </label>
                <button type="button" class="rounded-lg bg-slate-200 px-2 py-1 text-xs font-semibold" :disabled="busy" @click="removeModifierOptionRow(opt.id)">
                  {{ t('common.delete') }}
                </button>
              </div>
            </li>
          </ul>
          <div v-if="canWrite" class="mt-3 grid gap-2 sm:grid-cols-[1fr_minmax(8rem,12rem)_auto]">
            <input
              :value="(newOption[g.id] ?? { name: '' }).name"
              class="min-h-11 rounded-xl border px-3"
              type="text"
              :placeholder="t('admin.modifiers.optionName')"
              @input="newOption = { ...newOption, [g.id]: { name: ($event.target as HTMLInputElement).value, priceDeltaInCents: newOption[g.id]?.priceDeltaInCents ?? 0 } }"
            />
            <MoneyIdrInput
              :model-value="(newOption[g.id] ?? { priceDeltaInCents: 0 }).priceDeltaInCents"
              :placeholder="t('admin.modifiers.priceDelta')"
              @update:model-value="(n) => (newOption = { ...newOption, [g.id]: { name: newOption[g.id]?.name ?? '', priceDeltaInCents: n } })"
            />
            <button type="button" class="min-h-11 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white" :disabled="busy" @click="addModifierOption(g.id)">
              {{ t('admin.modifiers.addOption') }}
            </button>
          </div>
        </section>
      </div>
      <p v-else class="text-sm text-slate-500">{{ t('admin.modifiers.empty') }}</p>
    </UiPanel>

    <UiPanel v-else :title="t('admin.tabs.promos')">
      <p class="mb-4 text-sm text-slate-600">{{ t('admin.promos.hint') }}</p>
      <div v-if="canWrite" class="mb-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <input v-model="newPromo.code" class="min-h-12 rounded-xl border px-3 uppercase" :placeholder="t('admin.promos.code')" />
        <input v-model="newPromo.name" class="min-h-12 rounded-xl border px-3" :placeholder="t('admin.promos.name')" />
        <select v-model="newPromo.type" class="min-h-12 rounded-xl border px-3">
          <option value="PERCENT">{{ t('admin.promos.percent') }}</option>
          <option value="FIXED">{{ t('admin.promos.fixed') }}</option>
        </select>
        <input v-if="newPromo.type === 'PERCENT'" v-model.number="newPromo.percentBps" class="min-h-12 rounded-xl border px-3" type="number" step="1" :placeholder="t('admin.promos.percentBps')" />
        <MoneyIdrInput v-else v-model="newPromo.amountInCents" :placeholder="t('admin.promos.amount')" />
        <input v-model.number="newPromo.minSubtotalInCents" class="min-h-12 rounded-xl border px-3" type="number" step="1" :placeholder="t('admin.promos.minSubtotal')" />
        <input :value="newPromo.usageLimit ?? ''" class="min-h-12 rounded-xl border px-3" type="number" step="1" :placeholder="t('admin.promos.usageLimit')" @input="newPromo.usageLimit = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)" />
        <button type="button" class="touch-target rounded-xl bg-emerald-600 font-semibold text-white" :disabled="busy" @click="addPromo">
          {{ t('admin.promos.add') }}
        </button>
      </div>
      <ul class="space-y-3">
        <li v-for="p in promos" :key="p.id" class="rounded-2xl bg-slate-50 px-4 py-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <strong>{{ p.code }}</strong> · {{ p.name }} ·
              {{ p.type === 'PERCENT' ? `${(p.percentBps ?? 0) / 100}%` : formatIdrFromCents(p.amountInCents ?? 0) }}
              <span class="text-slate-500">
                · {{ p.isActive ? t('admin.active') : t('admin.inactive') }}
                · used {{ p.usedCount }}{{ p.usageLimit != null ? `/${p.usageLimit}` : '' }}
              </span>
            </div>
            <button v-if="canWrite" type="button" class="touch-target rounded-xl bg-white px-3 text-sm font-semibold ring-1 ring-slate-200" :disabled="busy" @click="togglePromo(p)">
              {{ p.isActive ? t('admin.promos.deactivate') : t('admin.promos.activate') }}
            </button>
          </div>
          <div v-if="canWrite && promoDraft[p.id]" class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label class="text-xs">
              {{ t('admin.promos.usageLimit') }}
              <input
                :value="promoDraft[p.id]!.usageLimit ?? ''"
                class="mt-1 min-h-10 w-full rounded-lg border px-2"
                type="number"
                @input="promoDraft[p.id]!.usageLimit = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="text-xs">
              {{ t('admin.promos.minSubtotal') }}
              <MoneyIdrInput v-model="promoDraft[p.id]!.minSubtotalInCents" />
            </label>
            <label class="text-xs">
              {{ t('admin.promos.maxDiscount') }}
              <MoneyIdrInput
                :model-value="promoDraft[p.id]!.maxDiscountInCents ?? 0"
                @update:model-value="(n) => (promoDraft[p.id]!.maxDiscountInCents = n)"
              />
            </label>
            <button type="button" class="self-end rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white" :disabled="busy" @click="savePromoLimits(p)">
              {{ t('admin.save') }}
            </button>
          </div>
        </li>
        <li v-if="!promos.length" class="text-slate-500">{{ t('admin.promos.empty') }}</li>
      </ul>
    </UiPanel>
  </div>
</template>
