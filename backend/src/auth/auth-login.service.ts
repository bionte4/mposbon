import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaAdminService } from '../common/prisma/prisma-admin.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { permissionsForRole, type StaffRole } from './permissions';
import { verifyPin } from './pin';
import { signAccessToken } from './jwt';

@Injectable()
export class AuthLoginService {
  constructor(private readonly prismaAdmin: PrismaAdminService) {}

  /**
   * Staff login: email + PIN within resolved tenant.
   * Uses admin Prisma client so RLS GUC is not required before AuthContext exists.
   */
  async login(input: { email: string; pin: string }) {
    const tenant = TenantContext.require();
    const email = input.email?.trim().toLowerCase();
    if (!email || !input.pin) {
      throw new BadRequestException('email and pin are required');
    }

    const user = await this.prismaAdmin.user.findFirst({
      where: { tenantId: tenant.id, email, isActive: true },
      include: { kitchenStations: { select: { stationId: true } } },
    });
    if (!user || !user.pinHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!verifyPin(input.pin, user.pinHash)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const role = user.role as StaffRole;
    const kitchenStationIds = user.kitchenStations.map((r) => r.stationId);
    const accessToken = signAccessToken({
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSec: 60 * 60 * 12,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role,
        permissions: permissionsForRole(role),
        kitchenStationIds,
      },
    };
  }
}
