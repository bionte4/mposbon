import { PrismaClient, DeploymentMode, TenantStatus, StaffRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hashPin } from '../src/auth/pin';

const url = process.env.DATABASE_MIGRATE_URL || process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_MIGRATE_URL or DATABASE_URL is required to seed');
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

const deploymentMode: DeploymentMode =
  process.env.DEPLOYMENT_MODE === 'onprem' ? DeploymentMode.ONPREM : DeploymentMode.CLOUD;

const slug = process.env.DEFAULT_TENANT_SLUG || 'onprem-store';
const name =
  deploymentMode === DeploymentMode.ONPREM ? 'On-Premises Store' : 'Demo Cloud Tenant';

/** Demo supervisor PIN — change in production. Seeded as scrypt hash only. */
const DEMO_SUPERVISOR_PIN = process.env.SEED_SUPERVISOR_PIN || '1234';

async function main(): Promise<void> {
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  const tenantId = existing?.id ?? randomUUID();

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: { name, deploymentMode, status: TenantStatus.ACTIVE },
    create: {
      id: tenantId,
      slug,
      name,
      domain: null,
      status: TenantStatus.ACTIVE,
      deploymentMode,
    },
  });

  await prisma.tenantSetting.upsert({
    where: { tenantId: tenant.id },
    update: {
      edgeSyncEnabled: true,
    },
    create: {
      tenantId: tenant.id,
      currencyCode: 'IDR',
      timezone: 'Asia/Jakarta',
      edgeSyncEnabled: true,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@bonpos.local' } },
    update: {
      role: StaffRole.TENANT_ADMIN,
      pinHash: hashPin(DEMO_SUPERVISOR_PIN),
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      email: 'admin@bonpos.local',
      displayName: 'Tenant Admin',
      role: StaffRole.TENANT_ADMIN,
      pinHash: hashPin(DEMO_SUPERVISOR_PIN),
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'supervisor@bonpos.local' } },
    update: {
      role: StaffRole.SUPERVISOR,
      pinHash: hashPin(DEMO_SUPERVISOR_PIN),
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      email: 'supervisor@bonpos.local',
      displayName: 'Supervisor',
      role: StaffRole.SUPERVISOR,
      pinHash: hashPin(DEMO_SUPERVISOR_PIN),
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'cashier@bonpos.local' } },
    update: {
      role: StaffRole.CASHIER,
      isActive: true,
      pinHash: hashPin(DEMO_SUPERVISOR_PIN),
    },
    create: {
      tenantId: tenant.id,
      email: 'cashier@bonpos.local',
      displayName: 'Kasir Utama',
      role: StaffRole.CASHIER,
      pinHash: hashPin(DEMO_SUPERVISOR_PIN),
    },
  });

  await prisma.store.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'MAIN' } },
    update: {},
    create: {
      tenantId: tenant.id,
      code: 'MAIN',
      name: 'Main Outlet',
    },
  });

  await prisma.store.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'BRANCH' } },
    update: { name: 'Cabang Timur' },
    create: {
      tenantId: tenant.id,
      code: 'BRANCH',
      name: 'Cabang Timur',
    },
  });

  if (deploymentMode === DeploymentMode.CLOUD) {
    const other = await prisma.tenant.upsert({
      where: { slug: 'demo-b' },
      update: {},
      create: {
        slug: 'demo-b',
        name: 'Demo Tenant B',
        status: TenantStatus.ACTIVE,
        deploymentMode: DeploymentMode.CLOUD,
      },
    });
    await prisma.tenantSetting.upsert({
      where: { tenantId: other.id },
      update: {},
      create: { tenantId: other.id },
    });
    await prisma.store.upsert({
      where: { tenantId_code: { tenantId: other.id, code: 'MAIN' } },
      update: {},
      create: { tenantId: other.id, code: 'MAIN', name: 'Tenant B Outlet' },
    });
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: other.id, email: 'cashier@demo-b.local' } },
      update: {},
      create: {
        tenantId: other.id,
        email: 'cashier@demo-b.local',
        displayName: 'Tenant B Cashier',
        role: StaffRole.CASHIER,
      },
    });
  }

  console.log(`Seeded tenant slug=${tenant.slug} id=${tenant.id} mode=${deploymentMode}`);
  console.log(`Demo supervisor PIN (dev only): ${DEMO_SUPERVISOR_PIN}`);
  await seedPosCatalog(tenant.id);
  await seedHris(tenant.id);
  await seedAnalytics(tenant.id);
}

async function seedHris(tenantId: string): Promise<void> {
  const store = await prisma.store.findFirst({
    where: { tenantId, code: 'MAIN' },
  });
  const cashier = await prisma.user.findFirst({
    where: { tenantId, email: 'cashier@bonpos.local' },
  });
  const manager = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: 'manager@bonpos.local' } },
    update: {
      role: StaffRole.MANAGER,
      pinHash: hashPin(DEMO_SUPERVISOR_PIN),
      isActive: true,
    },
    create: {
      tenantId,
      email: 'manager@bonpos.local',
      displayName: 'Store Manager',
      role: StaffRole.MANAGER,
      pinHash: hashPin(DEMO_SUPERVISOR_PIN),
    },
  });

  const pagi = await prisma.workShift.upsert({
    where: { tenantId_code: { tenantId, code: 'PAGI' } },
    update: {},
    create: {
      tenantId,
      code: 'PAGI',
      name: 'Shift Pagi',
      startMinutes: 8 * 60,
      endMinutes: 16 * 60,
      breakMinutes: 60,
      standardMinutes: 7 * 60,
    },
  });
  await prisma.workShift.upsert({
    where: { tenantId_code: { tenantId, code: 'MALAM' } },
    update: {},
    create: {
      tenantId,
      code: 'MALAM',
      name: 'Shift Malam',
      startMinutes: 16 * 60,
      endMinutes: 24 * 60,
      breakMinutes: 60,
      standardMinutes: 7 * 60,
    },
  });

  const employee = await prisma.employee.upsert({
    where: { tenantId_employeeCode: { tenantId, employeeCode: 'EMP-001' } },
    update: {
      baseSalaryInCents: 4_500_000,
      workShiftId: pagi.id,
      userId: cashier?.id ?? null,
      storeId: store?.id ?? null,
    },
    create: {
      tenantId,
      employeeCode: 'EMP-001',
      fullName: 'Kasir Utama',
      email: 'cashier@bonpos.local',
      hireDate: new Date('2024-01-15'),
      baseSalaryInCents: 4_500_000,
      ptkpStatus: 'TK0',
      workShiftId: pagi.id,
      userId: cashier?.id ?? null,
      storeId: store?.id ?? null,
    },
  });

  await prisma.employee.upsert({
    where: { tenantId_employeeCode: { tenantId, employeeCode: 'EMP-MGR' } },
    update: {
      baseSalaryInCents: 8_000_000,
      userId: manager.id,
      storeId: store?.id ?? null,
    },
    create: {
      tenantId,
      employeeCode: 'EMP-MGR',
      fullName: 'Store Manager',
      email: 'manager@bonpos.local',
      hireDate: new Date('2023-06-01'),
      baseSalaryInCents: 8_000_000,
      ptkpStatus: 'K1',
      userId: manager.id,
      storeId: store?.id ?? null,
      workShiftId: pagi.id,
    },
  });

  // Sample attendance with overtime for payroll demo
  const workDate = new Date();
  workDate.setUTCHours(0, 0, 0, 0);
  const clockIn = new Date(workDate);
  clockIn.setUTCHours(1, 0, 0, 0); // 08:00 WIB ≈ depends on TZ; minutes delta matters
  const clockOut = new Date(workDate);
  clockOut.setUTCHours(10, 0, 0, 0); // 9 hours → 60 min OT vs 7h standard

  await prisma.attendance.upsert({
    where: {
      tenantId_employeeId_workDate: {
        tenantId,
        employeeId: employee.id,
        workDate,
      },
    },
    update: {
      clockInAt: clockIn,
      clockOutAt: clockOut,
      workedMinutes: 9 * 60,
      scheduledMinutes: 7 * 60,
      overtimeMinutes: 60,
      status: 'PRESENT',
      workShiftId: pagi.id,
    },
    create: {
      tenantId,
      employeeId: employee.id,
      workShiftId: pagi.id,
      workDate,
      clockInAt: clockIn,
      clockOutAt: clockOut,
      status: 'PRESENT',
      scheduledMinutes: 7 * 60,
      workedMinutes: 9 * 60,
      overtimeMinutes: 60,
      notes: 'Seed sample with 1h overtime',
    },
  });
}

async function seedAnalytics(tenantId: string): Promise<void> {
  const store = await prisma.store.findFirst({ where: { tenantId, code: 'MAIN' } });
  if (!store) {
    return;
  }
  const products = await prisma.product.findMany({
    where: { tenantId },
    take: 4,
    orderBy: { name: 'asc' },
  });

  for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - daysAgo);

    const trx = 8 + ((6 - daysAgo) % 5);
    const gross = 250_000 + daysAgo * 35_000;
    const discount = 5_000;
    const net = gross - discount;

    await prisma.dailySalesSummary.upsert({
      where: {
        tenantId_storeId_summaryDate: {
          tenantId,
          storeId: store.id,
          summaryDate: d,
        },
      },
      update: {
        grossSalesInCents: gross,
        discountInCents: discount,
        voidInCents: 0,
        netSalesInCents: net,
        transactionCount: trx,
        cashInCents: Math.floor(net * 0.6),
        cardInCents: Math.floor(net * 0.25),
        qrisInCents: Math.floor(net * 0.15),
        otherInCents: 0,
      },
      create: {
        tenantId,
        storeId: store.id,
        summaryDate: d,
        grossSalesInCents: gross,
        discountInCents: discount,
        voidInCents: 0,
        netSalesInCents: net,
        transactionCount: trx,
        cashInCents: Math.floor(net * 0.6),
        cardInCents: Math.floor(net * 0.25),
        qrisInCents: Math.floor(net * 0.15),
        otherInCents: 0,
      },
    });

    for (const [idx, product] of products.entries()) {
      const qty = 3 + idx + (6 - daysAgo);
      const revenue = qty * product.unitPriceInCents;
      await prisma.dailyProductSummary.upsert({
        where: {
          tenantId_storeId_productId_summaryDate: {
            tenantId,
            storeId: store.id,
            productId: product.id,
            summaryDate: d,
          },
        },
        update: {
          quantitySold: qty,
          revenueInCents: revenue,
          productName: product.name,
        },
        create: {
          tenantId,
          storeId: store.id,
          productId: product.id,
          productName: product.name,
          summaryDate: d,
          quantitySold: qty,
          revenueInCents: revenue,
        },
      });
    }
  }
}

async function seedPosCatalog(tenantId: string): Promise<void> {
  const drinks = await prisma.category.upsert({
    where: { tenantId_name: { tenantId, name: 'Minuman' } },
    update: {},
    create: { tenantId, name: 'Minuman', sortOrder: 1 },
  });
  const food = await prisma.category.upsert({
    where: { tenantId_name: { tenantId, name: 'Makanan' } },
    update: {},
    create: { tenantId, name: 'Makanan', sortOrder: 2 },
  });

  const items: Array<{
    sku: string;
    barcode: string;
    name: string;
    categoryId: string;
    unitPriceInCents: number;
    taxBps: number;
    stockQty: number;
  }> = [
    { sku: 'DRINK-KOPI', barcode: '8991001001', name: 'Kopi Tubruk', categoryId: drinks.id, unitPriceInCents: 15000, taxBps: 1100, stockQty: 100 },
    { sku: 'DRINK-TEH', barcode: '8991001002', name: 'Teh Manis', categoryId: drinks.id, unitPriceInCents: 8000, taxBps: 1100, stockQty: 100 },
    { sku: 'FOOD-NASI', barcode: '8991002001', name: 'Nasi Goreng', categoryId: food.id, unitPriceInCents: 25000, taxBps: 1100, stockQty: 50 },
    { sku: 'FOOD-MIE', barcode: '8991002002', name: 'Mie Goreng', categoryId: food.id, unitPriceInCents: 18000, taxBps: 0, stockQty: 50 },
  ];

  for (const item of items) {
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId, sku: item.sku } },
      update: {
        name: item.name,
        barcode: item.barcode,
        unitPriceInCents: item.unitPriceInCents,
        taxBps: item.taxBps,
      },
      create: { tenantId, ...item, isActive: true },
    });
  }

  const kopi = await prisma.product.findFirst({
    where: { tenantId, sku: 'DRINK-KOPI' },
  });
  if (kopi) {
    const existingGroup = await prisma.productModifierGroup.findFirst({
      where: { tenantId, productId: kopi.id, name: 'Ukuran' },
    });
    if (!existingGroup) {
      await prisma.productModifierGroup.create({
        data: {
          tenantId,
          productId: kopi.id,
          name: 'Ukuran',
          minSelect: 1,
          maxSelect: 1,
          sortOrder: 0,
          options: {
            create: [
              { tenantId, name: 'Regular', priceDeltaInCents: 0, sortOrder: 0 },
              { tenantId, name: 'Large', priceDeltaInCents: 3000, sortOrder: 1 },
            ],
          },
        },
      });
      await prisma.productModifierGroup.create({
        data: {
          tenantId,
          productId: kopi.id,
          name: 'Extra',
          minSelect: 0,
          maxSelect: 2,
          sortOrder: 1,
          options: {
            create: [
              { tenantId, name: 'Extra shot', priceDeltaInCents: 5000, sortOrder: 0 },
              { tenantId, name: 'Oat milk', priceDeltaInCents: 4000, sortOrder: 1 },
            ],
          },
        },
      });
    }
  }

  await prisma.customer.upsert({
    where: { tenantId_phone: { tenantId, phone: '081234567890' } },
    update: { name: 'Budi Pelanggan' },
    create: {
      tenantId,
      name: 'Budi Pelanggan',
      phone: '081234567890',
      loyaltyPoints: 12,
    },
  });

  const stores = await prisma.store.findMany({ where: { tenantId } });
  const allProducts = await prisma.product.findMany({ where: { tenantId } });
  for (const store of stores) {
    for (const product of allProducts) {
      const qty = store.code === 'BRANCH' ? Math.max(5, Math.floor(product.stockQty / 2)) : product.stockQty;
      await prisma.storeStock.upsert({
        where: {
          tenantId_storeId_productId: {
            tenantId,
            storeId: store.id,
            productId: product.id,
          },
        },
        update: { qty },
        create: { tenantId, storeId: store.id, productId: product.id, qty },
      });
    }
  }

  const branch = stores.find((s) => s.code === 'BRANCH');
  const kopiForPrice = allProducts.find((p) => p.sku === 'DRINK-KOPI');
  if (branch && kopiForPrice) {
    // Branch price list: kopi slightly higher.
    await prisma.storePrice.upsert({
      where: {
        tenantId_storeId_productId: {
          tenantId,
          storeId: branch.id,
          productId: kopiForPrice.id,
        },
      },
      update: { unitPriceInCents: 17000 },
      create: {
        tenantId,
        storeId: branch.id,
        productId: kopiForPrice.id,
        unitPriceInCents: 17000,
      },
    });
  }

  await prisma.tenantSetting.update({
    where: { tenantId },
    data: { edgeSyncEnabled: true },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
