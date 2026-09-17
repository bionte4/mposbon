# BonPOS

Multi-tenant Point of Sale (POS) platform for retail & F&B — cloud SaaS or on-premises (edge / mini-PC).

Decoupled **Vue 3 SPA** + **NestJS API** + **PostgreSQL** (Row-Level Security). Offline-first cashier via IndexedDB/PWA, integer money (IDR), RBAC, shifts/Z-report, HRIS dasar, purchasing/receiving, kitchen/KDS, and Docker Compose for one-command deploy.

**Operator guide (Bahasa Indonesia):** [docs/MANUAL.md](docs/MANUAL.md)  
**ERD / RDBMS (PostgreSQL):** [docs/ERD.md](docs/ERD.md)

## Features

| Area | Capabilities |
|------|----------------|
| **POS** | Touch-first cart, hold/resume, modifiers/variants, tables/guests, split tender, cash / card / QRIS (dynamic EMVCo), ESC/POS receipt, barcode scanner |
| **Kitchen** | KDS stations, fire from POS, bump board, kitchen/bar RBAC |
| **Offline** | Dexie/IndexedDB cart & sale queue, background sync, edge/on-prem hub sync |
| **Shift** | Clock-in/out, cash drop / mid-count, X-Report & Z-Report archive |
| **Inventory** | Per-store stock & price, in-transit transfer, PO/receiving, stock count, recipes/BOM |
| **Promos** | Voucher % (bps) or fixed amount; scope ALL/category/product |
| **Payments** | Local dynamic QRIS, Midtrans/Xendit QRIS charge + webhook/poll |
| **Loyalty** | Earn points on sale + redeem points for discount |
| **Admin** | 5 hubs (catalog / inventory / outlet / team / system), store profile & QRIS, audit, light GL |
| **HRIS** | Employees, attendance, work shifts, payroll draft (OT + PPh 21 helpers) |
| **Dashboard** | Gross/net sales, AOV, top products, shift discrepancy widgets |
| **Tenancy** | Shared DB + `tenant_id` + Postgres RLS; cloud multi-tenant or locked on-prem tenant |
| **i18n** | Bahasa Indonesia & English |

## Tech stack

- **Frontend:** TypeScript, Vue 3, Vite, TailwindCSS, Dexie, PWA (Workbox)
- **Backend:** TypeScript, NestJS, Prisma
- **Database:** PostgreSQL 16
- **Deploy:** Docker Compose (API + SPA + Nginx gateway + Postgres)

## Quick start (Docker Desktop — recommended)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
git clone https://github.com/bionte4/mposbon.git
cd mposbon
cp .env.example .env
npm run compose:desktop
```

Open **http://localhost:9088** (gateway = SPA + `/api` proxy).

| Service | Host port (desktop overlay) |
|---------|-----------------------------|
| Gateway (use this) | `9088` |
| SPA direct | `9080` |
| API direct | `9300` → `/api/v1` |
| Postgres (host tools) | `5433` |

Stop:

```bash
npm run compose:down
```

### Other compose modes

```bash
# Production-like ports (80 / 3000 / 8080 / 5432) — may conflict on busy Macs
npm run compose:up

# On-premises overlay (single tenant, offline license, edge sync)
npm run compose:onprem
```

## Demo login (seed)

After first boot (`RUN_DB_SEED=true`), tenant slug defaults to `onprem-store`.

| Role | Email | PIN (dev) |
|------|--------|-----------|
| Tenant Admin | `admin@bonpos.local` | `1234` |
| Manager | `manager@bonpos.local` | `1234` |
| Supervisor | `supervisor@bonpos.local` | `1234` |
| Cashier | `cashier@bonpos.local` | `1234` |
| Kitchen | `kitchen@bonpos.local` | `1234` |
| Bar | `bar@bonpos.local` | `1234` |

Operator walkthrough: **[docs/MANUAL.md](docs/MANUAL.md)**.

Change `SEED_SUPERVISOR_PIN` / `JWT_SECRET` before any real deployment.

## Local development (without Docker app containers)

Needs Node.js ≥ 20 and a running Postgres (local or compose postgres only).

```bash
cp .env.example .env
# Point DATABASE_* at your Postgres, APP_PORT=3001, VITE_API_URL=http://localhost:3001/api/v1

npm install
npm run db:migrate
npm run db:seed
npm run dev:api    # API :3001
npm run dev:web    # Vite :5173
```

## Project layout

```
├── backend/           # NestJS API + Prisma schema/migrations
├── frontend/          # Vue SPA (POS, admin, dashboard, HRIS, KDS)
├── docs/              # Operator manual (MANUAL.md)
├── docker/            # Gateway nginx + Postgres init (app role)
├── docker-compose.yml
├── docker-compose.desktop.yml   # Mac / Desktop-safe host ports
└── docker-compose.onprem.yml
```

API base path: `/api/v1`.

## Money & security notes

- All monetary amounts are **integers** (smallest currency unit / IDR sen). Never use float for money.
- Sensitive POS actions (void, manual discount, force drawer) require elevated RBAC / supervisor PIN.
- Runtime DB role `bonpos_app` is created **without** `BYPASSRLS` so tenant policies always apply.
- Do not commit `.env` — only `.env.example` is in the repo.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run compose:desktop` | Build & start stack (Desktop-safe ports) |
| `npm run compose:up` | Build & start with default ports |
| `npm run compose:onprem` | Cloud compose + on-prem overlay |
| `npm run compose:down` | Stop stack |
| `npm run dev:api` / `dev:web` | Local hot reload |
| `npm run db:migrate` / `db:seed` | Prisma migrate & seed |
| `npm test` | Backend unit/integration tests |

## License

Proprietary — all rights reserved unless otherwise stated by the repository owner.
