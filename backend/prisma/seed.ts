import {
  PrismaClient,
  DeploymentMode,
  TenantStatus,
  StaffRole,
  ProductType,
  GlAccountType,
} from '@prisma/client';
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

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'kitchen@bonpos.local' } },
    update: {
      role: StaffRole.KITCHEN,
      isActive: true,
      pinHash: hashPin(DEMO_SUPERVISOR_PIN),
      displayName: 'Chef Dapur',
    },
    create: {
      tenantId: tenant.id,
      email: 'kitchen@bonpos.local',
      displayName: 'Chef Dapur',
      role: StaffRole.KITCHEN,
      pinHash: hashPin(DEMO_SUPERVISOR_PIN),
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'bar@bonpos.local' } },
    update: {
      role: StaffRole.KITCHEN,
      isActive: true,
      pinHash: hashPin(DEMO_SUPERVISOR_PIN),
      displayName: 'Barista Bar',
    },
    create: {
      tenantId: tenant.id,
      email: 'bar@bonpos.local',
      displayName: 'Barista Bar',
      role: StaffRole.KITCHEN,
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
  await seedDiningTables(tenant.id);
  await seedRecipesAndKitchen(tenant.id);
  await seedVariantsAndGl(tenant.id);
  await seedHris(tenant.id);
  await seedAnalytics(tenant.id);
}

async function seedVariantsAndGl(tenantId: string): Promise<void> {
  const stores = await prisma.store.findMany({ where: { tenantId } });
  const tee = await prisma.product.findFirst({
    where: { tenantId, sku: 'DRINK-TEH' },
  });
  if (stores.length && tee) {
    const variants = [
      { sku: 'DRINK-TEH-R', name: 'Regular', price: 8000, qty: 40, sort: 1 },
      { sku: 'DRINK-TEH-L', name: 'Large', price: 12000, qty: 25, sort: 2 },
    ];
    for (const v of variants) {
      const row = await prisma.productVariant.upsert({
        where: { tenantId_sku: { tenantId, sku: v.sku } },
        update: {
          name: v.name,
          unitPriceInCents: v.price,
          sortOrder: v.sort,
          isActive: true,
          productId: tee.id,
        },
        create: {
          tenantId,
          productId: tee.id,
          sku: v.sku,
          name: v.name,
          unitPriceInCents: v.price,
          sortOrder: v.sort,
        },
      });
      for (const store of stores) {
        await prisma.storeVariantStock.upsert({
          where: {
            tenantId_storeId_variantId: {
              tenantId,
              storeId: store.id,
              variantId: row.id,
            },
          },
          update: { qty: store.code === 'MAIN' ? v.qty : Math.max(5, Math.floor(v.qty / 2)) },
          create: {
            tenantId,
            storeId: store.id,
            variantId: row.id,
            qty: store.code === 'MAIN' ? v.qty : Math.max(5, Math.floor(v.qty / 2)),
          },
        });
      }
    }
  }

  const accounts: Array<{ code: string; name: string; type: GlAccountType }> = [
    { code: '1100', name: 'Cash on hand', type: GlAccountType.ASSET },
    { code: '1120', name: 'Card clearing', type: GlAccountType.ASSET },
    { code: '1130', name: 'QRIS clearing', type: GlAccountType.ASSET },
    { code: '1190', name: 'Other tender clearing', type: GlAccountType.ASSET },
    { code: '1300', name: 'Inventory on hand', type: GlAccountType.ASSET },
    { code: '1310', name: 'Inventory in transit', type: GlAccountType.ASSET },
    { code: '2100', name: 'Output tax payable', type: GlAccountType.LIABILITY },
    { code: '2200', name: 'Tips payable', type: GlAccountType.LIABILITY },
    { code: '4000', name: 'POS sales revenue', type: GlAccountType.REVENUE },
    { code: '4900', name: 'Sales discounts', type: GlAccountType.EXPENSE },
    { code: '5000', name: 'Cost of goods sold', type: GlAccountType.EXPENSE },
  ];
  for (const a of accounts) {
    await prisma.glAccount.upsert({
      where: { tenantId_code: { tenantId, code: a.code } },
      update: { name: a.name, type: a.type, isActive: true },
      create: {
        tenantId,
        code: a.code,
        name: a.name,
        type: a.type,
      },
    });
  }
}

async function seedDiningTables(tenantId: string): Promise<void> {
  const store = await prisma.store.findFirst({
    where: { tenantId, code: 'MAIN' },
  });
  if (!store) return;

  const indoor = await prisma.tableArea.upsert({
    where: { id: '00000000-0000-4000-8000-000000000101' },
    update: { name: 'Indoor', sortOrder: 1, isActive: true },
    create: {
      id: '00000000-0000-4000-8000-000000000101',
      tenantId,
      storeId: store.id,
      name: 'Indoor',
      sortOrder: 1,
    },
  });

  const outdoor = await prisma.tableArea.upsert({
    where: { id: '00000000-0000-4000-8000-000000000102' },
    update: { name: 'Outdoor', sortOrder: 2, isActive: true },
    create: {
      id: '00000000-0000-4000-8000-000000000102',
      tenantId,
      storeId: store.id,
      name: 'Outdoor',
      sortOrder: 2,
    },
  });

  const tables: Array<{ code: string; name: string; areaId: string; capacity: number; sortOrder: number }> =
    [
      { code: 'T01', name: 'Meja 1', areaId: indoor.id, capacity: 2, sortOrder: 1 },
      { code: 'T02', name: 'Meja 2', areaId: indoor.id, capacity: 4, sortOrder: 2 },
      { code: 'T03', name: 'Meja 3', areaId: indoor.id, capacity: 4, sortOrder: 3 },
      { code: 'T04', name: 'Meja 4', areaId: indoor.id, capacity: 6, sortOrder: 4 },
      { code: 'T05', name: 'Meja 5', areaId: outdoor.id, capacity: 4, sortOrder: 1 },
      { code: 'T06', name: 'Meja 6', areaId: outdoor.id, capacity: 4, sortOrder: 2 },
    ];

  for (const row of tables) {
    await prisma.diningTable.upsert({
      where: {
        tenantId_storeId_code: { tenantId, storeId: store.id, code: row.code },
      },
      update: {
        name: row.name,
        areaId: row.areaId,
        capacity: row.capacity,
        sortOrder: row.sortOrder,
        isActive: true,
      },
      create: {
        tenantId,
        storeId: store.id,
        areaId: row.areaId,
        code: row.code,
        name: row.name,
        capacity: row.capacity,
        sortOrder: row.sortOrder,
      },
    });
  }
}

async function seedRecipesAndKitchen(tenantId: string): Promise<void> {
  const store = await prisma.store.findFirst({ where: { tenantId, code: 'MAIN' } });
  if (!store) return;

  const bar = await prisma.kitchenStation.upsert({
    where: {
      tenantId_storeId_code: { tenantId, storeId: store.id, code: 'BAR' },
    },
    update: { name: 'Bar / Minuman', sortOrder: 1, isActive: true },
    create: {
      tenantId,
      storeId: store.id,
      code: 'BAR',
      name: 'Bar / Minuman',
      sortOrder: 1,
    },
  });

  const kitchen = await prisma.kitchenStation.upsert({
    where: {
      tenantId_storeId_code: { tenantId, storeId: store.id, code: 'KITCHEN' },
    },
    update: { name: 'Dapur', sortOrder: 2, isActive: true },
    create: {
      tenantId,
      storeId: store.id,
      code: 'KITCHEN',
      name: 'Dapur',
      sortOrder: 2,
    },
  });

  const drinks = await prisma.category.findFirst({
    where: { tenantId, name: 'Minuman' },
  });
  const food = await prisma.category.findFirst({
    where: { tenantId, name: 'Makanan' },
  });
  if (!drinks || !food) return;

  const ingredientDefs = [
    { sku: 'ING-KOPI-BUBUK', name: 'Kopi Bubuk', categoryId: drinks.id, stockQty: 5000, cost: 50 },
    { sku: 'ING-GULA', name: 'Gula', categoryId: drinks.id, stockQty: 10000, cost: 15 },
    { sku: 'ING-TEH', name: 'Teh Celup', categoryId: drinks.id, stockQty: 8000, cost: 20 },
    { sku: 'ING-BERAS', name: 'Beras', categoryId: food.id, stockQty: 20000, cost: 12 },
    { sku: 'ING-MIE', name: 'Mie Basah', categoryId: food.id, stockQty: 5000, cost: 80 },
    { sku: 'ING-BUMBU', name: 'Bumbu Nasi Goreng', categoryId: food.id, stockQty: 3000, cost: 40 },
  ];

  const ingredients = new Map<string, string>();
  for (const ing of ingredientDefs) {
    const row = await prisma.product.upsert({
      where: { tenantId_sku: { tenantId, sku: ing.sku } },
      update: {
        name: ing.name,
        productType: ProductType.INGREDIENT,
        stockQty: ing.stockQty,
        isActive: true,
      },
      create: {
        tenantId,
        categoryId: ing.categoryId,
        sku: ing.sku,
        name: ing.name,
        productType: ProductType.INGREDIENT,
        unitPriceInCents: 0,
        taxBps: 0,
        stockQty: ing.stockQty,
      },
    });
    ingredients.set(ing.sku, row.id);
    await prisma.storeStock.upsert({
      where: {
        tenantId_storeId_productId: { tenantId, storeId: store.id, productId: row.id },
      },
      update: { qty: ing.stockQty },
      create: { tenantId, storeId: store.id, productId: row.id, qty: ing.stockQty },
    });
  }

  const menuUpdates: Array<{ sku: string; stationId: string; type: ProductType }> = [
    { sku: 'DRINK-KOPI', stationId: bar.id, type: ProductType.MENU },
    { sku: 'DRINK-TEH', stationId: bar.id, type: ProductType.MENU },
    { sku: 'FOOD-NASI', stationId: kitchen.id, type: ProductType.MENU },
    { sku: 'FOOD-MIE', stationId: kitchen.id, type: ProductType.MENU },
  ];

  const menuProducts = new Map<string, string>();
  for (const m of menuUpdates) {
    const p = await prisma.product.update({
      where: { tenantId_sku: { tenantId, sku: m.sku } },
      data: { productType: m.type, kitchenStationId: m.stationId },
    });
    menuProducts.set(m.sku, p.id);
  }

  const kopiId = menuProducts.get('DRINK-KOPI');
  const nasiId = menuProducts.get('FOOD-NASI');
  if (kopiId) {
    const recipe = await prisma.recipe.upsert({
      where: { productId: kopiId },
      update: { yieldQty: 1, note: 'Demo BOM kopi tubruk' },
      create: { tenantId, productId: kopiId, yieldQty: 1, note: 'Demo BOM kopi tubruk' },
    });
    const lines = [
      { sku: 'ING-KOPI-BUBUK', qty: 15, cost: 50 },
      { sku: 'ING-GULA', qty: 10, cost: 15 },
    ];
    for (const line of lines) {
      const ingId = ingredients.get(line.sku)!;
      await prisma.recipeLine.upsert({
        where: {
          tenantId_recipeId_ingredientProductId: {
            tenantId,
            recipeId: recipe.id,
            ingredientProductId: ingId,
          },
        },
        update: { qty: line.qty, unitCostInCents: line.cost },
        create: {
          tenantId,
          recipeId: recipe.id,
          ingredientProductId: ingId,
          qty: line.qty,
          unitCostInCents: line.cost,
        },
      });
    }
  }

  if (nasiId) {
    const recipe = await prisma.recipe.upsert({
      where: { productId: nasiId },
      update: { yieldQty: 1, note: 'Demo BOM nasi goreng' },
      create: { tenantId, productId: nasiId, yieldQty: 1, note: 'Demo BOM nasi goreng' },
    });
    const lines = [
      { sku: 'ING-BERAS', qty: 200, cost: 12 },
      { sku: 'ING-BUMBU', qty: 30, cost: 40 },
    ];
    for (const line of lines) {
      const ingId = ingredients.get(line.sku)!;
      await prisma.recipeLine.upsert({
        where: {
          tenantId_recipeId_ingredientProductId: {
            tenantId,
            recipeId: recipe.id,
            ingredientProductId: ingId,
          },
        },
        update: { qty: line.qty, unitCostInCents: line.cost },
        create: {
          tenantId,
          recipeId: recipe.id,
          ingredientProductId: ingId,
          qty: line.qty,
          unitCostInCents: line.cost,
        },
      });
    }
  }

  // Assign KDS staff to stations (kitchen vs bar).
  const chef = await prisma.user.findFirst({
    where: { tenantId, email: 'kitchen@bonpos.local' },
  });
  const barista = await prisma.user.findFirst({
    where: { tenantId, email: 'bar@bonpos.local' },
  });
  if (chef) {
    await prisma.userKitchenStation.deleteMany({ where: { userId: chef.id } });
    await prisma.userKitchenStation.create({
      data: { tenantId, userId: chef.id, stationId: kitchen.id },
    });
  }
  if (barista) {
    await prisma.userKitchenStation.deleteMany({ where: { userId: barista.id } });
    await prisma.userKitchenStation.create({
      data: { tenantId, userId: barista.id, stationId: bar.id },
    });
  }
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
