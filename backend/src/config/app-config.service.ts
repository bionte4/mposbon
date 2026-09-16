import { Injectable } from '@nestjs/common';
import { parseCorsAllowlist } from '../common/cors/cors-allowlist';

export type DeploymentMode = 'cloud' | 'onprem';
export type LicenseValidationMode = 'online' | 'offline';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return raw === 'true' || raw === '1';
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

@Injectable()
export class AppConfigService {
  readonly nodeEnv = optional('NODE_ENV', 'development');
  readonly deploymentMode: DeploymentMode =
    optional('DEPLOYMENT_MODE', 'cloud') === 'onprem' ? 'onprem' : 'cloud';
  readonly appPort = int('APP_PORT', 3000);
  readonly frontendUrl = optional('FRONTEND_URL', 'http://localhost:5173');
  readonly apiUrl = optional('API_URL', 'http://localhost:3000');
  readonly corsOrigins: string[];
  readonly databaseUrl: string;
  readonly databaseMigrateUrl: string;
  readonly defaultTenantSlug: string;
  readonly defaultTenantId: string | null;
  readonly tenantHostBase: string;
  readonly licenseValidationMode: LicenseValidationMode;
  readonly licenseKey: string;
  readonly licenseOfflineGraceHours: number;
  readonly featureEdgeSync: boolean;
  readonly featureHris: boolean;
  readonly featureOfflinePos: boolean;

  constructor() {
    this.databaseUrl = required('DATABASE_URL');
    this.databaseMigrateUrl = optional('DATABASE_MIGRATE_URL', this.databaseUrl);
    this.corsOrigins = parseCorsAllowlist(
      this.frontendUrl,
      optional('CORS_ORIGINS'),
    );
    this.defaultTenantSlug = optional('DEFAULT_TENANT_SLUG', 'onprem-store');
    this.defaultTenantId = optional('DEFAULT_TENANT_ID') || null;
    this.tenantHostBase = optional('TENANT_HOST_BASE', 'bonpos.local');
    this.licenseValidationMode =
      optional('LICENSE_VALIDATION_MODE', 'online') === 'offline' ? 'offline' : 'online';
    this.licenseKey = optional('LICENSE_KEY');
    this.licenseOfflineGraceHours = int('LICENSE_OFFLINE_GRACE_HOURS', 72);
    this.featureEdgeSync = bool('FEATURE_EDGE_SYNC', this.deploymentMode === 'onprem');
    this.featureHris = bool('FEATURE_HRIS', false);
    this.featureOfflinePos = bool('FEATURE_OFFLINE_POS', true);
  }

  get isCloud(): boolean {
    return this.deploymentMode === 'cloud';
  }

  get isOnPrem(): boolean {
    return this.deploymentMode === 'onprem';
  }
}
