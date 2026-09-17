import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  getNetworkPrinterConfig,
  pairThermalPrinter,
  probeBrowserPrinterPresence,
  setNetworkPrinterConfig,
  testNetworkPrinter,
  type NetworkPrinterConfig,
  type PrintTransport,
} from '../lib/escpos';
import { pingNetworkPrinter } from '../services/printer-api.service';

export type PrinterConnectionKind = PrintTransport | 'none';

export const usePrinterStore = defineStore('printer', () => {
  const lastMethod = ref<PrinterConnectionKind>('none');
  const lastOkAt = ref<number | null>(null);
  const lastError = ref<string | null>(null);
  const serialPaired = ref(false);
  const usbPaired = ref(false);
  const networkHost = ref('');
  const networkPort = ref(9100);
  const networkEnabled = ref(false);
  const setupOpen = ref(false);
  const busy = ref(false);

  const statusLabelKey = computed(() => {
    if (lastMethod.value === 'webserial') return 'pos.printer.status.serial';
    if (lastMethod.value === 'webusb') return 'pos.printer.status.usb';
    if (lastMethod.value === 'network') return 'pos.printer.status.network';
    if (serialPaired.value || usbPaired.value || (networkEnabled.value && networkHost.value)) {
      return 'pos.printer.status.ready';
    }
    return 'pos.printer.status.none';
  });

  const isConnected = computed(
    () =>
      lastMethod.value === 'webserial' ||
      lastMethod.value === 'webusb' ||
      lastMethod.value === 'network' ||
      serialPaired.value ||
      usbPaired.value ||
      (networkEnabled.value && Boolean(networkHost.value)),
  );

  function loadNetworkFromStorage(): void {
    const cfg = getNetworkPrinterConfig();
    if (!cfg) {
      networkHost.value = '';
      networkPort.value = 9100;
      networkEnabled.value = false;
      return;
    }
    networkHost.value = cfg.host;
    networkPort.value = cfg.port;
    networkEnabled.value = cfg.enabled;
  }

  async function refreshPresence(): Promise<void> {
    loadNetworkFromStorage();
    const presence = await probeBrowserPrinterPresence();
    serialPaired.value = presence.serial;
    usbPaired.value = presence.usb;
    if (lastMethod.value === 'none') {
      if (presence.serial) lastMethod.value = 'webserial';
      else if (presence.usb) lastMethod.value = 'webusb';
      else if (networkEnabled.value && networkHost.value) lastMethod.value = 'network';
    }
  }

  function openSetup(): void {
    loadNetworkFromStorage();
    setupOpen.value = true;
    void refreshPresence();
  }

  function closeSetup(): void {
    setupOpen.value = false;
  }

  function saveNetwork(host: string, port: number, enabled: boolean): void {
    const cfg: NetworkPrinterConfig = {
      host: host.trim(),
      port: Number.isInteger(port) ? port : 9100,
      enabled,
    };
    setNetworkPrinterConfig(cfg.host ? cfg : null);
    networkHost.value = cfg.host;
    networkPort.value = cfg.port;
    networkEnabled.value = Boolean(cfg.host) && enabled;
    if (networkEnabled.value) {
      lastMethod.value = 'network';
    }
  }

  async function pairUsbSerial(): Promise<{ ok: boolean; method: PrintTransport }> {
    busy.value = true;
    lastError.value = null;
    try {
      const result = await pairThermalPrinter();
      if (result.ok) {
        lastMethod.value = result.method;
        lastOkAt.value = Date.now();
        await refreshPresence();
      } else {
        lastError.value = result.error ?? 'preview';
      }
      return { ok: result.ok, method: result.method };
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'pair failed';
      throw error;
    } finally {
      busy.value = false;
    }
  }

  async function pingLan(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    if (!networkHost.value.trim()) {
      return { ok: false, error: 'missing host' };
    }
    busy.value = true;
    lastError.value = null;
    try {
      const result = await pingNetworkPrinter(networkHost.value.trim(), networkPort.value);
      lastMethod.value = 'network';
      lastOkAt.value = Date.now();
      return { ok: true, latencyMs: result.latencyMs };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ping failed';
      lastError.value = message;
      return { ok: false, error: message };
    } finally {
      busy.value = false;
    }
  }

  async function testLanPrint(): Promise<{ ok: boolean; error?: string }> {
    if (!networkHost.value.trim()) {
      return { ok: false, error: 'missing host' };
    }
    busy.value = true;
    lastError.value = null;
    try {
      saveNetwork(networkHost.value, networkPort.value, true);
      const result = await testNetworkPrinter(networkHost.value.trim(), networkPort.value);
      if (result.ok) {
        lastMethod.value = 'network';
        lastOkAt.value = Date.now();
        return { ok: true };
      }
      lastError.value = result.error ?? 'print failed';
      return { ok: false, error: result.error };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'print failed';
      lastError.value = message;
      return { ok: false, error: message };
    } finally {
      busy.value = false;
    }
  }

  function markPrintResult(method: PrintTransport, ok: boolean): void {
    if (ok && method !== 'preview') {
      lastMethod.value = method;
      lastOkAt.value = Date.now();
      lastError.value = null;
    } else if (!ok) {
      lastError.value = 'preview';
    }
  }

  // Hydrate on store init.
  loadNetworkFromStorage();
  void refreshPresence();

  return {
    lastMethod,
    lastOkAt,
    lastError,
    serialPaired,
    usbPaired,
    networkHost,
    networkPort,
    networkEnabled,
    setupOpen,
    busy,
    statusLabelKey,
    isConnected,
    refreshPresence,
    openSetup,
    closeSetup,
    saveNetwork,
    pairUsbSerial,
    pingLan,
    testLanPrint,
    markPrintResult,
  };
});
