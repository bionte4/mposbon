export const env = {
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1',
  deploymentMode: (import.meta.env.VITE_DEPLOYMENT_MODE ?? 'cloud') as 'cloud' | 'onprem',
  defaultTenantSlug: import.meta.env.VITE_DEFAULT_TENANT_SLUG ?? 'onprem-store',
};

export function tenantSlugForRequest(): string {
  if (env.deploymentMode === 'onprem') {
    return env.defaultTenantSlug;
  }
  const host = window.location.hostname;
  const parts = host.split('.');
  if (parts.length > 2) {
    return parts[0];
  }
  return env.defaultTenantSlug;
}
