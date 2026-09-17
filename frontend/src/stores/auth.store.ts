import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { clearApiAuth, setApiAuth } from '../api/client';
import {
  can,
  roleHasPermission,
  type Permission,
  type StaffRole,
} from '../auth/permissions';
import { fetchAuthMe, loginStaff } from '../services/auth-api.service';

const TOKEN_KEY = 'bonpos.accessToken';
const EMAIL_KEY = 'bonpos.actingEmail';

export type AuthStaff = {
  id: string;
  displayName: string;
  email: string;
  role: StaffRole;
  permissions: Permission[];
  kitchenStationIds: string[];
};

export const useAuthStore = defineStore('auth', () => {
  const staff = ref<AuthStaff | null>(null);
  const accessToken = ref<string | null>(localStorage.getItem(TOKEN_KEY));
  const bootstrapped = ref(false);

  const role = computed(() => staff.value?.role ?? null);
  const permissions = computed(() => staff.value?.permissions ?? []);
  const isAuthenticated = computed(() => Boolean(staff.value && accessToken.value));

  function applyAuthHeaders(): void {
    setApiAuth({
      accessToken: accessToken.value,
      userId: staff.value?.id ?? null,
      userEmail: staff.value?.email ?? null,
    });
  }

  function setAccessToken(token: string | null): void {
    accessToken.value = token;
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    applyAuthHeaders();
  }

  function setStaff(next: AuthStaff | null): void {
    staff.value = next;
    if (next?.email) {
      localStorage.setItem(EMAIL_KEY, next.email);
    }
    applyAuthHeaders();
  }

  function has(permission: Permission): boolean {
    // Prefer live role matrix so new permissions apply after FE reload
    // even if /auth/me still returns a stale permissions snapshot.
    if (role.value && roleHasPermission(role.value, permission)) {
      return true;
    }
    return can(permissions.value, permission);
  }

  /** Sensitive actions always need supervisor PIN on the API, even for managers. */
  function requiresSupervisorPin(permission: Permission): boolean {
    return (
      permission === 'pos.void' ||
      permission === 'pos.discount.manual' ||
      permission === 'pos.drawer.open_force'
    );
  }

  async function login(email: string, pin: string): Promise<void> {
    const result = await loginStaff(email.trim().toLowerCase(), pin);
    setAccessToken(result.accessToken);
    setStaff({
      ...result.user,
      kitchenStationIds: result.user.kitchenStationIds ?? [],
    });
  }

  async function restoreSession(): Promise<boolean> {
    applyAuthHeaders();
    if (!accessToken.value) {
      bootstrapped.value = true;
      return false;
    }
    try {
      const me = await fetchAuthMe();
      setStaff({
        id: me.id,
        email: me.email,
        displayName: me.displayName,
        role: me.role,
        permissions: me.permissions,
        kitchenStationIds: me.kitchenStationIds ?? [],
      });
      bootstrapped.value = true;
      return true;
    } catch {
      logout();
      bootstrapped.value = true;
      return false;
    }
  }

  function logout(): void {
    staff.value = null;
    accessToken.value = null;
    localStorage.removeItem(TOKEN_KEY);
    clearApiAuth();
    applyAuthHeaders();
  }

  return {
    staff,
    accessToken,
    bootstrapped,
    role,
    permissions,
    isAuthenticated,
    setStaff,
    setAccessToken,
    applyAuthHeaders,
    has,
    requiresSupervisorPin,
    login,
    logout,
    restoreSession,
  };
});
