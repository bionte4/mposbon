import { apiGet, apiPost } from '../api/client';
import type { Permission, StaffRole } from '../auth/permissions';

export type LoginResponse = {
  accessToken: string;
  tokenType: string;
  expiresInSec: number;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: StaffRole;
    permissions: Permission[];
    kitchenStationIds?: string[];
  };
};

export type AuthMeResponse = {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  permissions: Permission[];
  tenantId: string;
  kitchenStationIds?: string[];
};

export function loginStaff(email: string, pin: string) {
  return apiPost<LoginResponse>('/auth/login', { email, pin });
}

export function fetchAuthMe() {
  return apiGet<AuthMeResponse>('/auth/me');
}
