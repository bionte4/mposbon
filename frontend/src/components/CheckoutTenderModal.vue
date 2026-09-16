<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';
import type { PaymentMethod } from '../db/pos-types';

export type TenderPaymentLine = {
  paymentMethod: Exclude<PaymentMethod, 'SPLIT'>;
  amountInCents: number;
  amountTenderedInCents?: number;
};

const props = defineProps<{
  totalInCents: number;
}>();

const emit = defineEmits<{
  confirm: [
    payload: {
      paymentMethod: PaymentMethod;
      amountTenderedInCents?: number;
      tipInCents?: number;
      payments: TenderPaymentLine[];
    },
  ];
  cancel: [];
}>();

const { t } = useI18n();
const mode = ref<'single' | 'split'>('single');
const method = ref<Exclude<PaymentMethod, 'SPLIT'>>('CASH');
/** Cashier enters rupiah (whole units); we convert to sen/cents integer. */
const tenderedRupiah = ref(0);
const tipRupiah = ref(0);

/** Split: cash portion + secondary card/qris for remainder. */
const splitCashRupiah = ref(0);
const splitSecond = ref<'CARD' | 'QRIS'>('CARD');

watch(
  () => props.totalInCents,
  (total) => {
    tenderedRupiah.value = total + Math.max(0, Math.trunc(tipRupiah.value));
    splitCashRupiah.value = Math.floor(total / 2);
  },
  { immediate: true },
);

const tipInCents = computed(() => Math.max(0, Math.trunc(tipRupiah.value)));
const payableInCents = computed(() => props.totalInCents + tipInCents.value);
const amountTenderedInCents = computed(() => Math.max(0, Math.trunc(tenderedRupiah.value)));
const changeInCents = computed(() =>
  method.value === 'CASH' ? Math.max(0, amountTenderedInCents.value - payableInCents.value) : 0,
);
const cashShort = computed(
  () => method.value === 'CASH' && amountTenderedInCents.value < payableInCents.value,
);

const splitCashInCents = computed(() => Math.max(0, Math.trunc(splitCashRupiah.value)));
const splitSecondInCents = computed(() =>
  Math.max(0, payableInCents.value - splitCashInCents.value),
);
const splitInvalid = computed(
  () =>
    mode.value === 'split' &&
    (splitCashInCents.value < 1 ||
      splitSecondInCents.value < 1 ||
      splitCashInCents.value >= payableInCents.value),
);

const quickAmounts = computed(() => {
  const total = payableInCents.value;
  const rounds = [total];
  for (const step of [1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000]) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total && !rounds.includes(rounded)) {
      rounds.push(rounded);
    }
  }
  return rounds.slice(0, 6);
});

function confirm(): void {
  if (mode.value === 'split') {
    if (splitInvalid.value) return;
    emit('confirm', {
      paymentMethod: 'SPLIT',
      tipInCents: tipInCents.value || undefined,
      amountTenderedInCents: splitCashInCents.value,
      payments: [
        {
          paymentMethod: 'CASH',
          amountInCents: splitCashInCents.value,
          amountTenderedInCents: splitCashInCents.value,
        },
        {
          paymentMethod: splitSecond.value,
          amountInCents: splitSecondInCents.value,
        },
      ],
    });
    return;
  }
  if (cashShort.value) return;
  emit('confirm', {
    paymentMethod: method.value,
    tipInCents: tipInCents.value || undefined,
    amountTenderedInCents:
      method.value === 'CASH' ? amountTenderedInCents.value : undefined,
    payments: [
      {
        paymentMethod: method.value,
        amountInCents: payableInCents.value,
        amountTenderedInCents:
          method.value === 'CASH' ? amountTenderedInCents.value : undefined,
      },
    ],
  });
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      @click.self="emit('cancel')"
    >
      <div
        class="max-h-[min(92dvh,40rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-xl"
      >
        <h2 class="text-xl font-semibold text-slate-900">{{ t('pos.checkout.title') }}</h2>
        <p class="mt-1 text-sm text-slate-500">{{ t('pos.checkout.subtitle') }}</p>

        <div class="mt-4 flex items-baseline justify-between rounded-2xl bg-slate-50 px-4 py-3">
          <span class="text-sm font-medium text-slate-600">{{ t('pos.total') }}</span>
          <span class="text-2xl font-bold tabular-nums">{{ formatIdrFromCents(totalInCents) }}</span>
        </div>

        <label class="mt-3 block text-sm font-medium text-slate-600">
          {{ t('pos.checkout.tip') }}
          <input
            v-model.number="tipRupiah"
            class="mt-1 min-h-12 w-full rounded-2xl border border-slate-300 px-3 text-lg tabular-nums"
            type="number"
            step="1"
            min="0"
            inputmode="numeric"
            @change="tenderedRupiah = payableInCents"
          />
        </label>
        <p v-if="tipInCents" class="mt-1 text-sm text-slate-600">
          {{ t('pos.checkout.payable') }}:
          <strong class="tabular-nums">{{ formatIdrFromCents(payableInCents) }}</strong>
        </p>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            class="touch-target rounded-2xl text-base font-semibold"
            :class="mode === 'single' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800'"
            @click="mode = 'single'"
          >
            {{ t('pos.checkout.singlePay') }}
          </button>
          <button
            type="button"
            class="touch-target rounded-2xl text-base font-semibold"
            :class="mode === 'split' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800'"
            @click="mode = 'split'"
          >
            {{ t('pos.checkout.splitPay') }}
          </button>
        </div>

        <template v-if="mode === 'single'">
          <div class="mt-4 grid grid-cols-3 gap-2">
            <button
              v-for="m in (['CASH', 'CARD', 'QRIS'] as const)"
              :key="m"
              type="button"
              class="touch-target rounded-2xl text-base font-semibold"
              :class="method === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800'"
              @click="method = m"
            >
              {{ t(`pos.checkout.methods.${m}`) }}
            </button>
          </div>

          <div v-if="method === 'CASH'" class="mt-4 space-y-3">
            <label class="block text-sm font-medium text-slate-600">
              {{ t('pos.checkout.tendered') }}
              <input
                v-model.number="tenderedRupiah"
                class="mt-1 min-h-14 w-full rounded-2xl border border-slate-300 px-3 text-lg tabular-nums"
                type="number"
                step="1"
                min="0"
                inputmode="numeric"
              />
            </label>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="amt in quickAmounts"
                :key="amt"
                type="button"
                class="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold tabular-nums"
                @click="tenderedRupiah = amt"
              >
                {{ formatIdrFromCents(amt) }}
              </button>
            </div>
            <div class="flex justify-between text-base font-semibold">
              <span>{{ t('pos.checkout.change') }}</span>
              <span
                class="tabular-nums"
                :class="cashShort ? 'text-red-700' : 'text-emerald-700'"
              >
                {{ formatIdrFromCents(changeInCents) }}
              </span>
            </div>
            <p v-if="cashShort" class="text-sm text-red-700">{{ t('pos.checkout.short') }}</p>
          </div>

          <p v-else class="mt-4 text-sm text-slate-600">
            {{ t(`pos.checkout.hint.${method}`) }}
          </p>
        </template>

        <div v-else class="mt-4 space-y-3">
          <p class="text-sm text-slate-600">{{ t('pos.checkout.splitHint') }}</p>
          <label class="block text-sm font-medium text-slate-600">
            {{ t('pos.checkout.splitCash') }}
            <input
              v-model.number="splitCashRupiah"
              class="mt-1 min-h-14 w-full rounded-2xl border border-slate-300 px-3 text-lg tabular-nums"
              type="number"
              step="1"
              min="1"
              inputmode="numeric"
            />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="m in (['CARD', 'QRIS'] as const)"
              :key="m"
              type="button"
              class="touch-target rounded-2xl text-base font-semibold"
              :class="splitSecond === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800'"
              @click="splitSecond = m"
            >
              {{ t(`pos.checkout.methods.${m}`) }}
            </button>
          </div>
          <div class="rounded-2xl bg-slate-50 px-4 py-3 text-sm">
            <p class="flex justify-between">
              <span>{{ t('pos.checkout.methods.CASH') }}</span>
              <span class="tabular-nums font-semibold">{{ formatIdrFromCents(splitCashInCents) }}</span>
            </p>
            <p class="mt-1 flex justify-between">
              <span>{{ t(`pos.checkout.methods.${splitSecond}`) }}</span>
              <span class="tabular-nums font-semibold">{{
                formatIdrFromCents(splitSecondInCents)
              }}</span>
            </p>
          </div>
          <p v-if="splitInvalid" class="text-sm text-red-700">{{ t('pos.checkout.splitInvalid') }}</p>
        </div>

        <div class="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            class="touch-target rounded-2xl bg-slate-200 text-base font-semibold"
            @click="emit('cancel')"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="touch-target rounded-2xl bg-emerald-700 text-base font-semibold text-white disabled:opacity-40"
            :disabled="mode === 'single' ? cashShort : splitInvalid"
            @click="confirm"
          >
            {{ t('pos.checkout.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
