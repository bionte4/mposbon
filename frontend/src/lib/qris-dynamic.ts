/**
 * QRIS MPM helpers — convert static merchant QR → dynamic (amount embedded).
 * Follows EMVCo TLV + Bank Indonesia practice used by Odoo-style POS:
 * tag 01: 11→12, tag 54: amount (IDR whole rupiah), tag 63: CRC-16/CCITT-FALSE.
 *
 * Money: amounts are integer smallest units; for IDR that is whole rupiah (no float).
 */

export type QrisTlv = { tag: string; value: string };

export class QrisPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrisPayloadError';
  }
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF). */
export function crc16CcittFalse(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function parseQrisTlv(payload: string): QrisTlv[] {
  const clean = payload.trim();
  if (clean.length < 8) {
    throw new QrisPayloadError('QRIS payload too short');
  }
  const out: QrisTlv[] = [];
  let i = 0;
  while (i + 4 <= clean.length) {
    const tag = clean.slice(i, i + 2);
    const lenStr = clean.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(lenStr)) {
      throw new QrisPayloadError(`Invalid TLV length at index ${i}`);
    }
    const len = Number.parseInt(lenStr, 10);
    const value = clean.slice(i + 4, i + 4 + len);
    if (value.length !== len) {
      throw new QrisPayloadError('Truncated QRIS TLV payload');
    }
    out.push({ tag, value });
    i += 4 + len;
    if (tag === '63') {
      break;
    }
  }
  if (!out.some((t) => t.tag === '00')) {
    throw new QrisPayloadError('Missing QRIS payload format indicator (tag 00)');
  }
  return out;
}

function encodeTlv(tag: string, value: string): string {
  if (!/^\d{2}$/.test(tag)) {
    throw new QrisPayloadError(`Invalid tag ${tag}`);
  }
  if (value.length > 99) {
    throw new QrisPayloadError(`TLV value too long for tag ${tag}`);
  }
  return `${tag}${String(value.length).padStart(2, '0')}${value}`;
}

function serializeWithoutCrc(tags: QrisTlv[]): string {
  return tags
    .filter((t) => t.tag !== '63')
    .map((t) => encodeTlv(t.tag, t.value))
    .join('');
}

export function verifyQrisCrc(payload: string): boolean {
  try {
    const tags = parseQrisTlv(payload);
    const crc = tags.find((t) => t.tag === '63')?.value;
    if (!crc || crc.length !== 4) return false;
    const body = serializeWithoutCrc(tags) + '6304';
    return crc16CcittFalse(body) === crc.toUpperCase();
  } catch {
    return false;
  }
}

/**
 * Build a per-transaction dynamic QRIS string from a store's static MPM payload.
 * @param staticPayload EMVCo string from bank/PSP (tag 01 = 11)
 * @param amountInCents IDR integer rupiah (project money unit)
 * @param billNumber optional additional data (tag 62 / 01) for reconciliation
 */
export function buildDynamicQrisPayload(
  staticPayload: string,
  amountInCents: number,
  billNumber?: string | null,
): string {
  if (!Number.isInteger(amountInCents) || amountInCents < 1) {
    throw new QrisPayloadError('QRIS amount must be an integer >= 1');
  }
  if (String(amountInCents).length > 13) {
    throw new QrisPayloadError('QRIS amount exceeds 13 digits');
  }

  const tags = parseQrisTlv(staticPayload);
  const country = tags.find((t) => t.tag === '58')?.value;
  if (country && country !== 'ID') {
    throw new QrisPayloadError('QRIS country code must be ID');
  }

  // Drop amount / tip / CRC; rebuild with dynamic POI + amount.
  const next: QrisTlv[] = [];
  for (const t of tags) {
    if (t.tag === '54' || t.tag === '55' || t.tag === '56' || t.tag === '57' || t.tag === '63') {
      continue;
    }
    if (t.tag === '01') {
      next.push({ tag: '01', value: '12' });
      continue;
    }
    if (t.tag === '62' && billNumber?.trim()) {
      // Replace additional data when we inject our bill ref below.
      continue;
    }
    next.push(t);
  }

  if (!next.some((t) => t.tag === '01')) {
    // Some payloads omit explicit tag 01 in odd exports — insert after tag 00.
    const idx00 = next.findIndex((t) => t.tag === '00');
    next.splice(idx00 >= 0 ? idx00 + 1 : 0, 0, { tag: '01', value: '12' });
  }

  const amountTag: QrisTlv = { tag: '54', value: String(amountInCents) };
  const currencyIdx = next.findIndex((t) => t.tag === '53');
  if (currencyIdx >= 0) {
    next.splice(currencyIdx + 1, 0, amountTag);
  } else {
    const countryIdx = next.findIndex((t) => t.tag === '58');
    next.splice(countryIdx >= 0 ? countryIdx : next.length, 0, amountTag);
  }

  const bill = billNumber?.trim();
  if (bill) {
    const truncated = bill.slice(0, 25);
    const additional = encodeTlv('01', truncated);
    const nameIdx = next.findIndex((t) => t.tag === '59');
    const insertAt = nameIdx >= 0 ? nameIdx : next.length;
    next.splice(insertAt, 0, { tag: '62', value: additional });
  }

  const body = serializeWithoutCrc(next) + '6304';
  const crc = crc16CcittFalse(body);
  return `${body}${crc}`;
}
