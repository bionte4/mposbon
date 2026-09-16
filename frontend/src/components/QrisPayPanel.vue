<script setup lang="ts">
/**
 * Shows merchant QRIS at checkout.
 * Static store payload is converted to dynamic MPM (amount embedded) — Odoo-style.
 * Cashier still confirms after customer pays (no bank webhook yet).
 */
import QRCode from 'qrcode';
import { computed, ref, watch } from 'vue';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';
import { buildDynamicQrisPayload, QrisPayloadError } from '../lib/qris-dynamic';

const props = defineProps<{
  payload: string | null | undefined;
  amountInCents: number;
  /** Optional bill / order ref embedded in tag 62 for reconciliation. */
  billNumber?: string | null;
}>();

const { t } = useI18n();
const dataUrl = ref<string | null>(null);
const error = ref<string | null>(null);
const dynamicPayload = ref<string | null>(null);

const hasSource = computed(() => Boolean(props.payload?.trim()));

async function render(): Promise<void> {
  dataUrl.value = null;
  error.value = null;
  dynamicPayload.value = null;
  const source = props.payload?.trim();
  if (!source) {
    return;
  }
  if (!Number.isInteger(props.amountInCents) || props.amountInCents < 1) {
    error.value = t('pos.checkout.qrisAmountInvalid');
    return;
  }
  try {
    const dyn = buildDynamicQrisPayload(source, props.amountInCents, props.billNumber);
    dynamicPayload.value = dyn;
    dataUrl.value = await QRCode.toDataURL(dyn, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 280,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
  } catch (err) {
    if (err instanceof QrisPayloadError) {
      error.value = err.message;
    } else {
      error.value = err instanceof Error ? err.message : t('pos.checkout.qrisRenderError');
    }
  }
}

watch(
  () => [props.payload, props.amountInCents, props.billNumber] as const,
  () => {
    void render();
  },
  { immediate: true },
);
</script>

<template>
  <div class="space-y-3 rounded-2xl bg-slate-50 px-4 py-4">
    <div class="text-center">
      <p class="text-sm font-medium text-slate-600">{{ t('pos.checkout.qrisAmount') }}</p>
      <p class="text-2xl font-bold tabular-nums text-slate-900">
        {{ formatIdrFromCents(amountInCents) }}
      </p>
      <p class="mt-1 text-xs font-medium text-emerald-800">{{ t('pos.checkout.qrisDynamicBadge') }}</p>
    </div>

    <div v-if="!hasSource" class="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-900">
      {{ t('pos.checkout.qrisMissing') }}
    </div>

    <div v-else-if="error" class="rounded-xl bg-red-50 px-3 py-3 text-sm text-red-800">
      {{ error }}
    </div>

    <div v-else class="flex flex-col items-center gap-2">
      <img
        v-if="dataUrl"
        :src="dataUrl"
        alt="QRIS"
        class="h-56 w-56 rounded-lg bg-white p-2 shadow-sm ring-1 ring-slate-200"
        width="224"
        height="224"
      />
      <p class="text-center text-sm text-slate-600">{{ t('pos.checkout.qrisScanHint') }}</p>
      <p v-if="billNumber" class="text-center text-[11px] text-slate-400">
        {{ t('pos.checkout.qrisBill', { bill: billNumber }) }}
      </p>
    </div>
  </div>
</template>
