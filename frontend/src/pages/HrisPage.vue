<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import UiPanel from '../components/UiPanel.vue';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';
import {
  calculatePayroll,
  createEmployee,
  createWorkShift,
  finalizePayrollSlip,
  listAttendances,
  listEmployees,
  listPayrollSlips,
  listWorkShifts,
  updateEmployee,
  updateWorkShift,
  upsertAttendance,
  type Attendance,
  type Employee,
  type PayrollSlip,
  type WorkShift,
} from '../services/hris-api.service';
import { useAuthStore } from '../stores/auth.store';
import { useToastStore } from '../stores/toast.store';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const employees = ref<Employee[]>([]);
const shifts = ref<WorkShift[]>([]);
const attendances = ref<Attendance[]>([]);
const slips = ref<PayrollSlip[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);
const selectedEmployeeId = ref('');
const periodYear = ref(new Date().getFullYear());
const periodMonth = ref(new Date().getMonth() + 1);

const canWriteEmployee = computed(() => auth.has('hris.employee.write'));
const canWriteShift = computed(() => auth.has('hris.work_shift.write'));
const canWriteAttendance = computed(() => auth.has('hris.attendance.write'));
const canPayroll = computed(() => auth.has('hris.payroll.calculate'));

const empForm = ref({
  id: '' as string,
  employeeCode: '',
  fullName: '',
  hireDate: new Date().toISOString().slice(0, 10),
  baseSalaryRp: 0,
  ptkpStatus: 'TK0',
  workShiftId: '',
  status: 'ACTIVE',
  email: '',
});

const shiftForm = ref({
  id: '' as string,
  code: '',
  name: '',
  startHhmm: '08:00',
  endHhmm: '17:00',
  breakMinutes: 60,
  isActive: true,
});

const attForm = ref({
  employeeId: '',
  workDate: new Date().toISOString().slice(0, 10),
  clockIn: '08:00',
  clockOut: '17:00',
  status: 'PRESENT',
  notes: '',
});

const PTKP = ['TK0', 'TK1', 'TK2', 'TK3', 'K0', 'K1', 'K2', 'K3'] as const;
const ATT_STATUS = ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HALF_DAY', 'HOLIDAY'] as const;
const EMP_STATUS = ['ACTIVE', 'ON_LEAVE', 'TERMINATED'] as const;

onMounted(async () => {
  if (!auth.has('hris.employee.read')) {
    error.value = t('hris.denied');
    return;
  }
  await refresh();
});

async function refresh(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    employees.value = await listEmployees();
    shifts.value = await listWorkShifts();
    attendances.value = await listAttendances();
    slips.value = await listPayrollSlips(periodYear.value, periodMonth.value);
    if (!selectedEmployeeId.value && employees.value[0]) {
      selectedEmployeeId.value = employees.value[0].id;
    }
    if (!attForm.value.employeeId && employees.value[0]) {
      attForm.value.employeeId = employees.value[0].id;
    }
    if (!empForm.value.workShiftId && shifts.value.find((s) => s.isActive !== false)) {
      empForm.value.workShiftId = shifts.value.find((s) => s.isActive !== false)?.id ?? '';
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('hris.loadFailed');
  } finally {
    busy.value = false;
  }
}

function minutesLabel(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return t('hris.minutes', { h, m: min });
}

function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(':').map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function minutesToHhmm(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function resetEmpForm(): void {
  empForm.value = {
    id: '',
    employeeCode: '',
    fullName: '',
    hireDate: new Date().toISOString().slice(0, 10),
    baseSalaryRp: 0,
    ptkpStatus: 'TK0',
    workShiftId: shifts.value.find((s) => s.isActive !== false)?.id ?? '',
    status: 'ACTIVE',
    email: '',
  };
}

function editEmployee(emp: Employee): void {
  empForm.value = {
    id: emp.id,
    employeeCode: emp.employeeCode,
    fullName: emp.fullName,
    hireDate: (emp.hireDate ?? new Date().toISOString()).slice(0, 10),
    baseSalaryRp: emp.baseSalaryInCents,
    ptkpStatus: emp.ptkpStatus,
    workShiftId: emp.workShiftId ?? emp.workShift?.id ?? '',
    status: emp.status,
    email: emp.email ?? '',
  };
}

async function saveEmployee(): Promise<void> {
  if (!canWriteEmployee.value) return;
  if (!empForm.value.employeeCode.trim() || !empForm.value.fullName.trim()) {
    error.value = t('hris.formRequired');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    const body = {
      employeeCode: empForm.value.employeeCode.trim(),
      fullName: empForm.value.fullName.trim(),
      hireDate: empForm.value.hireDate,
      baseSalaryInCents: Math.trunc(empForm.value.baseSalaryRp),
      ptkpStatus: empForm.value.ptkpStatus,
      workShiftId: empForm.value.workShiftId || null,
      email: empForm.value.email || undefined,
      status: empForm.value.status,
    };
    if (empForm.value.id) {
      await updateEmployee(empForm.value.id, body);
    } else {
      await createEmployee(body);
    }
    toast.success(t('hris.saved'));
    resetEmpForm();
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('hris.saveFailed');
  } finally {
    busy.value = false;
  }
}

function editShift(shift: WorkShift): void {
  shiftForm.value = {
    id: shift.id,
    code: shift.code,
    name: shift.name,
    startHhmm: minutesToHhmm(shift.startMinutes),
    endHhmm: minutesToHhmm(shift.endMinutes),
    breakMinutes: shift.breakMinutes ?? 60,
    isActive: shift.isActive !== false,
  };
}

function resetShiftForm(): void {
  shiftForm.value = {
    id: '',
    code: '',
    name: '',
    startHhmm: '08:00',
    endHhmm: '17:00',
    breakMinutes: 60,
    isActive: true,
  };
}

async function saveShift(): Promise<void> {
  if (!canWriteShift.value) return;
  if (!shiftForm.value.code.trim() || !shiftForm.value.name.trim()) {
    error.value = t('hris.formRequired');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    const body = {
      code: shiftForm.value.code.trim(),
      name: shiftForm.value.name.trim(),
      startMinutes: hhmmToMinutes(shiftForm.value.startHhmm),
      endMinutes: hhmmToMinutes(shiftForm.value.endHhmm),
      breakMinutes: Math.trunc(shiftForm.value.breakMinutes),
      isActive: shiftForm.value.isActive,
    };
    if (shiftForm.value.id) {
      await updateWorkShift(shiftForm.value.id, body);
    } else {
      await createWorkShift(body);
    }
    toast.success(t('hris.saved'));
    resetShiftForm();
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('hris.saveFailed');
  } finally {
    busy.value = false;
  }
}

async function saveAttendance(): Promise<void> {
  if (!canWriteAttendance.value) return;
  if (!attForm.value.employeeId || !attForm.value.workDate) {
    error.value = t('hris.formRequired');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    const date = attForm.value.workDate;
    const clockInAt = attForm.value.clockIn
      ? new Date(`${date}T${attForm.value.clockIn}:00`).toISOString()
      : null;
    const clockOutAt = attForm.value.clockOut
      ? new Date(`${date}T${attForm.value.clockOut}:00`).toISOString()
      : null;
    await upsertAttendance({
      employeeId: attForm.value.employeeId,
      workDate: date,
      clockInAt,
      clockOutAt,
      status: attForm.value.status,
      notes: attForm.value.notes || null,
    });
    toast.success(t('hris.saved'));
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('hris.saveFailed');
  } finally {
    busy.value = false;
  }
}

async function runPayroll(): Promise<void> {
  if (!selectedEmployeeId.value) return;
  if (!canPayroll.value) {
    error.value = t('hris.payrollDenied');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await calculatePayroll(selectedEmployeeId.value, periodYear.value, periodMonth.value);
    slips.value = await listPayrollSlips(periodYear.value, periodMonth.value);
    toast.success(t('hris.calcOk'));
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('hris.calcFailed');
  } finally {
    busy.value = false;
  }
}

async function finalizeSlip(id: string): Promise<void> {
  if (!canPayroll.value) return;
  busy.value = true;
  error.value = null;
  try {
    await finalizePayrollSlip(id);
    toast.success(t('hris.finalizeOk'));
    slips.value = await listPayrollSlips(periodYear.value, periodMonth.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('hris.finalizeFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-5">
    <PageHeader
      compact
      :eyebrow="t('hris.eyebrow')"
      :title="t('hris.title')"
      :subtitle="t('hris.subtitle')"
    >
      <template #actions>
        <button
          class="min-h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white"
          type="button"
          :disabled="busy"
          @click="refresh"
        >
          {{ t('common.reload') }}
        </button>
      </template>
    </PageHeader>

    <p v-if="error" class="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{{ error }}</p>

    <template v-if="auth.has('hris.employee.read')">
      <UiPanel dense class="mb-3" :title="t('hris.employees')">
        <div
          v-if="canWriteEmployee"
          class="mb-2 grid gap-2 rounded-xl bg-slate-50 p-2.5 sm:grid-cols-2 lg:grid-cols-3"
        >
          <label class="text-sm">
            {{ t('hris.code') }}
            <input v-model="empForm.employeeCode" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm" />
          </label>
          <label class="text-sm">
            {{ t('hris.name') }}
            <input v-model="empForm.fullName" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm" />
          </label>
          <label class="text-sm">
            {{ t('hris.hireDate') }}
            <input
              v-model="empForm.hireDate"
              class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
              type="date"
            />
          </label>
          <label class="text-sm">
            {{ t('hris.baseSalary') }}
            <input
              v-model.number="empForm.baseSalaryRp"
              class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm tabular-nums"
              type="number"
              min="0"
              step="1"
            />
          </label>
          <label class="text-sm">
            {{ t('hris.ptkp') }}
            <select v-model="empForm.ptkpStatus" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm">
              <option v-for="p in PTKP" :key="p" :value="p">{{ p }}</option>
            </select>
          </label>
          <label class="text-sm">
            {{ t('hris.workShift') }}
            <select v-model="empForm.workShiftId" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm">
              <option value="">{{ t('common.empty') }}</option>
              <option v-for="s in shifts" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
            </select>
          </label>
          <label v-if="empForm.id" class="text-sm">
            {{ t('hris.status') }}
            <select v-model="empForm.status" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm">
              <option v-for="s in EMP_STATUS" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <div class="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
            <button
              type="button"
              class="min-h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
              :disabled="busy"
              @click="saveEmployee"
            >
              {{ empForm.id ? t('hris.update') : t('hris.addEmployee') }}
            </button>
            <button
              v-if="empForm.id"
              type="button"
              class="min-h-9 rounded-lg bg-white px-3 text-sm font-semibold ring-1 ring-slate-200"
              @click="resetEmpForm"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.code') }}</th>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.name') }}</th>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.baseSalary') }}</th>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.ptkp') }}</th>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.workShift') }}</th>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.status') }}</th>
                <th v-if="canWriteEmployee" class="px-2.5 py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="emp in employees"
                :key="emp.id"
                class="border-b border-slate-100 last:border-0"
              >
                <td class="px-2.5 py-1.5 font-medium">{{ emp.employeeCode }}</td>
                <td class="px-2.5 py-1.5">{{ emp.fullName }}</td>
                <td class="px-2.5 py-1.5 tabular-nums">
                  {{ formatIdrFromCents(emp.baseSalaryInCents) }}
                </td>
                <td class="px-2.5 py-1.5">{{ emp.ptkpStatus }}</td>
                <td class="px-2.5 py-1.5">{{ emp.workShift?.name || t('common.empty') }}</td>
                <td class="px-2.5 py-1.5">{{ emp.status }}</td>
                <td v-if="canWriteEmployee" class="px-2.5 py-1.5">
                  <button
                    type="button"
                    class="text-sm font-semibold text-sky-700"
                    @click="editEmployee(emp)"
                  >
                    {{ t('hris.edit') }}
                  </button>
                </td>
              </tr>
              <tr v-if="!employees.length">
                <td class="px-3 py-4 text-slate-500" :colspan="canWriteEmployee ? 7 : 6">
                  {{ t('hris.emptyEmployees') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiPanel>

      <section class="mb-3 grid gap-2 lg:grid-cols-2">
        <UiPanel dense :title="t('hris.schedules')">
          <div
            v-if="canWriteShift"
            class="mb-2 grid gap-2 rounded-xl bg-slate-50 p-2.5 sm:grid-cols-2"
          >
            <label class="text-sm">
              {{ t('hris.code') }}
              <input v-model="shiftForm.code" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm" />
            </label>
            <label class="text-sm">
              {{ t('hris.name') }}
              <input v-model="shiftForm.name" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm" />
            </label>
            <label class="text-sm">
              {{ t('hris.start') }}
              <input
                v-model="shiftForm.startHhmm"
                class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
                type="time"
              />
            </label>
            <label class="text-sm">
              {{ t('hris.end') }}
              <input
                v-model="shiftForm.endHhmm"
                class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
                type="time"
              />
            </label>
            <label class="text-sm">
              {{ t('hris.breakMin') }}
              <input
                v-model.number="shiftForm.breakMinutes"
                class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
                type="number"
                min="0"
              />
            </label>
            <div class="flex flex-wrap items-end gap-2 sm:col-span-2">
              <button
                type="button"
                class="min-h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white"
                :disabled="busy"
                @click="saveShift"
              >
                {{ shiftForm.id ? t('hris.update') : t('hris.addShift') }}
              </button>
              <button
                v-if="shiftForm.id"
                type="button"
                class="min-h-9 rounded-lg bg-white px-3 text-sm font-semibold ring-1 ring-slate-200"
                @click="resetShiftForm"
              >
                {{ t('common.cancel') }}
              </button>
            </div>
          </div>
          <ul class="divide-y divide-slate-100 overflow-hidden rounded-lg ring-1 ring-slate-100">
            <li
              v-for="shift in shifts"
              :key="shift.id"
              class="flex items-start justify-between gap-2 bg-white px-2.5 py-1.5"
            >
              <div>
                <p class="font-medium">
                  {{ shift.code }} — {{ shift.name }}
                  <span v-if="shift.isActive === false" class="text-xs text-red-600">
                    ({{ t('hris.inactive') }})
                  </span>
                </p>
                <p class="text-sm text-slate-600">
                  {{
                    t('hris.scheduleLine', {
                      standard: minutesLabel(shift.standardMinutes),
                      start: minutesLabel(shift.startMinutes),
                      end: minutesLabel(shift.endMinutes),
                    })
                  }}
                </p>
              </div>
              <button
                v-if="canWriteShift"
                type="button"
                class="shrink-0 text-sm font-semibold text-sky-700"
                @click="editShift(shift)"
              >
                {{ t('hris.edit') }}
              </button>
            </li>
            <li v-if="!shifts.length" class="px-2.5 py-2 text-sm text-slate-500">{{ t('hris.emptyShifts') }}</li>
          </ul>
        </UiPanel>

        <UiPanel dense :title="t('hris.attendance')">
          <div
            v-if="canWriteAttendance"
            class="mb-2 grid gap-2 rounded-xl bg-slate-50 p-2.5 sm:grid-cols-2"
          >
            <label class="text-sm sm:col-span-2">
              {{ t('hris.employee') }}
              <select v-model="attForm.employeeId" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm">
                <option v-for="emp in employees" :key="emp.id" :value="emp.id">
                  {{ emp.employeeCode }} — {{ emp.fullName }}
                </option>
              </select>
            </label>
            <label class="text-sm">
              {{ t('hris.workDate') }}
              <input
                v-model="attForm.workDate"
                class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
                type="date"
              />
            </label>
            <label class="text-sm">
              {{ t('hris.status') }}
              <select v-model="attForm.status" class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm">
                <option v-for="s in ATT_STATUS" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>
            <label class="text-sm">
              {{ t('hris.clockIn') }}
              <input
                v-model="attForm.clockIn"
                class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
                type="time"
              />
            </label>
            <label class="text-sm">
              {{ t('hris.clockOut') }}
              <input
                v-model="attForm.clockOut"
                class="mt-0.5 min-h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
                type="time"
              />
            </label>
            <button
              type="button"
              class="min-h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white sm:col-span-2"
              :disabled="busy"
              @click="saveAttendance"
            >
              {{ t('hris.saveAttendance') }}
            </button>
          </div>
          <ul class="max-h-64 divide-y divide-slate-100 overflow-auto rounded-lg ring-1 ring-slate-100">
            <li
              v-for="row in attendances"
              :key="row.id"
              class="bg-white px-2.5 py-1.5 text-sm"
            >
              <p class="font-medium">{{ row.employee.fullName }}</p>
              <p class="text-slate-600">
                {{
                  t('hris.attendanceLine', {
                    date: row.workDate.slice(0, 10),
                    status: row.status,
                    ot: minutesLabel(row.overtimeMinutes),
                  })
                }}
              </p>
            </li>
            <li v-if="!attendances.length" class="px-2.5 py-2 text-sm text-slate-500">
              {{ t('hris.emptyAttendance') }}
            </li>
          </ul>
        </UiPanel>
      </section>

      <UiPanel dense :title="t('hris.payroll')">
        <div class="flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-2.5">
          <div>
            <label class="text-sm text-slate-600">{{ t('hris.employee') }}</label>
            <select
              v-model="selectedEmployeeId"
              class="mt-0.5 min-h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
            >
              <option v-for="emp in employees" :key="emp.id" :value="emp.id">
                {{ emp.employeeCode }} — {{ emp.fullName }}
              </option>
            </select>
          </div>
          <div>
            <label class="text-sm text-slate-600">{{ t('hris.year') }}</label>
            <input
              v-model.number="periodYear"
              class="mt-0.5 min-h-9 w-24 rounded-lg border border-slate-300 px-2.5 text-sm"
              type="number"
            />
          </div>
          <div>
            <label class="text-sm text-slate-600">{{ t('hris.month') }}</label>
            <input
              v-model.number="periodMonth"
              class="mt-0.5 min-h-9 w-16 rounded-lg border border-slate-300 px-2.5 text-sm"
              type="number"
              min="1"
              max="12"
            />
          </div>
          <button
            v-if="canPayroll"
            class="min-h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
            type="button"
            :disabled="busy"
            @click="runPayroll"
          >
            {{ t('hris.calculate') }}
          </button>
        </div>

        <div class="mt-2 overflow-x-auto rounded-xl border border-slate-200">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.employee') }}</th>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.period') }}</th>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.gross') }}</th>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.overtime') }}</th>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.pph21') }}</th>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.net') }}</th>
                <th class="px-2.5 py-1.5 font-medium">{{ t('hris.status') }}</th>
                <th v-if="canPayroll" class="px-2.5 py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="slip in slips" :key="slip.id" class="border-b border-slate-100 last:border-0">
                <td class="px-2.5 py-1.5">{{ slip.employee.fullName }}</td>
                <td class="px-2.5 py-1.5 tabular-nums">
                  {{ slip.periodYear }}-{{ String(slip.periodMonth).padStart(2, '0') }}
                </td>
                <td class="px-2.5 py-1.5 tabular-nums">
                  {{ formatIdrFromCents(slip.grossInCents) }}
                </td>
                <td class="px-2.5 py-1.5 tabular-nums">
                  {{ formatIdrFromCents(slip.overtimePayInCents) }}
                </td>
                <td class="px-2.5 py-1.5 tabular-nums">
                  {{ formatIdrFromCents(slip.pph21InCents) }}
                </td>
                <td class="px-2.5 py-1.5 font-semibold tabular-nums">
                  {{ formatIdrFromCents(slip.netInCents) }}
                </td>
                <td class="px-2.5 py-1.5">{{ slip.status }}</td>
                <td v-if="canPayroll" class="px-2.5 py-1.5">
                  <button
                    v-if="slip.status === 'DRAFT'"
                    type="button"
                    class="text-xs font-semibold text-emerald-700"
                    :disabled="busy"
                    @click="finalizeSlip(slip.id)"
                  >
                    {{ t('hris.finalize') }}
                  </button>
                </td>
              </tr>
              <tr v-if="!slips.length">
                <td class="px-3 py-4 text-slate-500" :colspan="canPayroll ? 8 : 7">
                  {{ t('hris.emptySlips') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiPanel>
    </template>
  </main>
</template>
