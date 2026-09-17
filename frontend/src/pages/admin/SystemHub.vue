<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import UiPanel from '../../components/UiPanel.vue';
import { useAdminHubTab } from '../../composables/useAdminHubTab';
import { useI18n } from '../../i18n';
import { formatIdrFromCents } from '../../lib/money';
import type { AdminShellApi } from './AdminShell.vue';
import {
  activateGlAccount,
  createGlAccount,
  deactivateGlAccount,
  fetchAuditLogs,
  fetchGlAccounts,
  fetchJournalEntries,
  fetchTenantBranding,
  updateGlAccount,
  updateTenantBranding,
  type AuditLogRow,
  type GlAccount,
  type GlAccountType,
  type JournalEntry,
} from '../../services/admin-api.service';
import { fetchEdgeSyncStatus, pushEdgeSync } from '../../services/edge-sync-api.service';
import { useAuthStore } from '../../stores/auth.store';
import { useToastStore } from '../../stores/toast.store';

type SubTab = 'gl' | 'edge' | 'audit' | 'branding';

const GL_TYPES: GlAccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();
const shell = inject<AdminShellApi>('adminShell')!;

const canFinance = computed(() => auth.has('admin.finance.read'));
const canFinanceWrite = computed(() => auth.has('admin.finance.write'));
const canBranding = computed(() => auth.has('admin.outlet.write'));
const busy = computed(() => shell.busy.value);

const visibleTabs = computed(() => {
  const tabs: SubTab[] = [];
  if (canFinance.value) tabs.push('gl', 'audit');
  if (canBranding.value) tabs.push('branding');
  tabs.push('edge');
  return tabs;
});

const { tab } = useAdminHubTab<SubTab>(['gl', 'edge', 'audit', 'branding'] as const, 'edge');

const glAccounts = ref<GlAccount[]>([]);
const journalEntries = ref<JournalEntry[]>([]);
const audit = ref<AuditLogRow[]>([]);
const showInactive = ref(false);
const editingId = ref<string | null>(null);
const formCode = ref('');
const formName = ref('');
const formType = ref<GlAccountType>('ASSET');
const formBusy = ref(false);

const brandName = ref('');
const logoUrl = ref('');
const accentColor = ref('#0f766e');
const brandBusy = ref(false);
const logoPreviewBroken = ref(false);

const edgeStatus = ref<{
  enabled: boolean;
  featureFlag: boolean;
  pending: number;
  delivered: number;
  hubUrl: string | null;
  lastCursor: string | null;
} | null>(null);

const sortedAccounts = computed(() =>
  [...glAccounts.value].sort((a, b) => a.code.localeCompare(b.code)),
);

onMounted(() => {
  void refresh();
  window.addEventListener('admin:reload', onReload);
});
onUnmounted(() => window.removeEventListener('admin:reload', onReload));
function onReload(): void {
  void refresh();
}

async function refresh(): Promise<void> {
  shell.setBusy(true);
  shell.setError(null);
  try {
    edgeStatus.value = await fetchEdgeSyncStatus().catch(() => null);
    if (canBranding.value) {
      const branding = await fetchTenantBranding().catch(() => null);
      if (branding) {
        brandName.value = branding.brandName || '';
        logoUrl.value = branding.logoUrl || '';
        accentColor.value = branding.accentColor || '#0f766e';
        logoPreviewBroken.value = false;
      }
    }
    if (canFinance.value) {
      const [glAcc, glEnt, logs] = await Promise.all([
        fetchGlAccounts(true).catch(() => [] as GlAccount[]),
        fetchJournalEntries(40).catch(() => [] as JournalEntry[]),
        fetchAuditLogs(40),
      ]);
      glAccounts.value = glAcc;
      journalEntries.value = glEnt;
      audit.value = logs;
    }
    if (visibleTabs.value.length && !visibleTabs.value.includes(tab.value)) {
      tab.value = visibleTabs.value[0]!;
    }
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

function resetForm(): void {
  editingId.value = null;
  formCode.value = '';
  formName.value = '';
  formType.value = 'ASSET';
}

function startCreate(): void {
  resetForm();
}

function startEdit(account: GlAccount): void {
  editingId.value = account.id;
  formCode.value = account.code;
  formName.value = account.name;
  formType.value = (account.type as GlAccountType) || 'ASSET';
}

async function saveAccount(): Promise<void> {
  if (!canFinanceWrite.value) return;
  formBusy.value = true;
  shell.setError(null);
  try {
    if (editingId.value) {
      await updateGlAccount(editingId.value, {
        code: formCode.value,
        name: formName.value,
        type: formType.value,
      });
      toast.success(t('admin.gl.saved'));
    } else {
      await createGlAccount({
        code: formCode.value,
        name: formName.value,
        type: formType.value,
      });
      toast.success(t('admin.gl.created'));
    }
    resetForm();
    glAccounts.value = await fetchGlAccounts(true);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    formBusy.value = false;
  }
}

async function toggleActive(account: GlAccount): Promise<void> {
  if (!canFinanceWrite.value) return;
  formBusy.value = true;
  try {
    if (account.isActive === false) {
      await activateGlAccount(account.id);
      toast.success(t('admin.gl.activated'));
    } else {
      await deactivateGlAccount(account.id);
      toast.success(t('admin.gl.deactivated'));
    }
    glAccounts.value = await fetchGlAccounts(true);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    formBusy.value = false;
  }
}

async function runEdgePush(): Promise<void> {
  shell.setBusy(true);
  try {
    const result = await pushEdgeSync();
    toast.success(
      t('admin.edge.pushOk'),
      result.dryRun
        ? `dry-run ${result.pushed}`
        : `pushed ${result.pushed}${result.error ? ` · ${result.error}` : ''}`,
    );
    edgeStatus.value = await fetchEdgeSyncStatus();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveBranding(): Promise<void> {
  if (!canBranding.value) return;
  brandBusy.value = true;
  shell.setError(null);
  try {
    const saved = await updateTenantBranding({
      brandName: brandName.value.trim() || null,
      logoUrl: logoUrl.value.trim() || null,
      accentColor: accentColor.value.trim() || null,
    });
    brandName.value = saved.brandName;
    logoUrl.value = saved.logoUrl || '';
    accentColor.value = saved.accentColor || '#0f766e';
    logoPreviewBroken.value = false;
    toast.success(t('admin.branding.saved'));
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    brandBusy.value = false;
  }
}

function visibleAccounts(): GlAccount[] {
  if (showInactive.value) return sortedAccounts.value;
  return sortedAccounts.value.filter((a) => a.isActive !== false);
}
</script>

<template>
  <div>
    <div class="mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
      <button
        v-for="key in visibleTabs"
        :key="key"
        type="button"
        class="admin-sub-tab shrink-0"
        :class="tab === key ? 'bg-teal-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'"
        @click="tab = key"
      >
        {{ t(`admin.tabs.${key}`) }}
      </button>
    </div>

    <UiPanel v-if="tab === 'gl' && canFinance" dense :title="t('admin.tabs.gl')">
      <p class="mb-3 text-sm text-slate-600">{{ t('admin.gl.hint') }}</p>

      <!-- COA form -->
      <div
        v-if="canFinanceWrite"
        class="mb-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <p class="text-sm font-semibold text-slate-800">
            {{ editingId ? t('admin.gl.editAccount') : t('admin.gl.newAccount') }}
          </p>
          <button
            v-if="editingId"
            type="button"
            class="text-xs font-semibold text-slate-600 underline"
            @click="startCreate"
          >
            {{ t('admin.gl.cancelEdit') }}
          </button>
        </div>
        <div class="grid gap-2 sm:grid-cols-4">
          <label class="block text-xs font-medium text-slate-600 sm:col-span-1">
            {{ t('admin.gl.code') }}
            <input
              v-model="formCode"
              class="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-2 font-mono text-sm uppercase"
              maxlength="16"
              autocomplete="off"
            />
          </label>
          <label class="block text-xs font-medium text-slate-600 sm:col-span-2">
            {{ t('admin.gl.name') }}
            <input
              v-model="formName"
              class="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-2 text-sm"
              maxlength="120"
            />
          </label>
          <label class="block text-xs font-medium text-slate-600">
            {{ t('admin.gl.type') }}
            <select
              v-model="formType"
              class="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
            >
              <option v-for="ty in GL_TYPES" :key="ty" :value="ty">{{ ty }}</option>
            </select>
          </label>
        </div>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            class="min-h-10 rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-40"
            :disabled="formBusy || busy || !formCode.trim() || !formName.trim()"
            @click="saveAccount"
          >
            {{ editingId ? t('common.save') : t('admin.gl.add') }}
          </button>
        </div>
      </div>
      <p v-else class="mb-3 text-xs text-slate-500">{{ t('admin.gl.readOnly') }}</p>

      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-slate-800">{{ t('admin.gl.coaTitle') }}</h3>
        <label class="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input v-model="showInactive" type="checkbox" class="h-4 w-4" />
          {{ t('admin.gl.showInactive') }}
        </label>
      </div>

      <div class="mb-2 overflow-x-auto rounded-xl ring-1 ring-slate-200">
        <table class="min-w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('admin.gl.code') }}</th>
              <th class="px-3 py-2">{{ t('admin.gl.name') }}</th>
              <th class="px-3 py-2">{{ t('admin.gl.type') }}</th>
              <th class="px-3 py-2">{{ t('admin.gl.status') }}</th>
              <th v-if="canFinanceWrite" class="px-3 py-2 text-right">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in visibleAccounts()"
              :key="a.id"
              class="border-b border-slate-100 last:border-0"
              :class="a.isActive === false ? 'bg-slate-50 text-slate-400' : ''"
            >
              <td class="px-3 py-1.5 font-mono text-xs font-semibold tabular-nums">{{ a.code }}</td>
              <td class="px-3 py-1.5">{{ a.name }}</td>
              <td class="px-3 py-1.5 text-xs text-slate-500">{{ a.type }}</td>
              <td class="px-3 py-1.5 text-xs">
                {{ a.isActive === false ? t('admin.gl.inactive') : t('admin.gl.active') }}
              </td>
              <td v-if="canFinanceWrite" class="px-3 py-1.5 text-right">
                <button
                  type="button"
                  class="mr-2 text-xs font-semibold text-teal-800 underline"
                  :disabled="formBusy"
                  @click="startEdit(a)"
                >
                  {{ t('common.edit') }}
                </button>
                <button
                  type="button"
                  class="text-xs font-semibold underline"
                  :class="a.isActive === false ? 'text-emerald-700' : 'text-amber-800'"
                  :disabled="formBusy"
                  @click="toggleActive(a)"
                >
                  {{ a.isActive === false ? t('admin.gl.activate') : t('admin.gl.deactivate') }}
                </button>
              </td>
            </tr>
            <tr v-if="!visibleAccounts().length">
              <td colspan="5" class="px-3 py-4 text-sm text-slate-500">
                {{ t('admin.gl.emptyAccounts') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 class="mb-2 text-sm font-semibold text-slate-800">{{ t('admin.gl.entriesTitle') }}</h3>
      <ul class="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
        <li
          v-for="e in journalEntries"
          :key="e.id"
          class="bg-white px-3 py-2 text-sm"
        >
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span class="font-semibold text-slate-900">{{ e.sourceType }}</span>
            <span class="font-mono text-xs text-slate-500">{{ e.sourceId.slice(0, 8) }}</span>
            <span class="text-xs text-slate-400">{{ new Date(e.postedAt).toLocaleString() }}</span>
          </div>
          <ul class="mt-1 space-y-0.5 font-mono text-[11px] leading-snug text-slate-600 sm:text-xs">
            <li v-for="(l, i) in e.lines" :key="i" class="flex flex-wrap gap-x-2">
              <span class="w-12 shrink-0 font-semibold tabular-nums">{{ l.accountCode }}</span>
              <span class="tabular-nums text-slate-800">
                D {{ formatIdrFromCents(l.debitInCents) }}
              </span>
              <span class="tabular-nums text-slate-800">
                C {{ formatIdrFromCents(l.creditInCents) }}
              </span>
              <span v-if="l.memo" class="text-slate-400">{{ l.memo }}</span>
            </li>
          </ul>
        </li>
        <li v-if="!journalEntries.length" class="px-3 py-4 text-sm text-slate-500">
          {{ t('admin.gl.emptyEntries') }}
        </li>
      </ul>
    </UiPanel>

    <UiPanel v-else-if="tab === 'audit' && canFinance" dense :title="t('admin.tabs.audit')" :padded="false">
      <div class="overflow-x-auto">
        <table class="min-w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th class="px-2.5 py-1.5 font-medium">{{ t('admin.time') }}</th>
              <th class="px-2.5 py-1.5 font-medium">{{ t('admin.action') }}</th>
              <th class="px-2.5 py-1.5 font-medium">{{ t('admin.actor') }}</th>
              <th class="px-2.5 py-1.5 font-medium">{{ t('admin.reason') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in audit" :key="row.id" class="border-b border-slate-100 last:border-0">
              <td class="px-2.5 py-1.5 tabular-nums text-slate-600">
                {{ new Date(row.createdAt).toLocaleString() }}
              </td>
              <td class="px-2.5 py-1.5 font-medium">{{ row.action }}</td>
              <td class="px-2.5 py-1.5">{{ row.actor?.displayName || t('common.empty') }}</td>
              <td class="px-2.5 py-1.5 text-slate-600">
                {{ row.reason || t('common.empty') }}
                <span v-if="row.amountInCents != null" class="ml-1 tabular-nums">
                  · {{ formatIdrFromCents(row.amountInCents) }}
                </span>
              </td>
            </tr>
            <tr v-if="!audit.length">
              <td colspan="4" class="px-4 py-6 text-slate-500">{{ t('admin.emptyAudit') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiPanel>

    <UiPanel v-else-if="tab === 'branding' && canBranding" dense :title="t('admin.tabs.branding')">
      <p class="mb-3 text-sm text-slate-600">{{ t('admin.branding.hint') }}</p>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block text-xs font-medium text-slate-600 sm:col-span-2">
          {{ t('admin.branding.brandName') }}
          <input
            v-model="brandName"
            class="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-2 text-sm"
            maxlength="80"
            autocomplete="organization"
          />
        </label>
        <label class="block text-xs font-medium text-slate-600 sm:col-span-2">
          {{ t('admin.branding.logoUrl') }}
          <input
            v-model="logoUrl"
            class="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-2 font-mono text-xs"
            maxlength="500"
            placeholder="https://cdn.example.com/logo.png"
            @input="logoPreviewBroken = false"
          />
        </label>
        <label class="block text-xs font-medium text-slate-600">
          {{ t('admin.branding.accentColor') }}
          <div class="mt-1 flex items-center gap-2">
            <input
              v-model="accentColor"
              type="color"
              class="h-10 w-12 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
            />
            <input
              v-model="accentColor"
              class="min-h-10 flex-1 rounded-lg border border-slate-300 px-2 font-mono text-sm uppercase"
              maxlength="7"
              placeholder="#0f766e"
            />
          </div>
        </label>
        <div class="flex items-end">
          <div
            class="flex min-h-10 w-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2"
          >
            <img
              v-if="logoUrl.trim() && !logoPreviewBroken"
              :src="logoUrl.trim()"
              alt=""
              class="max-h-12 max-w-full object-contain"
              @error="logoPreviewBroken = true"
            />
            <span v-else class="text-sm font-semibold tracking-tight text-slate-700">
              {{ brandName || t('app.name') }}
            </span>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="mt-3 min-h-10 rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-40"
        :disabled="brandBusy || busy"
        @click="saveBranding"
      >
        {{ t('common.save') }}
      </button>
    </UiPanel>

    <UiPanel v-else-if="tab === 'edge'" dense :title="t('admin.tabs.edge')">
      <template v-if="edgeStatus">
        <dl class="grid gap-2 text-sm sm:grid-cols-2">
          <div class="rounded-xl bg-slate-50 px-3 py-2">
            <dt class="text-xs text-slate-500">{{ t('admin.edge.enabled') }}</dt>
            <dd class="font-semibold">{{ edgeStatus.enabled ? 'yes' : 'no' }}</dd>
          </div>
          <div class="rounded-xl bg-slate-50 px-3 py-2">
            <dt class="text-xs text-slate-500">{{ t('admin.edge.pending') }}</dt>
            <dd class="font-semibold tabular-nums">{{ edgeStatus.pending }}</dd>
          </div>
          <div class="rounded-xl bg-slate-50 px-3 py-2">
            <dt class="text-xs text-slate-500">{{ t('admin.edge.delivered') }}</dt>
            <dd class="font-semibold tabular-nums">{{ edgeStatus.delivered }}</dd>
          </div>
          <div class="rounded-xl bg-slate-50 px-3 py-2">
            <dt class="text-xs text-slate-500">{{ t('admin.edge.hub') }}</dt>
            <dd class="truncate font-mono text-xs">{{ edgeStatus.hubUrl || '—' }}</dd>
          </div>
        </dl>
        <button
          type="button"
          class="mt-3 min-h-9 rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-40"
          :disabled="busy"
          @click="runEdgePush"
        >
          {{ t('admin.edge.push') }}
        </button>
      </template>
      <p v-else class="text-sm text-slate-500">{{ t('admin.edge.unavailable') }}</p>
    </UiPanel>
  </div>
</template>
