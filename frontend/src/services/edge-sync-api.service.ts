import { apiGet, apiPost } from '../api/client';

export type EdgeSyncStatus = {
  enabled: boolean;
  featureFlag: boolean;
  pending: number;
  delivered: number;
  hubUrl: string | null;
  lastCursor: string | null;
};

export function fetchEdgeSyncStatus() {
  return apiGet<EdgeSyncStatus>('/edge-sync/status');
}

export function pushEdgeSync(limit = 50) {
  return apiPost<{ pushed: number; dryRun?: boolean; skipped?: boolean; reason?: string; error?: string }>(
    `/edge-sync/push?limit=${limit}`,
  );
}
