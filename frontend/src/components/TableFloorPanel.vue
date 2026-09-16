<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';
import {
  fetchTableFloor,
  type FloorTable,
  type TableFloor,
  type TableFloorStatus,
} from '../services/tables-api.service';

const props = defineProps<{
  storeId: string;
}>();

const emit = defineEmits<{
  select: [table: FloorTable];
}>();

const { t } = useI18n();
const floor = ref<TableFloor | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

function statusClass(status: TableFloorStatus): string {
  if (status === 'AVAILABLE') return 'border-emerald-200 bg-emerald-50 text-emerald-950';
  if (status === 'BILLING') return 'border-amber-200 bg-amber-50 text-amber-950';
  return 'border-violet-200 bg-violet-50 text-violet-950';
}

function statusLabel(status: TableFloorStatus): string {
  return t(`pos.tables.status.${status.toLowerCase()}`);
}

async function load(): Promise<void> {
  if (!props.storeId) return;
  loading.value = true;
  error.value = null;
  try {
    floor.value = await fetchTableFloor(props.storeId);
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('pos.tables.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
watch(() => props.storeId, () => void load());

defineExpose({ reload: load });
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="mb-3 flex items-center justify-between gap-2">
      <p class="text-sm text-slate-600">{{ t('pos.tables.hint') }}</p>
      <button
        type="button"
        class="min-h-10 rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-800"
        :disabled="loading"
        @click="load"
      >
        {{ t('common.reload') }}
      </button>
    </div>

    <p v-if="error" class="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{{ error }}</p>
    <p v-if="loading && !floor" class="text-sm text-slate-500">{{ t('common.loading') }}</p>

    <div v-if="floor" class="min-h-0 flex-1 space-y-4 overflow-auto pb-4">
      <section v-for="area in floor.areas" :key="area.id">
        <h3 class="mb-2 text-sm font-semibold text-slate-700">{{ area.name }}</h3>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          <button
            v-for="table in area.tables"
            :key="table.id"
            type="button"
            class="flex min-h-[5.5rem] flex-col justify-between rounded-2xl border-2 p-3 text-left shadow-sm transition active:scale-[0.98]"
            :class="statusClass(table.status)"
            @click="emit('select', table)"
          >
            <div>
              <strong class="text-lg">{{ table.code }}</strong>
              <p class="text-xs opacity-80">{{ table.name }} · {{ table.capacity }}p</p>
            </div>
            <div class="text-xs font-medium">
              {{ statusLabel(table.status) }}
              <span v-if="table.activeCart" class="block tabular-nums">
                {{ formatIdrFromCents(table.activeCart.totalInCents) }}
                · {{ table.activeCart.itemCount }} item
              </span>
            </div>
          </button>
        </div>
      </section>

      <section v-if="floor.ungrouped.length">
        <h3 class="mb-2 text-sm font-semibold text-slate-700">{{ t('pos.tables.ungrouped') }}</h3>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          <button
            v-for="table in floor.ungrouped"
            :key="table.id"
            type="button"
            class="flex min-h-[5.5rem] flex-col justify-between rounded-2xl border-2 p-3 text-left shadow-sm transition active:scale-[0.98]"
            :class="statusClass(table.status)"
            @click="emit('select', table)"
          >
            <div>
              <strong class="text-lg">{{ table.code }}</strong>
              <p class="text-xs opacity-80">{{ table.name }} · {{ table.capacity }}p</p>
            </div>
            <div class="text-xs font-medium">
              {{ statusLabel(table.status) }}
              <span v-if="table.activeCart" class="block tabular-nums">
                {{ formatIdrFromCents(table.activeCart.totalInCents) }}
                · {{ table.activeCart.itemCount }} item
              </span>
            </div>
          </button>
        </div>
      </section>

      <p
        v-if="!floor.areas.length && !floor.ungrouped.length"
        class="rounded-xl bg-slate-50 p-4 text-sm text-slate-500"
      >
        {{ t('pos.tables.empty') }}
      </p>
    </div>
  </div>
</template>
