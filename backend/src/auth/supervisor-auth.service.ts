import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ActivityAction, SupervisorActionType, Prisma } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AuthContext } from './auth-context';
import {
  PIN_REQUIRED_PERMISSIONS,
  Permission,
  isSupervisorCapable,
  roleHasPermission,
  type StaffRole,
} from './permissions';
import { verifyPin } from './pin';

export type SupervisorAuthorization = {
  supervisorUserId: string;
  actionType: SupervisorActionType;
};

@Injectable()
export class SupervisorAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Actor must hold the permission to *request* the action.
   * For PIN-gated permissions, a supervisor-capable user must verify PIN.
   * Success/failure is written to the immutable activity log.
   */
  async authorizeSensitive(
    permission: Permission,
    actionType: SupervisorActionType,
    supervisorPin: string | undefined,
  ): Promise<SupervisorAuthorization> {
    const actor = AuthContext.require();
    if (!roleHasPermission(actor.role, permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }

    if (!PIN_REQUIRED_PERMISSIONS.has(permission)) {
      return { supervisorUserId: actor.id, actionType };
    }

    if (!supervisorPin) {
      throw new UnauthorizedException('Supervisor PIN is required for this action');
    }

    if (!/^\d{4,8}$/.test(supervisorPin)) {
      await this.audit.log({
        action: ActivityAction.SUPERVISOR_PIN_FAIL,
        reason: 'Invalid PIN shape',
        metadata: { permission, actionType },
      });
      throw new UnauthorizedException('Supervisor PIN must be 4–8 digits');
    }

    const tenant = TenantContext.require();
    const candidates = await this.prisma.db.user.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true,
        pinHash: { not: null },
        role: { in: ['SUPERVISOR', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN'] },
      },
    });

    for (const candidate of candidates) {
      if (!candidate.pinHash) {
        continue;
      }
      if (!isSupervisorCapable(candidate.role as StaffRole)) {
        continue;
      }
      if (!roleHasPermission(candidate.role as StaffRole, permission)) {
        continue;
      }
      if (verifyPin(supervisorPin, candidate.pinHash)) {
        await this.audit.log({
          action: ActivityAction.SUPERVISOR_PIN_OK,
          entityType: 'user',
          entityId: candidate.id,
          metadata: {
            permission,
            actionType,
            supervisorUserId: candidate.id,
            requesterUserId: actor.id,
          },
        });
        return { supervisorUserId: candidate.id, actionType };
      }
    }

    await this.audit.log({
      action: ActivityAction.SUPERVISOR_PIN_FAIL,
      reason: 'PIN mismatch',
      metadata: { permission, actionType },
    });
    throw new ForbiddenException('Invalid supervisor PIN');
  }

  async recordAction(input: {
    actionType: SupervisorActionType;
    supervisorUserId: string;
    shiftId?: string | null;
    saleId?: string | null;
    amountInCents?: number | null;
    reason?: string | null;
    metadata?: Prisma.InputJsonValue | null;
  }): Promise<void> {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    await this.prisma.db.supervisorAction.create({
      data: {
        tenantId: tenant.id,
        actionType: input.actionType,
        requesterUserId: actor.id,
        supervisorUserId: input.supervisorUserId,
        shiftId: input.shiftId ?? null,
        saleId: input.saleId ?? null,
        amountInCents: input.amountInCents ?? null,
        reason: input.reason ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  }
}
