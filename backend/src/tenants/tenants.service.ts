import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantContext } from '../common/tenant/tenant-context';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';

export type TenantBranding = {
  tenantId: string;
  slug: string;
  brandName: string;
  logoUrl: string | null;
  accentColor: string | null;
};

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  current() {
    const tenant = TenantContext.require();
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      deploymentMode: tenant.deploymentMode,
      domain: tenant.domain,
      runtime: {
        processMode: this.config.deploymentMode,
        edgeSync: this.config.featureEdgeSync,
        licenseValidationMode: this.config.licenseValidationMode,
      },
    };
  }

  listStores() {
    // RLS + request transaction already pin tenant_id; extra where is belt-and-suspenders.
    const tenant = TenantContext.require();
    return this.prisma.db.store.findMany({
      where: { tenantId: tenant.id },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Public login chrome — resolved by host / X-Tenant-Slug, no JWT.
   * Falls back to Tenant.name when brandName is unset.
   */
  async branding(): Promise<TenantBranding> {
    const tenant = TenantContext.require();
    const settings = await this.prisma.db.tenantSetting.findUnique({
      where: { tenantId: tenant.id },
      select: { brandName: true, logoUrl: true, accentColor: true },
    });
    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      brandName: settings?.brandName?.trim() || tenant.name,
      logoUrl: settings?.logoUrl?.trim() || null,
      accentColor: settings?.accentColor?.trim() || null,
    };
  }

  async updateBranding(input: {
    brandName?: string | null;
    logoUrl?: string | null;
    accentColor?: string | null;
  }): Promise<TenantBranding> {
    const tenant = TenantContext.require();
    const data: {
      brandName?: string | null;
      logoUrl?: string | null;
      accentColor?: string | null;
    } = {};

    if ('brandName' in input) {
      data.brandName = this.normalizeOptionalText(input.brandName, 80);
    }
    if ('logoUrl' in input) {
      data.logoUrl = this.normalizeLogoUrl(input.logoUrl);
    }
    if ('accentColor' in input) {
      data.accentColor = this.normalizeAccent(input.accentColor);
    }

    await this.prisma.db.tenantSetting.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        brandName: data.brandName ?? null,
        logoUrl: data.logoUrl ?? null,
        accentColor: data.accentColor ?? null,
      },
      update: data,
    });

    return this.branding();
  }

  private normalizeOptionalText(value: string | null | undefined, max: number): string | null {
    if (value == null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > max) {
      throw new BadRequestException(`Text must be at most ${max} characters`);
    }
    return trimmed;
  }

  private normalizeLogoUrl(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > 500) {
      throw new BadRequestException('Logo URL is too long');
    }
    // Allow https CDN, http localhost for on-prem, and same-origin absolute paths.
    const ok =
      trimmed.startsWith('https://') ||
      trimmed.startsWith('http://localhost') ||
      trimmed.startsWith('http://127.0.0.1') ||
      trimmed.startsWith('/');
    if (!ok) {
      throw new BadRequestException('Logo URL must be https://, localhost, or a path starting with /');
    }
    if (/[\s<>"']/.test(trimmed) || trimmed.toLowerCase().includes('javascript:')) {
      throw new BadRequestException('Invalid logo URL');
    }
    return trimmed;
  }

  private normalizeAccent(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!HEX_COLOR.test(trimmed)) {
      throw new BadRequestException('Accent color must be hex #RRGGBB');
    }
    return trimmed.toLowerCase();
  }
}
