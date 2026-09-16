<script setup lang="ts">
/**
 * QRIS checkout: LOCAL dynamic MPM, or Midtrans/Xendit charge + poll/webhook.
 */
import QRCode from 'qrcode';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';
import { buildDynamicQrisPayload, QrisPayloadError } from '../lib/qris-dynamic';
import {
  confirmLocalQrisCharge,
  createQrisCharge,
  fetchPaymentProvider,
  refreshQrisCharge,
  type PaymentCharge,
} from '../services/payments-api.service';

const props = defineProps<{
  payload: string | null | undefined;
  amountInCents: number;
  billNumber?: string | null;
  storeId: string;
  clientUuid: string;
}>();

const emit = defineEmits<{
  paid: [chargeId: string];
}>();

const { t } = useI18n();
const dataUrl = ref<string | null>(null);
const error = ref<string | null>(null);
const provider = ref<PaymentCharge['provider']>('LOCAL_QRIS');
const charge = ref<PaymentCharge | null>(null);
const busy = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const hasSource = computed(() => Boolean(props.payload?.trim()) || provider.value !== 'LOCAL_QRIS');
const isPaid = computed(() => charge.value?.status === 'PAID');

async function stopPoll(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function renderFromString(qrString: string): Promise<void> {
  dataUrl.value = await QRCode.toDataURL(qrString, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

async function bootstrap(): Promise<void> {
  error.value = null;
  dataUrl.value = null;
  charge.value = null;
  await stopPoll();
  if (!Number.isInteger(props.amountInCents) || props.amountInCents < 1) {
    error.value = t('pos.checkout.qrisAmountInvalid');
    return;
  }

  busy.value = true;
  try {
    const info = await fetchPaymentProvider().catch(() => ({ provider: 'LOCAL_QRIS' as const }));
    provider.value = info.provider;

    let localQr: string | null = null;
    if (provider.value === 'LOCAL_QRIS') {
      const source = props.payload?.trim();
      if (!source) {
        error.value = t('pos.checkout.qrisMissing');
        return;
      }
      localQr = buildDynamicQrisPayload(source, props.amountInCents, props.billNumber);
    }

    const created = await createQrisCharge({
      storeId: props.storeId,
      clientUuid: props.clientUuid,
      amountInCents: props.amountInCents,
      localQrString: localQr,
      billNumber: props.billNumber,
    });
    charge.value = created;
    if (!created.qrString) {
      error.value = t('pos.checkout.qrisRenderError');
      return;
    }
    await renderFromString(created.qrString);

    if (provider.value !== 'LOCAL_QRIS') {
      pollTimer = setInterval(() => {
        void poll();
      }, 2500);
    }
  } catch (err) {
    if (err instanceof QrisPayloadError) {
      error.value = err.message;
    } else {
      error.value = err instanceof Error ? err.message : t('pos.checkout.qrisRenderError');
    }
  } finally {
    busy.value = false;
  }
}

async function poll(): Promise<void> {
  if (!charge.value || charge.value.status === 'PAID') return;
  try {
    const next = await refreshQrisCharge(charge.value.id);
    charge.value = next;
    if (next.status === 'PAID') {
      await stopPoll();
      emit('paid', next.id);
    }
  } catch {
    /* ignore transient poll errors */
  }
}

async function confirmLocal(): Promise<void> {
  if (!charge.value) return;
  busy.value = true;
  try {
    const next = await confirmLocalQrisCharge(charge.value.id);
    charge.value = next;
    if (next.status === 'PAID') emit('paid', next.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('pos.checkout.qrisRenderError');
  } finally {
    busy.value = false;
  }
}

watch(
  () => [props.payload, props.amountInCents, props.billNumber, props.clientUuid] as const,
  () => {
    void bootstrap();
  },
  { immediate: true },
);

onUnmounted(() => {
  void stopPoll();
});
</script>

<template>
  <div class="space-y-3 rounded-2xl bg-slate-50 px-4 py-4">
    <div class="text-center">
      <p class="text-sm font-medium text-slate-600">{{ t('pos.checkout.qrisAmount') }}</p>
      <p class="text-2xl font-bold tabular-nums text-slate-900">
        {{ formatIdrFromCents(amountInCents) }}
      </p>
      <p class="mt-1 text-xs font-medium text-emerald-800">
        {{
          provider === 'LOCAL_QRIS'
            ? t('pos.checkout.qrisDynamicBadge')
            : t('pos.checkout.qrisPspBadge', { provider })
        }}
      </p>
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
      <p v-if="isPaid" class="text-sm font-semibold text-emerald-700">
        {{ t('pos.checkout.qrisPaid') }}
      </p>
      <button
        v-if="provider === 'LOCAL_QRIS' && charge && !isPaid"
        type="button"
        class="touch-target mt-1 rounded-xl bg-emerald-600 px-4 font-semibold text-white"
        :disabled="busy"
        @click="confirmLocal"
      >
        {{ t('pos.checkout.qrisConfirmLocal') }}
      </button>
      <button
        v-else-if="provider !== 'LOCAL_QRIS' && charge && !isPaid"
        type="button"
        class="touch-target mt-1 rounded-xl bg-slate-900 px-4 font-semibold text-white"
        :disabled="busy"
        @click="poll"
      >
        {{ t('pos.checkout.qrisCheckStatus') }}
      </button>
    </div>
  </div>
</template>
