import { apiGet, apiPatch, apiPost } from '../api/client';

export type TableArea = {
  id: string;
  storeId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type DiningTable = {
  id: string;
  storeId: string;
  areaId: string | null;
  code: string;
  name: string;
  capacity: number;
  sortOrder: number;
  isActive: boolean;
  area?: { id: string; name: string } | null;
};

export type TableFloorStatus = 'AVAILABLE' | 'OCCUPIED' | 'BILLING';

export type FloorTable = {
  id: string;
  code: string;
  name: string;
  capacity: number;
  sortOrder: number;
  isActive: boolean;
  areaId: string | null;
  status: TableFloorStatus;
  activeCart: {
    clientUuid: string;
    label: string | null;
    totalInCents: number;
    itemCount: number;
    parkedAt: string | null;
    updatedAt: string;
  } | null;
};

export type TableFloor = {
  storeId: string;
  areas: Array<{ id: string; name: string; sortOrder: number; tables: FloorTable[] }>;
  ungrouped: FloorTable[];
};

export function fetchTableFloor(storeId: string): Promise<TableFloor> {
  return apiGet(`/tables/floor?storeId=${encodeURIComponent(storeId)}`);
}

export function fetchTableAreas(storeId: string): Promise<TableArea[]> {
  return apiGet(`/tables/areas?storeId=${encodeURIComponent(storeId)}`);
}

export function createTableArea(body: {
  storeId: string;
  name: string;
  sortOrder?: number;
}): Promise<TableArea> {
  return apiPost('/tables/areas', body);
}

export function updateTableArea(
  id: string,
  body: Partial<{ name: string; sortOrder: number; isActive: boolean }>,
): Promise<TableArea> {
  return apiPatch(`/tables/areas/${id}`, body);
}

export function fetchDiningTables(storeId: string): Promise<DiningTable[]> {
  return apiGet(`/tables?storeId=${encodeURIComponent(storeId)}`);
}

export function createDiningTable(body: {
  storeId: string;
  areaId?: string | null;
  code: string;
  name: string;
  capacity?: number;
  sortOrder?: number;
}): Promise<DiningTable> {
  return apiPost('/tables', body);
}

export function updateDiningTable(
  id: string,
  body: Partial<{
    areaId: string | null;
    code: string;
    name: string;
    capacity: number;
    sortOrder: number;
    isActive: boolean;
  }>,
): Promise<DiningTable> {
  return apiPatch(`/tables/${id}`, body);
}
