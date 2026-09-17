<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import { useI18n } from '../i18n';
import { playKitchenChime, unlockKitchenChime } from '../lib/kitchen-chime';
import {
  bumpKitchenLine,
  fetchKitchenStations,
  fetchKitchenTickets,
  type KitchenStation,
  type KitchenTicket,
} from '../services/kitchen-api.service';
import { useAuthStore } from '../stores/auth.store';
import { useCatalogStore } from '../stores/catalog.store';
import { useKitchenNotifyStore } from '../stores/kitchen-notify.store';
import { useToastStore } from '../stores/toast.store';

const { t } = useI18n();
const auth = useAuthStore();
const catalog = useCatalogStore();
const kitchenNotify = useKitchenNotifyStore();
const toast = useToastStore();

const stations = ref<KitchenStation[]>([]);
const stationId = ref<string>('all');
const tickets = ref<KitchenTicket[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const storeId = computed(() => catalog.session?.storeId ?? '');
const storeLabel = computed(() => {
  const s = catalog.session;
  if (!s) return '';
  return s.storeName || s.storeId;
});

const filteredTickets = computed(() => {
  if (stationId.value === 'all') return tickets.value;
  return tickets.value
    .map((ticket) => ({
      ...ticket,
      lines: ticket.lines.filter((l) => l.station.id === stationId.value),
    }))
    .filter((tk) => tk.lines.length > 0);
});

async function reload(): Promise<void> {
  if (!storeId.value) return;
  try {
    tickets.value = await fetchKitchenTickets(
      storeId.value,
      stationId.value === 'all' ? undefined : stationId.value,
    );
    error.value = null;
    kitchenNotify.unseenCount = 0;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('kitchen.loadFailed');
  }
}

async function loadStations(): Promise<void> {
  if (!storeId.value) return;
  try {
    stations.value = (await fetchKitchenStations(storeId.value)).filter((s) => s.isActive);
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('kitchen.loadFailed');
  }
}

function pickDefaultStation(): void {
  stationId.value = 'all';
  if (stations.value.length === 1) {
    stationId.value = stations.value[0]!.id;
  } else if (
    auth.staff?.role === 'KITCHEN' &&
    auth.staff.kitchenStationIds.length === 1 &&
    stations.value.some((s) => s.id === auth.staff!.kitchenStationIds[0])
  ) {
    stationId.value = auth.staff.kitchenStationIds[0]!;
  }
}

async function bump(lineId: string, status: 'PREPARING' | 'READY' | 'DONE'): Promise<void> {
  busy.value = true;
  try {
    await bumpKitchenLine(lineId, status);
    await reload();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('kitchen.bumpFailed'));
  } finally {
    busy.value = false;
  }
}

function nextStatus(current: string): 'PREPARING' | 'READY' | 'DONE' | null {
  if (current === 'PENDING') return 'PREPARING';
  if (current === 'PREPARING') return 'READY';
  if (current === 'READY') return 'DONE';
  return null;
}

async function toggleSound(): Promise<void> {
  await unlockKitchenChime();
  kitchenNotify.setSoundEnabled(!kitchenNotify.soundEnabled);
  if (kitchenNotify.soundEnabled) {
    playKitchenChime();
  }
}

async function bootForStore(): Promise<void> {
  tickets.value = [];
  stations.value = [];
  await loadStations();
  pickDefaultStation();
  await reload();
}

onMounted(async () => {
  kitchenNotify.markViewing(true);
  if (!catalog.session) {
    await catalog.init();
  }
  await bootForStore();
  pollTimer = setInterval(() => void reload(), 5000);
});

watch(storeId, async (next, prev) => {
  if (!next || next === prev) return;
  await bootForStore();
});

onUnmounted(() => {
  kitchenNotify.markViewing(false);
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div class="mx-auto max-w-7xl p-4">
    <PageHeader compact :title="t('kitchen.title')" :subtitle="t('kitchen.subtitle')">
      <template #actions>
        <span
          v-if="storeLabel"
          class="hidden rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 sm:inline"
        >
          {{ storeLabel }}
        </span>
        <button
          type="button"
          class="min-h-9 rounded-lg px-3 text-sm font-semibold ring-1 ring-slate-200"
          :class="kitchenNotify.soundEnabled ? 'bg-orange-50 text-orange-900' : 'bg-white text-slate-600'"
          @click="toggleSound"
        >
          {{ kitchenNotify.soundEnabled ? t('kitchen.soundOn') : t('kitchen.soundOff') }}
        </button>
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <button
        v-if="stations.length !== 1"
        type="button"
        class="min-h-11 rounded-xl px-4 text-sm font-semibold"
        :class="stationId === 'all' ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-200'"
        @click="stationId = 'all'; reload()"
      >
        {{ t('common.all') }}
      </button>
      <button
        v-for="s in stations"
        :key="s.id"
        type="button"
        class="min-h-11 rounded-xl px-4 text-sm font-semibold"
        :class="stationId === s.id ? 'bg-orange-600 text-white' : 'bg-white ring-1 ring-slate-200'"
        @click="stationId = s.id; reload()"
      >
        {{ s.code }} · {{ s.name }}
      </button>
      <button
        type="button"
        class="ml-auto min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-semibold"
        :disabled="busy"
        @click="reload"
      >
        {{ t('common.reload') }}
      </button>
    </div>

    <p v-if="error" class="mb-4 rounded-xl bg-red-50 p-3 text-red-800">{{ error }}</p>
    <p v-if="!storeId" class="text-slate-500">{{ t('kitchen.noStore') }}</p>

    <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="ticket in filteredTickets"
        :key="ticket.orderId"
        class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <header class="mb-3 flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
          <div>
            <h2 class="text-lg font-bold text-slate-900">
              {{ ticket.tableLabel || ticket.cartClientUuid.slice(0, 8) }}
            </h2>
            <p class="text-xs text-slate-500">
              {{ new Date(ticket.createdAt).toLocaleTimeString() }}
            </p>
          </div>
        </header>
        <ul class="space-y-2">
          <li
            v-for="line in ticket.lines"
            :key="line.id"
            class="rounded-xl p-3"
            :class="{
              'bg-amber-50': line.status === 'PENDING',
              'bg-sky-50': line.status === 'PREPARING',
              'bg-emerald-50': line.status === 'READY',
            }"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="font-semibold">
                  {{ line.quantity }}× {{ line.productName }}
                  <span v-if="line.guestIndex > 1" class="text-xs text-slate-500">
                    (G{{ line.guestIndex }})
                  </span>
                </p>
                <p v-if="line.modifiersJson?.length" class="text-xs text-slate-600">
                  {{ line.modifiersJson.map((m) => m.name).join(', ') }}
                </p>
                <p class="text-xs font-medium text-orange-800">{{ line.station.code }}</p>
              </div>
              <button
                v-if="nextStatus(line.status)"
                type="button"
                class="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                :disabled="busy"
                @click="bump(line.id, nextStatus(line.status)!)"
              >
                {{ t(`kitchen.status.${nextStatus(line.status)!}`) }}
              </button>
            </div>
          </li>
        </ul>
      </article>
      <p v-if="!filteredTickets.length" class="col-span-full rounded-xl bg-slate-50 p-6 text-center text-slate-500">
        {{ t('kitchen.empty') }}
      </p>
    </div>

    <p class="mt-4 text-xs text-slate-400">
      {{ auth.staff?.displayName }} · {{ storeLabel }} · {{ t('kitchen.autoRefresh') }}
    </p>
  </div>
</template>
