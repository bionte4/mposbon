<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import UiPanel from '../../components/UiPanel.vue';
import { useAdminHubTab } from '../../composables/useAdminHubTab';
import { useI18n } from '../../i18n';
import { formatIdrFromCents } from '../../lib/money';
import type { AdminShellApi } from './AdminShell.vue';
import {
  fetchAuditLogs,
  fetchGlAccounts,
  fetchJournalEntries,
  type AuditLogRow,
  type GlAccount,
  type JournalEntry,
} from '../../services/admin-api.service';
import { fetchEdgeSyncStatus, pushEdgeSync } from '../../services/edge-sync-api.service';
import { useAuthStore } from '../../stores/auth.store';
import { useToastStore } from '../../stores/toast.store';

type SubTab = 'gl' | 'edge' | 'audit';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();
const shell = inject<AdminShellApi>('adminShell')!;

const canFinance = computed(() => auth.has('admin.finance.read'));
const busy = computed(() => shell.busy.value);

const visibleTabs = computed(() => {
  const tabs: SubTab[] = [];
  if (canFinance.value) tabs.push('gl', 'audit');
  tabs.push('edge');
  return tabs;
});

const { tab } = useAdminHubTab<SubTab>(['gl', 'edge', 'audit'] as const, 'edge');

const glAccounts = ref<GlAccount[]>([]);
const journalEntries = ref<JournalEntry[]>([]);
const audit = ref<AuditLogRow[]>([]);
const edgeStatus = ref<{
  enabled: boolean;
  featureFlag: boolean;
  pending: number;
  delivered: number;
  hubUrl: string | null;
  lastCursor: string | null;
} | null>(null);

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
    if (canFinance.value) {
      const [glAcc, glEnt, logs] = await Promise.all([
        fetchGlAccounts().catch(() => [] as GlAccount[]),
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
</script>

<template>
  <div>
    <div class="mb-4 flex gap-2 overflow-x-auto pb-1">
      <button
        v-for="key in visibleTabs"
        :key="key"
        type="button"
        class="touch-target shrink-0 rounded-2xl px-4 text-sm font-semibold"
        :class="tab === key ? 'bg-teal-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'"
        @click="tab = key"
      >
        {{ t(`admin.tabs.${key}`) }}
      </button>
    </div>

    <UiPanel v-if="tab === 'gl' && canFinance" :title="t('admin.tabs.gl')">
      <p class="mb-3 text-sm text-slate-600">{{ t('admin.gl.hint') }}</p>
      <div class="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="a in glAccounts"
          :key="a.id"
          class="rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-100"
        >
          <span class="font-mono font-semibold">{{ a.code }}</span>
          · {{ a.name }}
          <span class="text-xs text-slate-500"> ({{ a.type }})</span>
        </div>
        <p v-if="!glAccounts.length" class="text-sm text-slate-500">{{ t('admin.gl.emptyAccounts') }}</p>
      </div>
      <ul class="space-y-2 text-sm">
        <li v-for="e in journalEntries" :key="e.id" class="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-100">
          <div class="font-semibold">
            {{ e.sourceType }} · {{ e.sourceId.slice(0, 8) }}
            <span class="text-xs font-normal text-slate-500">
              · {{ new Date(e.postedAt).toLocaleString() }}
            </span>
          </div>
          <ul class="mt-1 space-y-0.5 text-xs text-slate-600">
            <li v-for="(l, i) in e.lines" :key="i">
              {{ l.accountCode }}
              D {{ formatIdrFromCents(l.debitInCents) }}
              / C {{ formatIdrFromCents(l.creditInCents) }}
              <span v-if="l.memo"> — {{ l.memo }}</span>
            </li>
          </ul>
        </li>
        <li v-if="!journalEntries.length" class="text-slate-500">{{ t('admin.gl.emptyEntries') }}</li>
      </ul>
    </UiPanel>

    <UiPanel v-else-if="tab === 'audit' && canFinance" :title="t('admin.tabs.audit')" :padded="false">
      <div class="overflow-x-auto">
        <table class="min-w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th class="px-4 py-3 font-medium">{{ t('admin.time') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('admin.action') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('admin.actor') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('admin.reason') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in audit" :key="row.id" class="border-b border-slate-100 last:border-0">
              <td class="px-4 py-3 tabular-nums text-slate-600">
                {{ new Date(row.createdAt).toLocaleString() }}
              </td>
              <td class="px-4 py-3 font-medium">{{ row.action }}</td>
              <td class="px-4 py-3">{{ row.actor?.displayName || t('common.empty') }}</td>
              <td class="px-4 py-3 text-slate-600">
                {{ row.reason || t('common.empty') }}
                <span v-if="row.amountInCents != null" class="ml-1 tabular-nums">
                  · {{ formatIdrFromCents(row.amountInCents) }}
                </span>
              </td>
            </tr>
            <tr v-if="!audit.length">
              <td class="px-4 py-8 text-slate-500" colspan="4">{{ t('admin.emptyAudit') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiPanel>

    <UiPanel v-else :title="t('admin.tabs.edge')">
      <div v-if="edgeStatus" class="space-y-3 text-sm">
        <p>
          {{ t('admin.edge.enabled') }}:
          <strong>{{ edgeStatus.enabled ? 'yes' : 'no' }}</strong>
          (flag {{ edgeStatus.featureFlag ? 'on' : 'off' }})
        </p>
        <p>{{ t('admin.edge.pending') }}: {{ edgeStatus.pending }}</p>
        <p>{{ t('admin.edge.delivered') }}: {{ edgeStatus.delivered }}</p>
        <p>{{ t('admin.edge.hub') }}: {{ edgeStatus.hubUrl || '—' }}</p>
        <button
          type="button"
          class="touch-target rounded-2xl bg-slate-900 px-4 font-semibold text-white"
          :disabled="busy"
          @click="runEdgePush"
        >
          {{ t('admin.edge.push') }}
        </button>
      </div>
      <p v-else class="text-sm text-slate-500">{{ t('admin.edge.unavailable') }}</p>
    </UiPanel>
  </div>
</template>
