/**
 * ESC/POS command builder for 58/80mm thermal printers.
 * Transport priority: Web Serial → WebUSB → LAN (API TCP 9100) → hex preview.
 * All money formatting expects integer smallest currency units (no float).
 */

import { formatMoney } from './money';
import { printNetworkRaw } from '../services/printer-api.service';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const NETWORK_STORAGE_KEY = 'bonpos.printer.network';

export type NetworkPrinterConfig = {
  enabled: boolean;
  host: string;
  port: number;
};

export type ReceiptLineItem = {
  name: string;
  quantity: number;
  unitPriceInCents: number;
  lineTotalInCents: number;
};

export type ReceiptData = {
  storeName: string;
  storeCode?: string;
  cashierName: string;
  saleId: string;
  createdAt: Date | string;
  paymentMethod: string;
  lines: ReceiptLineItem[];
  subtotalInCents: number;
  taxInCents: number;
  discountInCents?: number;
  totalInCents: number;
  amountTenderedInCents?: number;
  changeInCents?: number;
  /** Paper width in characters (32 ≈ 58mm, 48 ≈ 80mm). */
  width?: number;
};

export type PrintTransport = 'webserial' | 'webusb' | 'network' | 'preview';

export type PrintResult = {
  ok: boolean;
  method: PrintTransport;
  hex: string;
  error?: string;
};

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};

type SerialNav = {
  getPorts: () => Promise<SerialPortLike[]>;
  requestPort: (options?: { filters?: Array<{ usbVendorId?: number }> }) => Promise<SerialPortLike>;
};

type UsbDeviceLike = {
  opened: boolean;
  configuration: { interfaces: Array<{ interfaceNumber: number; claimed?: boolean }> } | null;
  open: () => Promise<void>;
  close: () => Promise<void>;
  selectConfiguration: (n: number) => Promise<void>;
  claimInterface: (n: number) => Promise<void>;
  releaseInterface: (n: number) => Promise<void>;
  transferOut: (endpointNumber: number, data: BufferSource) => Promise<{ status: string }>;
};

type UsbNav = {
  getDevices: () => Promise<UsbDeviceLike[]>;
  requestDevice: (options: {
    filters: Array<{ classCode?: number; vendorId?: number }>;
  }) => Promise<UsbDeviceLike>;
};

function encoder(): TextEncoder {
  return new TextEncoder();
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function text(value: string): Uint8Array {
  return encoder().encode(value);
}

function init(): Uint8Array {
  return new Uint8Array([ESC, 0x40]); // ESC @
}

function align(mode: 'left' | 'center' | 'right'): Uint8Array {
  const n = mode === 'center' ? 1 : mode === 'right' ? 2 : 0;
  return new Uint8Array([ESC, 0x61, n]);
}

function bold(on: boolean): Uint8Array {
  return new Uint8Array([ESC, 0x45, on ? 1 : 0]);
}

function feed(lines = 1): Uint8Array {
  return new Uint8Array(Array.from({ length: lines }, () => LF));
}

function cut(): Uint8Array {
  // GS V 0 — full cut
  return new Uint8Array([GS, 0x56, 0x00]);
}

export function formatIdrEscPos(amountInCents: number): string {
  return formatMoney(amountInCents, { currency: 'IDR', compact: true });
}

/** ESC p m t1 t2 — open cash drawer (pin 0). */
export function escPosOpenDrawer(): Uint8Array {
  return new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xfa]);
}

function padLine(left: string, right: string, width: number): string {
  const gap = width - left.length - right.length;
  if (gap <= 0) {
    return `${left.slice(0, Math.max(0, width - right.length - 1))} ${right}`.slice(0, width);
  }
  return `${left}${' '.repeat(gap)}${right}`;
}

function rule(width: number): string {
  return '-'.repeat(width);
}

/** Plain-text receipt body (same layout as thermal) for on-screen preview. */
export function formatSaleReceiptText(data: ReceiptData): string {
  const width = data.width ?? 32;
  const when =
    typeof data.createdAt === 'string' ? new Date(data.createdAt) : data.createdAt;
  const lines: string[] = [];

  const center = (value: string) => {
    const pad = Math.max(0, Math.floor((width - value.length) / 2));
    return `${' '.repeat(pad)}${value}`.slice(0, width);
  };

  lines.push(center(data.storeName));
  if (data.storeCode) {
    lines.push(center(data.storeCode));
  }
  lines.push(center(when.toLocaleString('id-ID')));
  lines.push(rule(width));
  lines.push(`Kasir: ${data.cashierName}`);
  lines.push(`No: ${data.saleId.slice(0, 8)}`);
  lines.push(rule(width));

  for (const line of data.lines) {
    lines.push(line.name);
    lines.push(
      padLine(
        `${line.quantity} x ${formatIdrEscPos(line.unitPriceInCents)}`,
        formatIdrEscPos(line.lineTotalInCents),
        width,
      ),
    );
  }

  lines.push(rule(width));
  lines.push(padLine('Subtotal', formatIdrEscPos(data.subtotalInCents), width));
  lines.push(padLine('Pajak', formatIdrEscPos(data.taxInCents), width));
  if (data.discountInCents && data.discountInCents > 0) {
    lines.push(padLine('Diskon', `-${formatIdrEscPos(data.discountInCents)}`, width));
  }
  lines.push(padLine('TOTAL', formatIdrEscPos(data.totalInCents), width));
  lines.push(`Bayar: ${data.paymentMethod}`);
  if (data.amountTenderedInCents != null && data.amountTenderedInCents > 0) {
    lines.push(padLine('Tunai', formatIdrEscPos(data.amountTenderedInCents), width));
    lines.push(padLine('Kembali', formatIdrEscPos(data.changeInCents ?? 0), width));
  }
  lines.push('');
  lines.push(center('Terima kasih'));
  return lines.join('\n');
}

/**
 * Build a complete sale receipt as ESC/POS bytes.
 * Does not auto-open the drawer — call escPosOpenDrawer separately when needed.
 */
export function buildSaleReceipt(data: ReceiptData): Uint8Array {
  const width = data.width ?? 32;
  const when =
    typeof data.createdAt === 'string' ? new Date(data.createdAt) : data.createdAt;
  const chunks: Uint8Array[] = [
    init(),
    align('center'),
    bold(true),
    text(`${data.storeName}\n`),
    bold(false),
  ];

  if (data.storeCode) {
    chunks.push(text(`${data.storeCode}\n`));
  }

  chunks.push(
    text(`${when.toLocaleString('id-ID')}\n`),
    align('left'),
    text(rule(width) + '\n'),
    text(`Kasir: ${data.cashierName}\n`),
    text(`No: ${data.saleId.slice(0, 8)}\n`),
    text(rule(width) + '\n'),
  );

  for (const line of data.lines) {
    chunks.push(text(`${line.name}\n`));
    chunks.push(
      text(
        padLine(
          `${line.quantity} x ${formatIdrEscPos(line.unitPriceInCents)}`,
          formatIdrEscPos(line.lineTotalInCents),
          width,
        ) + '\n',
      ),
    );
  }

  chunks.push(text(rule(width) + '\n'));
  chunks.push(
    text(padLine('Subtotal', formatIdrEscPos(data.subtotalInCents), width) + '\n'),
  );
  chunks.push(text(padLine('Pajak', formatIdrEscPos(data.taxInCents), width) + '\n'));
  if (data.discountInCents && data.discountInCents > 0) {
    chunks.push(
      text(padLine('Diskon', `-${formatIdrEscPos(data.discountInCents)}`, width) + '\n'),
    );
  }
  chunks.push(bold(true));
  chunks.push(text(padLine('TOTAL', formatIdrEscPos(data.totalInCents), width) + '\n'));
  chunks.push(bold(false));
  chunks.push(text(`Bayar: ${data.paymentMethod}\n`));
  if (data.amountTenderedInCents != null && data.amountTenderedInCents > 0) {
    chunks.push(
      text(padLine('Tunai', formatIdrEscPos(data.amountTenderedInCents), width) + '\n'),
    );
    chunks.push(
      text(padLine('Kembali', formatIdrEscPos(data.changeInCents ?? 0), width) + '\n'),
    );
  }
  chunks.push(align('center'));
  chunks.push(text('Terima kasih\n'));
  chunks.push(feed(3));
  chunks.push(cut());

  return concat(...chunks);
}

/** Build Z-Report / shift closing slip. */
export function buildZReportReceipt(input: {
  storeName: string;
  cashierName: string;
  shiftId: string;
  clockInAt: string;
  clockOutAt: string | null;
  saleCount: number;
  cashInCents: number;
  cardInCents: number;
  qrisInCents: number;
  grossInCents: number;
  openingFloatInCents: number;
  expectedCashInCents: number;
  countedCashInCents: number;
  discrepancyInCents: number;
  width?: number;
  /** Default Z-REPORT; pass X-REPORT for mid-shift. */
  title?: string;
}): Uint8Array {
  const width = input.width ?? 32;
  const title = input.title ?? 'Z-REPORT';
  const chunks: Uint8Array[] = [
    init(),
    align('center'),
    bold(true),
    text(`${title}\n`),
    bold(false),
    text(`${input.storeName}\n`),
    align('left'),
    text(rule(width) + '\n'),
    text(`Kasir: ${input.cashierName}\n`),
    text(`Shift: ${input.shiftId.slice(0, 8)}\n`),
    text(`In: ${new Date(input.clockInAt).toLocaleString('id-ID')}\n`),
    text(
      `Out: ${
        input.clockOutAt
          ? new Date(input.clockOutAt).toLocaleString('id-ID')
          : '-'
      }\n`,
    ),
    text(rule(width) + '\n'),
    text(padLine('Trx', String(input.saleCount), width) + '\n'),
    text(padLine('Tunai', formatIdrEscPos(input.cashInCents), width) + '\n'),
    text(padLine('Kartu', formatIdrEscPos(input.cardInCents), width) + '\n'),
    text(padLine('QRIS', formatIdrEscPos(input.qrisInCents), width) + '\n'),
    text(padLine('Gross', formatIdrEscPos(input.grossInCents), width) + '\n'),
    text(rule(width) + '\n'),
    text(padLine('Modal', formatIdrEscPos(input.openingFloatInCents), width) + '\n'),
    text(padLine('Expected', formatIdrEscPos(input.expectedCashInCents), width) + '\n'),
    text(padLine('Counted', formatIdrEscPos(input.countedCashInCents), width) + '\n'),
    bold(true),
    text(padLine('Selisih', formatIdrEscPos(input.discrepancyInCents), width) + '\n'),
    bold(false),
    feed(3),
    cut(),
  ];
  return concat(...chunks);
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function writeSerial(bytes: Uint8Array, promptIfNeeded: boolean): Promise<boolean> {
  const serial = (navigator as Navigator & { serial?: SerialNav }).serial;
  if (!serial) {
    return false;
  }
  let ports = await serial.getPorts();
  let port = ports[0];
  if (!port && promptIfNeeded) {
    port = await serial.requestPort();
  }
  if (!port) {
    return false;
  }
  // Opening a locked/busy port can hang — bound the wait so UI never freezes.
  const openTimeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error('Serial open timeout')), 2000);
  });
  await Promise.race([port.open({ baudRate: 9600 }), openTimeout]);
  try {
    const writer = port.writable?.getWriter();
    if (!writer) {
      throw new Error('Serial port has no writable stream');
    }
    await writer.write(bytes);
    writer.releaseLock();
  } finally {
    await port.close().catch(() => undefined);
  }
  return true;
}

async function writeUsb(bytes: Uint8Array, promptIfNeeded: boolean): Promise<boolean> {
  const usb = (navigator as Navigator & { usb?: UsbNav }).usb;
  if (!usb) {
    return false;
  }
  let devices = await usb.getDevices();
  let device = devices[0];
  if (!device && promptIfNeeded) {
    // Printer class (0x07) is common for ESC/POS USB printers.
    device = await usb.requestDevice({ filters: [{ classCode: 0x07 }, {}] });
  }
  if (!device) {
    return false;
  }
  if (!device.opened) {
    await device.open();
  }
  if (!device.configuration) {
    await device.selectConfiguration(1);
  }
  const iface = device.configuration?.interfaces[0]?.interfaceNumber ?? 0;
  await device.claimInterface(iface);
  try {
    // Endpoint 1 OUT is the usual bulk pipe on cheap ESC/POS printers.
    // Copy into a fresh ArrayBuffer-backed view for WebUSB typings.
    await device.transferOut(1, new Uint8Array(bytes));
  } finally {
    await device.releaseInterface(iface).catch(() => undefined);
    await device.close().catch(() => undefined);
  }
  return true;
}

/**
 * Best-effort print: Web Serial → WebUSB → LAN (via API) → hex preview.
 * Pass `{ prompt: true }` (user gesture) to request a new device when none paired.
 * Pass `{ preferNetwork: true }` to try LAN first when configured.
 */
export async function sendToThermalPrinter(
  bytes: Uint8Array,
  options?: { prompt?: boolean; preferNetwork?: boolean },
): Promise<PrintResult> {
  const hex = bytesToHex(bytes);
  const prompt = options?.prompt === true;
  const preferNetwork = options?.preferNetwork === true;
  const network = getNetworkPrinterConfig();

  const tryNetwork = async (): Promise<PrintResult | null> => {
    if (!network?.enabled || !network.host) return null;
    try {
      await writeNetwork(bytes, network);
      return { ok: true, method: 'network', hex };
    } catch (error) {
      console.warn('Network print failed', error);
      return null;
    }
  };

  if (preferNetwork) {
    const net = await tryNetwork();
    if (net) return net;
  }

  try {
    if (await writeSerial(bytes, prompt)) {
      return { ok: true, method: 'webserial', hex };
    }
  } catch (error) {
    if (prompt) {
      console.warn('Web Serial print failed', error);
    }
  }

  try {
    if (await writeUsb(bytes, prompt)) {
      return { ok: true, method: 'webusb', hex };
    }
  } catch (error) {
    if (prompt) {
      console.warn('WebUSB print failed', error);
    }
  }

  if (!preferNetwork) {
    const net = await tryNetwork();
    if (net) return net;
  }

  return { ok: false, method: 'preview', hex };
}

async function writeNetwork(bytes: Uint8Array, config: NetworkPrinterConfig): Promise<void> {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const dataBase64 = btoa(binary);
  await printNetworkRaw(config.host, dataBase64, config.port);
}

export function getNetworkPrinterConfig(): NetworkPrinterConfig | null {
  try {
    const raw = localStorage.getItem(NETWORK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NetworkPrinterConfig>;
    const host = typeof parsed.host === 'string' ? parsed.host.trim() : '';
    const port =
      typeof parsed.port === 'number' && Number.isInteger(parsed.port) ? parsed.port : 9100;
    if (!host) return null;
    return {
      enabled: parsed.enabled !== false,
      host,
      port: port >= 1 && port <= 65535 ? port : 9100,
    };
  } catch {
    return null;
  }
}

export function setNetworkPrinterConfig(config: NetworkPrinterConfig | null): void {
  if (!config || !config.host.trim()) {
    localStorage.removeItem(NETWORK_STORAGE_KEY);
    return;
  }
  localStorage.setItem(
    NETWORK_STORAGE_KEY,
    JSON.stringify({
      enabled: config.enabled !== false,
      host: config.host.trim(),
      port: config.port || 9100,
    } satisfies NetworkPrinterConfig),
  );
}

/** Detect already-granted Serial/USB devices without prompting. */
export async function probeBrowserPrinterPresence(): Promise<{
  serial: boolean;
  usb: boolean;
}> {
  let serial = false;
  let usb = false;
  try {
    const nav = navigator as Navigator & { serial?: SerialNav };
    if (nav.serial?.getPorts) {
      const ports = await nav.serial.getPorts();
      serial = ports.length > 0;
    }
  } catch {
    /* ignore */
  }
  try {
    const usbNav = (navigator as Navigator & { usb?: UsbNav }).usb;
    if (usbNav?.getDevices) {
      const devices = await usbNav.getDevices();
      usb = devices.length > 0;
    }
  } catch {
    /* ignore */
  }
  return { serial, usb };
}

/** User-gesture helper to pair a printer (Serial preferred). */
export async function pairThermalPrinter(): Promise<PrintResult> {
  const test = concat(init(), text('BonPOS printer OK\n'), feed(2), cut());
  return sendToThermalPrinter(test, { prompt: true });
}

/** Test LAN printer via API bridge (no browser USB prompt). */
export async function testNetworkPrinter(
  host: string,
  port = 9100,
): Promise<PrintResult> {
  const test = concat(init(), text('BonPOS LAN printer OK\n'), feed(2), cut());
  const hex = bytesToHex(test);
  try {
    await writeNetwork(test, { enabled: true, host, port });
    return { ok: true, method: 'network', hex };
  } catch (error) {
    return {
      ok: false,
      method: 'preview',
      hex,
      error: error instanceof Error ? error.message : 'Network print failed',
    };
  }
}
