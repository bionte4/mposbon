import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, ProductType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

export type UpsertRecipeInput = {
  productId: string;
  yieldQty?: number;
  note?: string | null;
  lines: Array<{
    ingredientProductId: string;
    qty: number;
    unitCostInCents?: number;
  }>;
};

export type StockConsumptionLine = {
  productId: string;
  productName: string;
  quantity: number;
};

@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listRecipes() {
    const tenant = TenantContext.require();
    return this.prisma.db.recipe.findMany({
      where: { tenantId: tenant.id },
      include: {
        product: { select: { id: true, sku: true, name: true, unitPriceInCents: true } },
        lines: {
          include: {
            ingredient: { select: { id: true, sku: true, name: true, productType: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getRecipeForProduct(productId: string) {
    const tenant = TenantContext.require();
    const recipe = await this.prisma.db.recipe.findFirst({
      where: { tenantId: tenant.id, productId },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        lines: {
          include: {
            ingredient: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });
    if (!recipe) throw new NotFoundException('Recipe not found');
    return recipe;
  }

  async upsertRecipe(input: UpsertRecipeInput) {
    const tenant = TenantContext.require();
    const product = await this.prisma.db.product.findFirst({
      where: { id: input.productId, tenantId: tenant.id },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.productType === ProductType.INGREDIENT) {
      throw new BadRequestException('Ingredient products cannot have a recipe');
    }
    const yieldQty = input.yieldQty ?? 1;
    if (!Number.isInteger(yieldQty) || yieldQty < 1) {
      throw new BadRequestException('yieldQty must be an integer >= 1');
    }
    if (!input.lines.length) {
      throw new BadRequestException('Recipe requires at least one ingredient line');
    }

    for (const line of input.lines) {
      if (!Number.isInteger(line.qty) || line.qty < 1) {
        throw new BadRequestException('Ingredient qty must be an integer >= 1');
      }
      if (line.ingredientProductId === input.productId) {
        throw new BadRequestException('Recipe cannot include itself as ingredient');
      }
      const ing = await this.prisma.db.product.findFirst({
        where: { id: line.ingredientProductId, tenantId: tenant.id },
      });
      if (!ing) throw new NotFoundException('Ingredient product not found');
    }

    const recipeId = randomUUID();
    const existing = await this.prisma.db.recipe.findFirst({
      where: { tenantId: tenant.id, productId: input.productId },
    });

    if (existing) {
      await this.prisma.db.recipeLine.deleteMany({
        where: { recipeId: existing.id, tenantId: tenant.id },
      });
      await this.prisma.db.recipe.update({
        where: { id: existing.id },
        data: {
          yieldQty,
          note: input.note?.trim() || null,
          product: { update: { productType: ProductType.MENU } },
        },
      });
      await this.prisma.db.recipeLine.createMany({
        data: input.lines.map((line) => ({
          id: randomUUID(),
          tenantId: tenant.id,
          recipeId: existing.id,
          ingredientProductId: line.ingredientProductId,
          qty: line.qty,
          unitCostInCents: line.unitCostInCents ?? 0,
        })),
      });
      return this.getRecipeForProduct(input.productId);
    }

    await this.prisma.db.recipe.create({
      data: {
        id: recipeId,
        tenantId: tenant.id,
        productId: input.productId,
        yieldQty,
        note: input.note?.trim() || null,
        lines: {
          create: input.lines.map((line) => ({
            id: randomUUID(),
            tenantId: tenant.id,
            ingredientProductId: line.ingredientProductId,
            qty: line.qty,
            unitCostInCents: line.unitCostInCents ?? 0,
          })),
        },
      },
    });
    await this.prisma.db.product.update({
      where: { id: input.productId },
      data: { productType: ProductType.MENU },
    });

    return this.getRecipeForProduct(input.productId);
  }

  /** HPP preview for admin / margin view (integer sen). */
  async previewCogs(productId: string, quantity = 1) {
    return {
      productId,
      quantity,
      cogsInCents: await this.calculateCogs(productId, quantity),
    };
  }

  async calculateCogs(productId: string, saleQty: number): Promise<number> {
    const tenant = TenantContext.require();
    if (!Number.isInteger(saleQty) || saleQty < 1) return 0;

    const recipe = await this.prisma.db.recipe.findFirst({
      where: { tenantId: tenant.id, productId },
      include: { lines: true },
    });
    if (!recipe) return 0;

    let total = 0;
    for (const line of recipe.lines) {
      // Integer math: ingredient qty per sale = line.qty * saleQty / yieldQty (ceil).
      const needQty = Math.ceil((line.qty * saleQty) / recipe.yieldQty);
      total += needQty * line.unitCostInCents;
    }
    return total;
  }

  /**
   * Expand sale lines into store-stock deductions.
   * Menu items with BOM consume ingredients; others consume the sold SKU.
   */
  async expandStockConsumption(
    lines: Array<{ productId: string; productName: string; quantity: number }>,
  ): Promise<StockConsumptionLine[]> {
    const tenant = TenantContext.require();
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const recipes = await this.prisma.db.recipe.findMany({
      where: { tenantId: tenant.id, productId: { in: productIds } },
      include: {
        lines: {
          include: { ingredient: { select: { id: true, name: true } } },
        },
      },
    });
    const recipeByProduct = new Map(recipes.map((r) => [r.productId, r]));
    const merged = new Map<string, StockConsumptionLine>();

    const add = (productId: string, productName: string, quantity: number) => {
      if (quantity <= 0) return;
      const prev = merged.get(productId);
      if (prev) {
        prev.quantity += quantity;
      } else {
        merged.set(productId, { productId, productName, quantity });
      }
    };

    for (const line of lines) {
      const recipe = recipeByProduct.get(line.productId);
      if (recipe?.lines.length) {
        for (const rl of recipe.lines) {
          const needQty = Math.ceil((rl.qty * line.quantity) / recipe.yieldQty);
          add(rl.ingredientProductId, rl.ingredient.name, needQty);
        }
      } else {
        add(line.productId, line.productName, line.quantity);
      }
    }

    return [...merged.values()];
  }

  async logRecipeConsume(
    saleId: string,
    consumptions: StockConsumptionLine[],
  ): Promise<void> {
    if (!consumptions.length) return;
    await this.audit.log({
      action: ActivityAction.RECIPE_CONSUME,
      entityType: 'sale',
      entityId: saleId,
      metadata: { lines: consumptions },
    });
  }
}
