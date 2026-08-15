# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ERP/MES web system for Plásticos Superior S.A.S. (plastics manufacturing). Replaces a manual Excel/WhatsApp workflow between Production, Quality, Planning and Dispatch. Full docs (Spanish) live in [`/docs`](docs/README.md) — read `docs/03-architecture.md`, `docs/06-backend.md`, `docs/07-frontend.md` and `docs/09-contributing.md` before making non-trivial changes; they are kept up to date and are more detailed than this file.

## Stack

- Backend: Node.js + Express 5 + TypeScript + Prisma 7 (`@prisma/adapter-pg`) + PostgreSQL 16
- Frontend: React 19 + Vite 8 + TypeScript + Tailwind CSS 4 + TanStack Query + React Router 7, packaged as a PWA (`vite-plugin-pwa`)
- npm workspaces monorepo: `server` + `client` (root `package.json` orchestrates both)

## Commands

```bash
# Setup (from repo root)
docker compose up -d              # PostgreSQL 16 locally
npm install                       # installs server + client workspaces
cp server/.env.example server/.env
npm run prisma:migrate            # schema + generate client
npm run prisma:seed               # seed data + one test user per role

npm run dev                       # server (:4000) + client (:5173) concurrently
npm run dev:server                # server only (tsx watch)
npm run dev:client                # client only (vite)

npm run build                     # server (prisma generate && tsc) + client (tsc -b && vite build)
npm run test                      # server tests + client tests

# Single-workspace scripts
npm run build --workspace=server
npm run test --workspace=client   # vitest run --config ../testing/vitest.config.ts
```

There's also `./run.sh {init|start|stop|seed}` — an alternate helper that starts Docker Postgres, migrates/seeds, and launches server+client in the background with logs under `.run/`.

Tests live outside both workspaces, under `/testing`:
- `testing/server/api.test.ts` — backend, run via `npm run test --workspace=server` (uses Node's built-in `node:test`, not a test framework — no `--grep`-style filtering built in beyond Node's own `--test-name-pattern`)
- `testing/client/*.test.{ts,tsx}` — frontend, run via `npm run test --workspace=client` (Vitest + Testing Library + jsdom). Run a single file: `npm run test --workspace=client -- testing/client/Contactos.test.tsx`

No lint script exists at the time of writing — don't assume one.

Seeded test users (password `password123` for all): `admin@empresa.com` (`super_admin`), `administrador@empresa.com` (`admin`), `produccion@empresa.com` (`gerente_produccion`), `planeacion@empresa.com`, `ventas@empresa.com`, `despacho@empresa.com`, `operario.extrusion@empresa.com`, `operario.impresion@empresa.com`, `operario.sellado@empresa.com`, `calidad@empresa.com`, `auditor@empresa.com`.

## Architecture

### Request flow and the dev proxy

Browser → React SPA (`:5173`) → Vite dev proxy rewrites `/api/*` → Express (`:4000`) → single shared `PrismaClient` → PostgreSQL. The frontend never hardcodes a host: `client/src/api/client.ts` uses `API_BASE = "/api"` (relative), relying on the Vite proxy in dev and a reverse proxy in prod. In production the Express server does **not** serve the built client — a separate static server + reverse proxy is expected to forward `/api/*`.

### Auth and authorization

JWT-based (`jwt.sign({ userId, role, name }, ..., { expiresIn: "12h" })`), token stored client-side in `localStorage`. `server/src/middleware/auth.ts`:
- `requireAuth` validates the Bearer token and populates `req.user`. Applied per-router (`router.use(requireAuth)`), not globally — every router except `auth`, `whatsappWebhook`, and the public `/health` + `/api/uploads` static route needs it.
- `requireRole(...roles)` restricts a specific route; reusable role groups live in `ROLES` (`VENTAS`, `ALMACEN`, `PRODUCCION_GESTION`, `OPERARIOS`, `CALIDAD`, `AUDITORIA`). `super_admin` and `admin` belong to every group.
- Several routers gate the **entire router** (including GETs) with `router.use(requireX)`: `clients`, `cotizaciones`, `pedidos`, `facturas` (ventas); `dispatches` (almacén); `production-orders` (operarios+calidad+auditoría, with finer-grained checks inside).
- `OPERARIO_STATIONS` maps each operario role to the one station they can log (`operario_extrusion → ["extrusion"]`, etc.) — enforced on `POST /production-orders/:id/stages`.
- The frontend mirrors these checks (`RequireRole`, `filterNavSections(role)` in `client/src/components/navConfig.ts`) purely for UX; the server is the actual authority. There are 11 roles total (`UserRole` in `client/src/auth/AuthContext.tsx`).

### The router → zod → prisma pattern

Every backend route file (`server/src/routes/*.ts`) follows the same shape: `router.use(requireAuth)` → optional `requireRole(...)` middleware per sensitive route → zod schema → `safeParse` (→ `400` with `.flatten()` on failure) → `prisma.<model>.<op>()`. Dependent sub-resources (e.g. client contacts/addresses/interactions) nest inside the parent router (`/:id/contacts`) rather than getting their own top-level router+mount. Follow `docs/09-contributing.md` step-by-step when adding a model/endpoint/page — it's the canonical recipe (Prisma model → migration → router → mount in `index.ts` → `api` helper method → page/route → docs update).

### Audit logging is transparent to routers

`server/src/prisma.ts` exports one `PrismaClient` wrapped via `$extends` (`withAudit`, in `services/auditExtension.ts`). It intercepts `create`/`update`/`delete` on `Client`, `Dispatch`, `ProductionEntry`, `InventoryMovement` and writes an `AuditLog` row with before/after JSON diffs. Routers never call anything audit-related directly — the extension does it transparently on the shared client. The "who/from where" (userId, IP, user-agent) is captured by `requireAuth` into an `AsyncLocalStorage` (`services/auditContext.ts`) and read by the extension — this is why audited writes made outside a request (webhook, seed) log with empty user/IP.

### Inventory consistency

`services/stockService.ts`'s `applyMovement(tx, params)` is the single choke point for stock changes: it writes an `InventoryMovement` row and upserts the denormalized `InventoryStock.currentQuantity` (increment, positive = in / negative = out) **inside the caller's transaction**, so the two tables never drift. Any new code path that changes stock should go through this, inside a `prisma.$transaction`, not update `InventoryStock` directly.

### Production → Quality → Inventory flow

This is the core business cycle (see `docs/08-workflow.md` for full detail): an order gets planned (Planeación queue) → generates a Production Order (`OP-00001`, sequential numbering via `withSequentialNumberRetry`, which retries the whole transaction on a `@unique` collision) → passes through stations (extrusión, impresión, sellado, precorte — each a `production_stage_log`) → precorte leaves the OP `pendiente_calidad` **without** moving stock yet → Quality (`POST /production-orders/:id/quality-check`) approves (creates the inventory entry via `applyMovement`, OP → `finalizada`) or rejects (OP → `detenida`). Traceability (`Trazabilidad.tsx`) reads this whole chain read-only.

### Frontend conventions

- `client/src/api/client.ts` is the **only** place that calls `fetch`; pages always go through the `api.*` helper object, never raw `fetch`.
- TanStack Query for all server state: `useQuery({ queryKey, queryFn: api.x })` for reads, imperative `api.x()` calls + manual `queryClient.invalidateQueries([...])` for writes (no `useMutation` in this codebase — match the existing pattern).
- Routes are declared in `client/src/App.tsx`, each wrapped in `RequireRole roles={GROUP}` (groups from `navConfig.ts`); `RequireStationRole` handles the dynamic `/produccion/estacion/:station` route by mapping the URL param to the right operario role group.
- Menu items (`navConfig.ts`) each declare their own `roles`; a role not listed simply doesn't see the item — this is separate from (but must match) the route guard.
- PWA offline caching (`vite.config.ts`, Workbox `runtimeCaching`) only covers `StaleWhileRevalidate` GETs matching `/\/api\/inventory/`; mutations are never cached. Extend the `urlPattern` if a new GET needs offline support.

### Prisma model conventions

Enforced by convention across the schema (`server/prisma/schema.prisma`, 27+ models) — follow them for any new model: singular model name, `@@map("snake_case_plural")` table, `@map("snake_case")` columns, `id Int @id @default(autoincrement())`, `createdAt DateTime @default(now()) @map("created_at")`, relations declared on both sides, FKs named `modelId`, money as `@db.Decimal(12, 2)`, states as schema-level enums.
