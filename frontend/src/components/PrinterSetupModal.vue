<script setup lang="ts">
/**
 * Printer connection setup: USB/Serial pair + LAN (TCP 9100 via API).
 * Bluetooth classic SPP is not available in pure browser — documented in UI.
 */
import { storeToRefs } from 'pinia';
import { ref, watch } from 'vue';
import { useI18n } from '../i18n';
import { usePrinterStore } from '../stores/printer.store';
import { useToastStore } from '../stores/toast.store';

const { t } = useI18n();
const printer = usePrinterStore();
const toast = useToastStore();
const {
  setupOpen,
  busy,
  networkHost,
  networkPort,
  networkEnabled,
  serialPaired,
  usbPaired,
  lastMethod,
  lastError,
  isConnected,
} = storeToRefs(printer);

const hostDraft = ref('');
const portDraft = ref(9100);
const enabledDraft = ref(true);

watch(
  setupOpen,
  (open) => {
    if (!open) return;
    hostDraft.value = networkHost.value;
    portDraft.value = networkPort.value || 9100;
    enabledDraft.value = networkEnabled.value || Boolean(networkHost.value);
  },
  { immediate: true },
);

async function onPairUsb(): Promise<void> {
  try {
    const result = await printer.pairUsbSerial();
    if (result.ok) {
      toast.success(t('pos.toast.printerOk'), result.method);
    } else {
      toast.warning(t('pos.toast.printerPreview'), t('pos.toast.printerPreviewBody'));
    }
  } catch (error) {
    toast.error(
      t('pos.errors.printer'),
      error instanceof Error ? error.message : undefined,
    );
  }
}

function onSaveLan(): void {
  printer.saveNetwork(hostDraft.value, portDraft.value, enabledDraft.value);
  toast.success(t('pos.printer.lanSaved'));
}

async function onPingLan(): Promise<void> {
  printer.saveNetwork(hostDraft.value, portDraft.value, true);
  enabledDraft.value = true;
  const result = await printer.pingLan();
  if (result.ok) {
    toast.success(
      t('pos.printer.lanPingOk'),
      result.latencyMs != null ? `${result.latencyMs} ms` : undefined,
    );
  } else {
    toast.error(t('pos.printer.lanPingFail'), result.error);
  }
}

async function onTestLan(): Promise<void> {
  printer.saveNetwork(hostDraft.value, portDraft.value, true);
  enabledDraft.value = true;
  const result = await printer.testLanPrint();
  if (result.ok) {
    toast.success(t('pos.toast.printerOk'), 'network');
  } else {
    toast.error(t('pos.printer.lanPrintFail'), result.error);
  }
}

function onClearLan(): void {
  hostDraft.value = '';
  enabledDraft.value = false;
  printer.saveNetwork('', 9100, false);
  toast.info(t('pos.printer.lanCleared'));
}
</script>

<template>
  <div
    v-if="setupOpen"
    class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center"
    role="dialog"
    aria-modal="true"
    @click.self="printer.closeSetup()"
  >
    <div class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-900">{{ t('pos.printer.setupTitle') }}</h2>
          <p class="mt-1 text-sm text-slate-500">{{ t('pos.printer.setupSubtitle') }}</p>
        </div>
        <button
          type="button"
          class="min-h-10 rounded-xl bg-slate-100 px-3 text-sm font-semibold"
          @click="printer.closeSetup()"
        >
          {{ t('common.close') }}
        </button>
      </div>

      <div
        class="mb-4 rounded-2xl px-4 py-3 text-sm font-semibold"
        :class="isConnected ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'"
      >
        <p>{{ t(printer.statusLabelKey) }}</p>
        <p class="mt-1 text-xs font-normal opacity-80">
          {{
            t('pos.printer.detail', {
              method: lastMethod,
              serial: serialPaired ? '✓' : '—',
              usb: usbPaired ? '✓' : '—',
              lan: networkEnabled && networkHost ? networkHost : '—',
            })
          }}
        </p>
        <p v-if="lastError && lastError !== 'preview'" class="mt-1 text-xs font-normal text-red-700">
          {{ lastError }}
        </p>
      </div>

      <section class="mb-5 space-y-2">
        <h3 class="text-sm font-semibold text-slate-800">{{ t('pos.printer.usbTitle') }}</h3>
        <p class="text-sm text-slate-600">{{ t('pos.printer.usbHint') }}</p>
        <button
          type="button"
          class="touch-target w-full rounded-2xl bg-slate-900 text-base font-semibold text-white disabled:opacity-40"
          :disabled="busy"
          @click="onPairUsb"
        >
          {{ t('pos.printer.pairUsb') }}
        </button>
      </section>

      <section class="mb-5 space-y-3">
        <h3 class="text-sm font-semibold text-slate-800">{{ t('pos.printer.lanTitle') }}</h3>
        <p class="text-sm text-slate-600">{{ t('pos.printer.lanHint') }}</p>
        <label class="block text-sm font-medium text-slate-600">
          {{ t('pos.printer.lanHost') }}
          <input
            v-model="hostDraft"
            class="mt-1 min-h-12 w-full rounded-2xl border border-slate-300 px-3"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            placeholder="192.168.1.50"
          />
        </label>
        <label class="block text-sm font-medium text-slate-600">
          {{ t('pos.printer.lanPort') }}
          <input
            v-model.number="portDraft"
            class="mt-1 min-h-12 w-full rounded-2xl border border-slate-300 px-3 tabular-nums"
            type="number"
            min="1"
            max="65535"
            step="1"
          />
        </label>
        <label class="flex min-h-12 items-center gap-3 rounded-2xl bg-slate-50 px-3 text-sm font-medium text-slate-700">
          <input v-model="enabledDraft" type="checkbox" class="h-5 w-5" />
          {{ t('pos.printer.lanEnable') }}
        </label>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="touch-target rounded-2xl bg-slate-100 text-sm font-semibold disabled:opacity-40"
            :disabled="busy || !hostDraft.trim()"
            @click="onSaveLan"
          >
            {{ t('pos.printer.lanSave') }}
          </button>
          <button
            type="button"
            class="touch-target rounded-2xl bg-slate-100 text-sm font-semibold disabled:opacity-40"
            :disabled="busy || !hostDraft.trim()"
            @click="onPingLan"
          >
            {{ t('pos.printer.lanPing') }}
          </button>
          <button
            type="button"
            class="touch-target rounded-2xl bg-emerald-700 text-sm font-semibold text-white disabled:opacity-40"
            :disabled="busy || !hostDraft.trim()"
            @click="onTestLan"
          >
            {{ t('pos.printer.lanTest') }}
          </button>
          <button
            type="button"
            class="touch-target rounded-2xl bg-slate-100 text-sm font-semibold"
            :disabled="busy"
            @click="onClearLan"
          >
            {{ t('pos.printer.lanClear') }}
          </button>
        </div>
      </section>

      <section class="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p class="font-semibold text-slate-800">{{ t('pos.printer.btTitle') }}</p>
        <p class="mt-1">{{ t('pos.printer.btHint') }}</p>
      </section>
    </div>
  </div>
</template>
