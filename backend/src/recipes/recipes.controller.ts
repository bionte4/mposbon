import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac.guard';
import { RecipesService, UpsertRecipeInput } from './recipes.service';

@Controller('recipes')
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get()
  @RequirePermissions('admin.inventory.read')
  list() {
    return this.recipes.listRecipes();
  }

  @Get('product/:productId')
  @RequirePermissions('admin.inventory.read')
  getByProduct(@Param('productId') productId: string) {
    return this.recipes.getRecipeForProduct(productId);
  }

  @Get('product/:productId/cogs')
  @RequirePermissions('admin.inventory.read')
  previewCogs(
    @Param('productId') productId: string,
    @Query('qty') qty?: string,
  ) {
    return this.recipes.previewCogs(
      productId,
      qty ? Number.parseInt(qty, 10) : 1,
    );
  }

  @Post()
  @RequirePermissions('admin.inventory.write')
  upsert(@Body() body: UpsertRecipeInput) {
    return this.recipes.upsertRecipe(body);
  }
}
