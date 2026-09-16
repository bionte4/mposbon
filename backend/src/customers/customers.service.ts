import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

export type UpsertCustomerInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
};

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string, limit = 20) {
    const tenant = TenantContext.require();
    const query = q?.trim();
    if (!query) {
      return this.prisma.db.customer.findMany({
        where: { tenantId: tenant.id },
        orderBy: { updatedAt: 'desc' },
        take: Math.min(limit, 50),
      });
    }
    return this.prisma.db.customer.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: Math.min(limit, 50),
    });
  }

  async create(input: UpsertCustomerInput) {
    const tenant = TenantContext.require();
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException('name is required');
    }
    const phone = input.phone?.trim() || null;
    try {
      return await this.prisma.db.customer.create({
        data: {
          tenantId: tenant.id,
          name,
          phone,
          email: input.email?.trim() || null,
          notes: input.notes?.trim() || null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Customer phone already exists');
      }
      throw err;
    }
  }

  async get(id: string) {
    const tenant = TenantContext.require();
    const row = await this.prisma.db.customer.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!row) {
      throw new NotFoundException('Customer not found');
    }
    return row;
  }

  /** 1 loyalty point per Rp 10.000 of net sale (integer math). */
  static pointsForSaleTotal(totalInCents: number): number {
    if (!Number.isInteger(totalInCents) || totalInCents < 0) {
      return 0;
    }
    return Math.floor(totalInCents / 10_000);
  }
}
