import { apiGet, apiPost } from '../api/client';

export type RecipeLine = {
  id: string;
  qty: number;
  unitCostInCents: number;
  ingredient: { id: string; sku: string; name: string; productType: string };
};

export type Recipe = {
  id: string;
  productId: string;
  yieldQty: number;
  note: string | null;
  product: { id: string; sku: string; name: string; unitPriceInCents: number };
  lines: RecipeLine[];
};

export function fetchRecipes(): Promise<Recipe[]> {
  return apiGet('/recipes');
}

export function fetchRecipeForProduct(productId: string): Promise<Recipe> {
  return apiGet(`/recipes/product/${productId}`);
}

export function previewCogs(productId: string, qty = 1): Promise<{ cogsInCents: number }> {
  return apiGet(`/recipes/product/${productId}/cogs?qty=${qty}`);
}

export function upsertRecipe(body: {
  productId: string;
  yieldQty?: number;
  note?: string | null;
  lines: Array<{ ingredientProductId: string; qty: number; unitCostInCents?: number }>;
}): Promise<Recipe> {
  return apiPost('/recipes', body);
}
