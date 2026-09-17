import { apiPost } from '../api/client';

export type PrinterPingResult = { ok: true; latencyMs: number };
export type PrinterRawResult = { ok: true; bytes: number };

export function pingNetworkPrinter(host: string, port?: number): Promise<PrinterPingResult> {
  return apiPost<PrinterPingResult>('/pos/printer/ping', { host, port });
}

export function printNetworkRaw(
  host: string,
  dataBase64: string,
  port?: number,
): Promise<PrinterRawResult> {
  return apiPost<PrinterRawResult>('/pos/printer/raw', { host, port, dataBase64 });
}
