# BonPOS — ERD / RDBMS

Sumber kebenaran skema: [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).  
Database: **PostgreSQL 16**, multi-tenant shared-schema (`tenant_id` + **RLS**).

## Prinsip data

| Aturan | Implementasi |
|--------|----------------|
| Multi-tenancy | Hampir semua tabel punya `tenant_id` → `tenants`; isolasi via RLS |
| Uang | Integer **sen** (`*InCents`) — tidak pakai `float` |
| Pajak / promo % | Basis points (`*Bps`, e.g. 1100 = 11%) |
| Soft isolation toko | `store_id` pada stok, harga, shift, KDS, meja, PO, dll. |
| On-prem sync | `edge_sync_outbox` + `edge_sync_cursors` |

**56 tabel** · diagram Mermaid per domain (syntax GitHub-compatible: kunci `PK, FK` dengan koma).

---

## 1. Tenancy & outlet

```mermaid
erDiagram
  tenants ||--o| tenant_settings : "has"
  tenants ||--o{ stores : "owns"
  tenants ||--o{ users : "employs"

  tenants {
    uuid id PK
    string slug UK
    string name
    string domain
    string status
    string deployment_mode
  }

  tenant_settings {
    uuid tenant_id PK, FK
    string currency_code
    string timezone
    boolean edge_sync_enabled
    string brand_name
    string logo_url
    string accent_color
  }

  stores {
    uuid id PK
    uuid tenant_id FK
    string code
    string name
    string timezone
    string qris_payload
  }

  users {
    uuid id PK
    uuid tenant_id FK
    string email
    string display_name
    string role
    string pin_hash
    boolean is_active
  }
```

---

## 2. Katalog & stok per toko

```mermaid
erDiagram
  categories ||--o{ products : "contains"
  products ||--o{ product_variants : "has"
  products ||--o{ product_modifier_groups : "has"
  product_modifier_groups ||--o{ product_modifier_options : "has"
  products ||--o| recipes : "bom"
  recipes ||--o{ recipe_lines : "lines"
  products ||--o{ store_stocks : "stocked"
  products ||--o{ store_prices : "priced"
  product_variants ||--o{ store_variant_stocks : "stocked"
  stores ||--o{ store_stocks : "holds"
  stores ||--o{ store_prices : "overrides"
  stores ||--o{ store_variant_stocks : "holds"

  categories {
    uuid id PK
    uuid tenant_id FK
    string name
    int sort_order
  }

  products {
    uuid id PK
    uuid tenant_id FK
    uuid category_id FK
    string sku
    string name
    int unit_price_in_cents
    int tax_bps
    int stock_qty
    string product_type
    uuid kitchen_station_id FK
  }

  product_variants {
    uuid id PK
    uuid product_id FK
    string name
    int unit_price_in_cents
  }

  product_modifier_groups {
    uuid id PK
    uuid product_id FK
    string name
    int min_select
    int max_select
  }

  product_modifier_options {
    uuid id PK
    uuid group_id FK
    string name
    int price_delta_in_cents
  }

  store_stocks {
    uuid tenant_id PK, FK
    uuid store_id PK, FK
    uuid product_id PK, FK
    int qty
  }

  store_prices {
    uuid tenant_id PK, FK
    uuid store_id PK, FK
    uuid product_id PK, FK
    int unit_price_in_cents
  }

  store_variant_stocks {
    uuid tenant_id PK, FK
    uuid store_id PK, FK
    uuid variant_id PK, FK
    int qty
  }

  recipes {
    uuid id PK
    uuid product_id UK, FK
    int yield_qty
  }

  recipe_lines {
    uuid id PK
    uuid recipe_id FK
    uuid ingredient_product_id FK
    int qty
    int unit_cost_in_cents
  }

  stores {
    uuid id PK
    string code
  }
```

---

## 3. Keranjang, penjualan & pembayaran

```mermaid
erDiagram
  stores ||--o{ carts : "has"
  users ||--o{ carts : "cashier"
  customers ||--o{ carts : "guest"
  dining_tables ||--o{ carts : "seated"
  carts ||--o{ cart_items : "lines"
  products ||--o{ cart_items : "item"
  carts ||--o| sales : "checkout"
  stores ||--o{ sales : "has"
  users ||--o{ sales : "cashier"
  cashier_shifts ||--o{ sales : "during"
  promos ||--o{ sales : "applied"
  sales ||--o{ sale_lines : "lines"
  sales ||--o{ sale_payments : "tenders"
  stores ||--o{ payment_charges : "psp"

  carts {
    uuid id PK
    uuid store_id FK
    uuid cashier_user_id FK
    int subtotal_in_cents
    int tax_in_cents
    int total_in_cents
    string status
  }

  cart_items {
    uuid id PK
    uuid cart_id FK
    uuid product_id FK
    uuid variant_id FK
    int quantity
    int unit_price_in_cents
    int line_total_in_cents
  }

  sales {
    uuid id PK
    uuid store_id FK
    uuid shift_id FK
    uuid cart_id UK, FK
    int subtotal_in_cents
    int discount_in_cents
    int tip_in_cents
    int total_in_cents
    string status
  }

  sale_lines {
    uuid id PK
    uuid sale_id FK
    uuid product_id FK
    int quantity
    int unit_price_in_cents
    int line_total_in_cents
    int cogs_in_cents
  }

  sale_payments {
    uuid id PK
    uuid sale_id FK
    string method
    int amount_in_cents
    int amount_tendered_in_cents
  }

  payment_charges {
    uuid id PK
    uuid store_id FK
    uuid sale_id FK
    string provider
    int amount_in_cents
    string status
  }

  customers {
    uuid id PK
    string name
    string phone
    int loyalty_points
  }

  stores {
    uuid id PK
  }

  users {
    uuid id PK
  }

  cashier_shifts {
    uuid id PK
  }

  promos {
    uuid id PK
  }

  dining_tables {
    uuid id PK
  }

  products {
    uuid id PK
  }
```

---

## 4. Shift kasir & audit

```mermaid
erDiagram
  stores ||--o{ cashier_shifts : "opens"
  users ||--o{ cashier_shifts : "cashier"
  cashier_shifts ||--o{ cash_drawer_movements : "movements"
  users ||--o{ cash_drawer_movements : "actor"
  users ||--o{ supervisor_actions : "requester"
  users ||--o{ activity_logs : "actor"

  cashier_shifts {
    uuid id PK
    uuid store_id FK
    uuid cashier_user_id FK
    string status
    int opening_float_in_cents
    int expected_cash_in_cents
    int counted_cash_in_cents
    int discrepancy_in_cents
    int sale_count
  }

  cash_drawer_movements {
    uuid id PK
    uuid shift_id FK
    string type
    int amount_in_cents
    int variance_in_cents
  }

  supervisor_actions {
    uuid id PK
    uuid requester_user_id FK
    uuid supervisor_user_id FK
    string action_type
    int amount_in_cents
  }

  activity_logs {
    uuid id PK
    uuid actor_user_id FK
    string action
    int amount_in_cents
  }

  stores {
    uuid id PK
  }

  users {
    uuid id PK
  }
```

---

## 5. Dapur (KDS)

```mermaid
erDiagram
  stores ||--o{ kitchen_stations : "has"
  kitchen_stations ||--o{ user_kitchen_stations : "assigned"
  users ||--o{ user_kitchen_stations : "staff"
  stores ||--o{ kitchen_orders : "fires"
  kitchen_orders ||--o{ kitchen_order_lines : "lines"
  kitchen_stations ||--o{ kitchen_order_lines : "prep"
  products ||--o{ kitchen_order_lines : "item"

  kitchen_stations {
    uuid id PK
    uuid store_id FK
    string code
    string name
    int sort_order
  }

  user_kitchen_stations {
    uuid id PK
    uuid user_id FK
    uuid station_id FK
  }

  kitchen_orders {
    uuid id PK
    uuid store_id FK
    uuid sale_id
    string status
  }

  kitchen_order_lines {
    uuid id PK
    uuid order_id FK
    uuid station_id FK
    uuid product_id FK
    int quantity
    string status
  }

  stores {
    uuid id PK
  }

  users {
    uuid id PK
  }

  products {
    uuid id PK
  }
```

---

## 6. Inventori, pembelian & opname

```mermaid
erDiagram
  suppliers ||--o{ purchase_orders : "supplies"
  stores ||--o{ purchase_orders : "receives"
  purchase_orders ||--o{ purchase_order_lines : "lines"
  purchase_orders ||--o{ goods_receipts : "fulfilled"
  goods_receipts ||--o{ goods_receipt_lines : "lines"
  stores ||--o{ stock_transfers : "from_or_to"
  stock_transfers ||--o{ stock_transfer_lines : "lines"
  stores ||--o{ stock_count_sessions : "counts"
  stock_count_sessions ||--o{ stock_count_lines : "lines"

  suppliers {
    uuid id PK
    string name
    string phone
  }

  purchase_orders {
    uuid id PK
    uuid supplier_id FK
    uuid store_id FK
    string status
    int subtotal_in_cents
  }

  purchase_order_lines {
    uuid id PK
    uuid purchase_order_id FK
    uuid product_id FK
    int qty_ordered
    int qty_received
    int unit_cost_in_cents
  }

  goods_receipts {
    uuid id PK
    uuid purchase_order_id FK
    uuid store_id FK
  }

  goods_receipt_lines {
    uuid id PK
    uuid goods_receipt_id FK
    uuid product_id FK
    int qty
    int unit_cost_in_cents
  }

  stock_transfers {
    uuid id PK
    uuid from_store_id FK
    uuid to_store_id FK
    string status
  }

  stock_transfer_lines {
    uuid id PK
    uuid transfer_id FK
    uuid product_id FK
    int qty
  }

  stock_count_sessions {
    uuid id PK
    uuid store_id FK
    string status
  }

  stock_count_lines {
    uuid id PK
    uuid session_id FK
    uuid product_id FK
    int system_qty
    int counted_qty
    int variance_qty
  }

  stores {
    uuid id PK
  }
```

---

## 7. Meja & promo

```mermaid
erDiagram
  stores ||--o{ table_areas : "has"
  table_areas ||--o{ dining_tables : "contains"
  stores ||--o{ dining_tables : "has"
  categories ||--o{ promos : "scopes"
  products ||--o{ promos : "scopes"

  table_areas {
    uuid id PK
    uuid store_id FK
    string name
    int sort_order
  }

  dining_tables {
    uuid id PK
    uuid store_id FK
    uuid area_id FK
    string code
    int capacity
    string status
  }

  promos {
    uuid id PK
    string code
    int percent_bps
    int amount_in_cents
    int min_subtotal_in_cents
    string scope
  }

  stores {
    uuid id PK
  }

  categories {
    uuid id PK
  }

  products {
    uuid id PK
  }
```

---

## 8. HRIS

```mermaid
erDiagram
  users ||--o| employees : "profile"
  stores ||--o{ employees : "assigned"
  work_shifts ||--o{ employees : "default"
  employees ||--o{ attendances : "clocks"
  work_shifts ||--o{ attendances : "scheduled"
  employees ||--o{ payroll_slips : "paid"

  employees {
    uuid id PK
    uuid user_id UK, FK
    uuid store_id FK
    uuid work_shift_id FK
    string full_name
    int base_salary_in_cents
  }

  work_shifts {
    uuid id PK
    string name
    int start_minutes
    int end_minutes
    int standard_minutes
  }

  attendances {
    uuid id PK
    uuid employee_id FK
    uuid work_shift_id FK
    datetime clock_in_at
    datetime clock_out_at
    int worked_minutes
    int overtime_minutes
  }

  payroll_slips {
    uuid id PK
    uuid employee_id FK
    int period_year
    int period_month
    int base_salary_in_cents
    int overtime_pay_in_cents
    int pph21_in_cents
    int net_in_cents
  }

  users {
    uuid id PK
  }

  stores {
    uuid id PK
  }
```

---

## 9. Analitik harian

```mermaid
erDiagram
  stores ||--o{ daily_sales_summaries : "aggregates"
  products ||--o{ daily_product_summaries : "aggregates"

  daily_sales_summaries {
    uuid id PK
    uuid store_id FK
    date business_date
    int gross_sales_in_cents
    int net_sales_in_cents
    int transaction_count
    int cash_in_cents
    int qris_in_cents
  }

  daily_product_summaries {
    uuid id PK
    uuid product_id FK
    uuid store_id
    date business_date
    int quantity_sold
    int revenue_in_cents
  }

  stores {
    uuid id PK
  }

  products {
    uuid id PK
  }
```

---

## 10. Finance GL & integrasi eksternal

```mermaid
erDiagram
  tenants ||--o{ gl_accounts : "coa"
  tenants ||--o{ journal_entries : "posts"
  journal_entries ||--o{ journal_entry_lines : "lines"
  gl_accounts ||--o{ journal_entry_lines : "account"
  gl_accounts ||--o{ gl_account_mappings : "mapped"
  tenants ||--o{ integration_api_keys : "issues"
  users ||--o{ integration_api_keys : "created_by"
  tenants ||--o{ integration_webhooks : "configures"
  integration_webhooks ||--o{ integration_webhook_deliveries : "delivers"

  gl_accounts {
    uuid id PK
    string code
    string name
    string type
    boolean is_active
  }

  journal_entries {
    uuid id PK
    string source_type
    uuid source_id
    datetime posted_at
  }

  journal_entry_lines {
    uuid id PK
    uuid entry_id FK
    uuid account_id FK
    int debit_in_cents
    int credit_in_cents
    string memo
  }

  gl_account_mappings {
    uuid id PK
    uuid gl_account_id FK
    string provider
    string external_account_id
  }

  integration_api_keys {
    uuid id PK
    string name
    string key_prefix
    string key_hash
    string scopes
  }

  integration_webhooks {
    uuid id PK
    string url
    string secret
    string events
    boolean is_active
  }

  integration_webhook_deliveries {
    uuid id PK
    uuid webhook_id FK
    string event
    int status_code
    int attempts
  }

  tenants {
    uuid id PK
  }

  users {
    uuid id PK
  }
```

---

## 11. Edge sync (on-prem ↔ hub)

```mermaid
erDiagram
  tenants ||--o{ edge_sync_outbox : "queues"
  stores ||--o{ edge_sync_outbox : "scoped"
  tenants ||--o{ edge_sync_cursors : "tracks"

  edge_sync_outbox {
    uuid id PK
    uuid store_id FK
    string event_type
    string payload
    string status
    int attempts
  }

  edge_sync_cursors {
    uuid tenant_id PK, FK
    string stream PK
    string last_cursor
  }

  tenants {
    uuid id PK
  }

  stores {
    uuid id PK
  }
```

---

## Inventaris tabel (56)

| Domain | Tabel |
|--------|--------|
| Tenancy | `tenants`, `tenant_settings`, `stores`, `users` |
| Shift / audit | `cashier_shifts`, `cash_drawer_movements`, `supervisor_actions`, `activity_logs` |
| Katalog | `categories`, `products`, `product_variants`, `product_modifier_groups`, `product_modifier_options`, `store_stocks`, `store_prices`, `store_variant_stocks`, `recipes`, `recipe_lines`, `customers` |
| POS | `carts`, `cart_items`, `sales`, `sale_lines`, `sale_payments`, `payment_charges`, `promos` |
| KDS | `kitchen_stations`, `user_kitchen_stations`, `kitchen_orders`, `kitchen_order_lines` |
| Inventori | `suppliers`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `stock_transfers`, `stock_transfer_lines`, `stock_count_sessions`, `stock_count_lines` |
| Outlet | `table_areas`, `dining_tables` |
| HRIS | `employees`, `work_shifts`, `attendances`, `payroll_slips` |
| Analitik | `daily_sales_summaries`, `daily_product_summaries` |
| Finance | `gl_accounts`, `journal_entries`, `journal_entry_lines`, `integration_api_keys`, `gl_account_mappings`, `integration_webhooks`, `integration_webhook_deliveries` |
| Edge | `edge_sync_outbox`, `edge_sync_cursors` |

---

## Catatan relasi longgar

Kolom UUID tanpa `@relation` Prisma:

- `supervisor_actions.sale_id`
- `kitchen_orders.sale_id`
- `attendances.cashier_shift_id`
- `daily_product_summaries.store_id`

---

## Regenerasi

```bash
cd backend
npx prisma migrate dev --name <deskripsi>
npx prisma generate
```

Dokumentasi ini diselaraskan manual dengan `schema.prisma`.
