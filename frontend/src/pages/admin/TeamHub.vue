<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import UiPanel from '../../components/UiPanel.vue';
import type { StaffRole } from '../../auth/permissions';
import { useI18n } from '../../i18n';
import type { AdminShellApi } from './AdminShell.vue';
import {
  createAdminStaff,
  fetchAdminStaff,
  fetchAdminStores,
  updateAdminStaff,
  type AdminStaff,
} from '../../services/admin-api.service';
import { fetchKitchenStations, type KitchenStation } from '../../services/kitchen-api.service';
import { useAuthStore } from '../../stores/auth.store';
import { useToastStore } from '../../stores/toast.store';

const STAFF_ROLES: StaffRole[] = [
  'CASHIER',
  'KITCHEN',
  'SUPERVISOR',
  'MANAGER',
  'TENANT_ADMIN',
  'SUPER_ADMIN',
];

const ROLE_RANK: Record<StaffRole, number> = {
  CASHIER: 1,
  KITCHEN: 1,
  SUPERVISOR: 2,
  MANAGER: 3,
  TENANT_ADMIN: 4,
  SUPER_ADMIN: 5,
};

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();
const shell = inject<AdminShellApi>('adminShell')!;

const canStaff = computed(() => auth.has('admin.staff.read'));
const canStaffWrite = computed(() => auth.has('admin.staff.write'));
const busy = computed(() => shell.busy.value);

const staff = ref<AdminStaff[]>([]);
const kitchenStations = ref<KitchenStation[]>([]);

const newStaff = ref({
  email: '',
  displayName: '',
  role: 'CASHIER' as StaffRole,
  pin: '1234',
  kitchenStationIds: [] as string[],
});

const staffDraftName = ref<Record<string, string>>({});
const staffDraftRole = ref<Record<string, string>>({});
const staffDraftActive = ref<Record<string, boolean>>({});
const staffDraftPin = ref<Record<string, string>>({});
const staffDraftStations = ref<Record<string, string[]>>({});

const assignableRoles = computed(() => {
  const actorRank = ROLE_RANK[(auth.staff?.role as StaffRole) ?? 'CASHIER'] ?? 0;
  return STAFF_ROLES.filter((r) => ROLE_RANK[r] <= actorRank);
});

onMounted(() => {
  void refresh();
  window.addEventListener('admin:reload', onReload);
});
onUnmounted(() => window.removeEventListener('admin:reload', onReload));
function onReload(): void {
  void refresh();
}

async function refresh(): Promise<void> {
  if (!canStaff.value) {
    shell.setError(null);
    return;
  }
  shell.setBusy(true);
  shell.setError(null);
  try {
    const [users, storeRows] = await Promise.all([fetchAdminStaff(), fetchAdminStores()]);
    staff.value = users;
    for (const u of users) {
      staffDraftName.value[u.id] = u.displayName;
      staffDraftRole.value[u.id] = u.role;
      staffDraftActive.value[u.id] = u.isActive;
      staffDraftPin.value[u.id] = '';
      staffDraftStations.value[u.id] = [...(u.kitchenStationIds ?? [])];
    }
    if (storeRows[0]) {
      kitchenStations.value = await fetchKitchenStations(storeRows[0].id).catch(() => []);
    }
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

function toggleStaffStation(target: string[], stationId: string, on: boolean): void {
  const i = target.indexOf(stationId);
  if (on && i < 0) target.push(stationId);
  if (!on && i >= 0) target.splice(i, 1);
}

function canEditStaffRow(user: AdminStaff): boolean {
  if (!canStaffWrite.value) return false;
  const actorRank = ROLE_RANK[(auth.staff?.role as StaffRole) ?? 'CASHIER'] ?? 0;
  const targetRank = ROLE_RANK[user.role as StaffRole] ?? 99;
  return targetRank <= actorRank;
}

async function addStaff(): Promise<void> {
  if (!canStaffWrite.value) return;
  if (!newStaff.value.email.trim() || !newStaff.value.displayName.trim()) return;
  if (!/^\d{4,8}$/.test(newStaff.value.pin)) {
    shell.setError(t('admin.staffPinInvalid'));
    return;
  }
  shell.setBusy(true);
  shell.setError(null);
  try {
    await createAdminStaff({
      email: newStaff.value.email.trim(),
      displayName: newStaff.value.displayName.trim(),
      role: newStaff.value.role,
      pin: newStaff.value.pin,
      kitchenStationIds:
        newStaff.value.role === 'KITCHEN' ? newStaff.value.kitchenStationIds : [],
    });
    toast.success(t('admin.staffCreated'));
    newStaff.value = {
      email: '',
      displayName: '',
      role: 'CASHIER',
      pin: '1234',
      kitchenStationIds: [],
    };
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveStaff(user: AdminStaff): Promise<void> {
  if (!canStaffWrite.value) return;
  const pin = (staffDraftPin.value[user.id] ?? '').trim();
  if (pin && !/^\d{4,8}$/.test(pin)) {
    shell.setError(t('admin.staffPinInvalid'));
    return;
  }
  shell.setBusy(true);
  shell.setError(null);
  try {
    const role = (staffDraftRole.value[user.id] || user.role) as StaffRole;
    await updateAdminStaff(user.id, {
      displayName: staffDraftName.value[user.id]?.trim() || user.displayName,
      role,
      isActive: staffDraftActive.value[user.id] ?? user.isActive,
      kitchenStationIds: role === 'KITCHEN' ? staffDraftStations.value[user.id] ?? [] : [],
      ...(pin ? { pin } : {}),
    });
    toast.success(t('admin.saved'));
    staffDraftPin.value[user.id] = '';
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}
</script>

<template>
  <UiPanel dense :title="t('admin.tabs.staff')" :padded="false">
    <div v-if="!canStaff" class="px-3 py-2 text-sm text-slate-500">{{ t('admin.denied') }}</div>
    <div v-else class="space-y-2 p-3">
      <div
        v-if="canStaffWrite"
        class="grid gap-2 rounded-xl bg-slate-50 p-2.5 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label class="text-xs font-medium text-slate-600">
          {{ t('admin.name') }}
          <input v-model="newStaff.displayName" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm" type="text" />
        </label>
        <label class="text-xs font-medium text-slate-600">
          {{ t('admin.email') }}
          <input v-model="newStaff.email" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm" type="email" autocomplete="off" />
        </label>
        <label class="text-xs font-medium text-slate-600">
          {{ t('admin.role') }}
          <select v-model="newStaff.role" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm">
            <option v-for="r in assignableRoles" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label class="text-xs font-medium text-slate-600">
          {{ t('admin.staffPin') }}
          <input
            v-model="newStaff.pin"
            class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm tabular-nums"
            type="password"
            inputmode="numeric"
            maxlength="8"
            autocomplete="new-password"
          />
        </label>
        <button
          type="button"
          class="min-h-9 self-end rounded-lg bg-slate-900 text-sm font-semibold text-white disabled:opacity-40"
          :disabled="busy"
          @click="addStaff"
        >
          {{ t('admin.addStaff') }}
        </button>
        <div
          v-if="newStaff.role === 'KITCHEN'"
          class="flex flex-wrap gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-200 sm:col-span-2 lg:col-span-5"
        >
          <span class="w-full text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {{ t('admin.staffStations') }}
          </span>
          <label
            v-for="st in kitchenStations.filter((s) => s.isActive)"
            :key="st.id"
            class="inline-flex items-center gap-1.5 text-xs"
          >
            <input
              type="checkbox"
              class="h-3.5 w-3.5"
              :checked="newStaff.kitchenStationIds.includes(st.id)"
              @change="
                toggleStaffStation(
                  newStaff.kitchenStationIds,
                  st.id,
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            {{ st.code }} · {{ st.name }}
          </label>
        </div>
      </div>

      <div class="overflow-x-auto rounded-xl ring-1 ring-slate-200">
        <table class="min-w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th class="px-2.5 py-1.5 font-medium">{{ t('admin.name') }}</th>
              <th class="px-2.5 py-1.5 font-medium">{{ t('admin.email') }}</th>
              <th class="px-2.5 py-1.5 font-medium">{{ t('admin.role') }}</th>
              <th class="px-2.5 py-1.5 font-medium">{{ t('admin.staffStations') }}</th>
              <th class="px-2.5 py-1.5 font-medium">{{ t('admin.status') }}</th>
              <th v-if="canStaffWrite" class="px-2.5 py-1.5 font-medium">{{ t('admin.staffPin') }}</th>
              <th v-if="canStaffWrite" class="px-2.5 py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in staff" :key="u.id" class="border-b border-slate-100 last:border-0">
              <td class="px-2.5 py-1.5">
                <input
                  v-if="canEditStaffRow(u)"
                  v-model="staffDraftName[u.id]"
                  class="min-h-9 w-full min-w-[8rem] rounded-lg border px-2 text-sm"
                  type="text"
                />
                <span v-else class="font-medium">{{ u.displayName }}</span>
              </td>
              <td class="px-2.5 py-1.5">{{ u.email }}</td>
              <td class="px-2.5 py-1.5">
                <select
                  v-if="canEditStaffRow(u) && u.id !== auth.staff?.id"
                  v-model="staffDraftRole[u.id]"
                  class="min-h-9 rounded-lg border px-2 text-sm"
                >
                  <option v-for="r in assignableRoles" :key="r" :value="r">{{ r }}</option>
                </select>
                <span v-else>{{ u.role }}</span>
              </td>
              <td class="px-2.5 py-1.5">
                <div
                  v-if="(staffDraftRole[u.id] || u.role) === 'KITCHEN' && canEditStaffRow(u)"
                  class="flex flex-wrap gap-1.5"
                >
                  <label
                    v-for="st in kitchenStations.filter((s) => s.isActive)"
                    :key="st.id"
                    class="inline-flex items-center gap-1 text-xs"
                  >
                    <input
                      type="checkbox"
                      class="h-3.5 w-3.5"
                      :checked="(staffDraftStations[u.id] ?? []).includes(st.id)"
                      @change="
                        toggleStaffStation(
                          staffDraftStations[u.id] ?? (staffDraftStations[u.id] = []),
                          st.id,
                          ($event.target as HTMLInputElement).checked,
                        )
                      "
                    />
                    {{ st.code }}
                  </label>
                </div>
                <span v-else-if="(u.kitchenStationIds ?? []).length" class="text-xs text-slate-600">
                  {{
                    kitchenStations
                      .filter((s) => (u.kitchenStationIds ?? []).includes(s.id))
                      .map((s) => s.code)
                      .join(', ') || '—'
                  }}
                </span>
                <span v-else class="text-xs text-slate-400">—</span>
              </td>
              <td class="px-2.5 py-1.5">
                <label
                  v-if="canEditStaffRow(u) && u.id !== auth.staff?.id"
                  class="inline-flex items-center gap-2 text-xs"
                >
                  <input v-model="staffDraftActive[u.id]" type="checkbox" class="h-3.5 w-3.5" />
                  {{ staffDraftActive[u.id] ? t('admin.active') : t('admin.inactive') }}
                </label>
                <span v-else class="text-xs">{{ u.isActive ? t('admin.active') : t('admin.inactive') }}</span>
              </td>
              <td v-if="canStaffWrite" class="px-2.5 py-1.5">
                <input
                  v-if="canEditStaffRow(u)"
                  v-model="staffDraftPin[u.id]"
                  class="min-h-9 w-28 rounded-lg border px-2 text-sm tabular-nums"
                  type="password"
                  inputmode="numeric"
                  maxlength="8"
                  :placeholder="u.hasPin ? '••••' : t('admin.staffPinSet')"
                  autocomplete="new-password"
                />
                <span v-else class="text-slate-400">—</span>
              </td>
              <td v-if="canStaffWrite" class="px-2.5 py-1.5">
                <button
                  v-if="canEditStaffRow(u)"
                  type="button"
                  class="min-h-8 rounded-lg bg-slate-900 px-2.5 text-xs font-semibold text-white disabled:opacity-40"
                  :disabled="busy"
                  @click="saveStaff(u)"
                >
                  {{ t('admin.save') }}
                </button>
              </td>
            </tr>
            <tr v-if="!staff.length">
              <td class="px-3 py-4 text-slate-500" :colspan="canStaffWrite ? 7 : 5">
                {{ t('admin.emptyStaff') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </UiPanel>
</template>
