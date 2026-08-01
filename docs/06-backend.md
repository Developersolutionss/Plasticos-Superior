# 06 — Backend

## Estructura de carpetas

```
server/
├── .env.example           → plantilla de variables de entorno
├── tsconfig.json          → TypeScript estricto, CommonJS, outDir: dist
├── prisma/
│   ├── schema.prisma      → fuente de verdad de la BD
│   ├── seed.ts            → datos de ejemplo (npm run prisma:seed)
│   └── migrations/        → SQL versionado (prisma migrate dev)
└── src/
    ├── index.ts           → inicio de Express, monta los routers
    ├── prisma.ts          → exporta una única instancia de PrismaClient
    ├── middleware/
    │   └── auth.ts        → requireAuth (JWT) + requireRole (no usado aún)
    ├── routes/
    │   ├── auth.ts        → POST /login
    │   ├── clients.ts     → clientes (GET/POST /api/clients) + contactos (/:id/contacts)
    │   ├── inventory.ts   → GET /api/inventory[/alerts[/products]]
    │   ├── production.ts  → alta manual + import Excel (preview/confirm)
    │   ├── dispatches.ts  → GET/POST despachos + marcar items
    │   └── whatsappWebhook.ts → handshake + recepción de documentos (fase 2)
    └── services/
        ├── stockService.ts    → applyMovement, getStockByCategory, getLowStockAlerts
        └── importExcel.ts     → parseProductionFile (ExcelJS)
```

## `index.ts` (entrada)

```ts
import "dotenv/config";
import express from "express";
import cors from "cors";
// ... routers

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/production", productionRouter);
app.use("/api/dispatches", dispatchesRouter);
app.use("/webhook/whatsapp", whatsappWebhookRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => console.log(`API escuchando en http://localhost:${port}`));
```

Notas:
- `dotenv/config` carga `server/.env` automáticamente.
- `express.json()` parsea cuerpos JSON. La subida de Excel usa `multer` en la ruta correspondiente.
- No hay manejo global de errores. Cada router maneja sus propios errores con try/catch o `safeParse`.

## El patrón router → zod → prisma

Todos los routers siguen el mismo molde. Tomando `server/src/routes/clients.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);               // 1. protege TODAS las rutas del archivo

clientsRouter.get("/", async (_req, res) => { // 2. handler
  const clients = await prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  res.json(clients);
});

const createClientSchema = z.object({          // 3. schema zod
  name: z.string().min(1),
  contactInfo: z.record(z.any()).optional(),
});

clientsRouter.post("/", async (req, res) => {  // 4. validar + actuar
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const client = await prisma.client.create({ data: parsed.data });
  res.status(201).json(client);
});
```

**Los 4 pasos:**
1. `router.use(requireAuth)` — autenticación a nivel de router.
2. Handler asíncrono.
3. Esquema zod que define la forma del body.
4. `safeParse` → si falla, `400` con errores. Si pasa, `prisma.<modelo>.<método>()` → respuesta.

> El mismo archivo (`clients.ts`) define los endpoints de contactos: `GET/POST/DELETE /:id/contacts`. Sigue el patrón, con una diferencia: valida el parámetro `:id` a mano (`Number.isInteger`) porque un GET o DELETE no tiene body que valide zod. El POST y el DELETE usan `$transaction` para mantener la unicidad del contacto principal (ver [Transacciones](#transacciones-prismatransaction)).

## Middleware de autenticación (`middleware/auth.ts`)

```ts
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Token no provisto" });
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET) as AuthPayload;
    req.user = payload;      // expone userId, role, name
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

export function requireRole(...roles) { /* middleware por rol — definido pero NO se usa aún */ }
```

- `AuthPayload` = `{ userId, role, name }`. El token se firma en `routes/auth.ts` con `jwt.sign(...)`.
- `requireRole` existe en el código y está listo para restringir endpoints por rol. Ningún router lo aplica hoy.

## Servicios

### `services/stockService.ts`

**`applyMovement(tx, params)`** — el corazón de la consistencia del inventario:

- Recibe un cliente de transacción (`tx`). Registra un `inventory_movement`.
- Recalcula el stock desnormalizado (`inventory_stock`) con `upsert`: `currentQuantity: { increment: params.quantity }`.
- `quantity` positivo = entrada. `quantity` negativo = salida.
- Se ejecuta **dentro de** la transacción del llamador. Así las dos tablas nunca quedan inconsistentes.

```ts
export async function applyMovement(
  tx: Prisma.TransactionClient,
  params: { productId: number; quantity: number; movementType: ...; referenceType: ...; referenceId?: number; productionEntryId?: number; createdById?: number }
) {
  await tx.inventoryMovement.create({ data: { ...params } });
  await tx.inventoryStock.upsert({
    where: { productId: params.productId },
    create: { productId: params.productId, currentQuantity: params.quantity },
    update: { currentQuantity: { increment: params.quantity } },
  });
}
```

**`getStockByCategory()`** — une `products` con su `stock`. Calcula `currentStock`, `minStock` y `belowMinimum`.

**`getLowStockAlerts()`** — filtra los productos por debajo del mínimo.

### `services/importExcel.ts`

**`parseProductionFile(buffer, filename)`** — parsea Excel (`.xlsx`/`.xls`) o CSV (`.csv`) con `exceljs`.

- Columnas esperadas (la primera fila es el encabezado): `SKU | Etiqueta | Operario | Cliente | Medida | Kilos | Conductor | Observaciones`.
- Normaliza encabezados (minúsculas, sin acentos). Esto tolera variaciones.
- Valida por fila: SKU obligatorio, operario obligatorio, kilos numérico > 0.
- Devuelve `ParsedProductionRow[]`. Cada fila puede llevar un `error`. Las filas vacías se omiten.

## Transacciones (`prisma.$transaction`)

Use transacciones donde la operación debe ser atómica (todo o nada).

**En `routes/production.ts` (`createProductionEntry`)** — dentro de `$transaction`:
1. Crea la `production_entry` (status `recibido`).
2. Aplica el movimiento de **entrada** de stock con `applyMovement`.

Antes de la transacción, valida el SKU en el catálogo. Si no existe, devuelve error → `400`. Después resuelve el `clientId`: busca el cliente por nombre. Si no existe, lo crea.

**En `routes/dispatches.ts` (PATCH de item)** — dentro de `$transaction`:
1. Actualiza `quantityDispatched` del item.
2. Aplica el movimiento de **salida** de stock (`quantity` negativo).
3. Cuenta items pendientes. Si no quedan, el despacho pasa a `despachado` (y fija `dispatchedDate`). Si quedan, pasa a `en_proceso`.

**En `routes/clients.ts` (contactos)** — dentro de `$transaction`:

- **POST** con `isPrimary: true`: desmarca los primarios actuales del cliente (`updateMany`) y crea el contacto nuevo. Así siempre queda un solo principal.
- **DELETE** de un contacto principal: asigna como principal el contacto restante más reciente (`orderBy: { createdAt: "desc" }`) y borra el contacto.

## Uso de `req.user`

Los handlers que registran quién hizo la acción usan `req.user!.userId`. Por ejemplo: `createdById` en producción, despachos y `import_logs`.

## Dependencias del server (`server/package.json`)

- **Runtime:** `@prisma/client`, `bcryptjs`, `cors`, `dotenv`, `exceljs`, `express`, `jsonwebtoken`, `multer`, `zod`.
- **Dev:** `prisma`, `tsx`, `typescript`, `@types/*`.

## Scripts útiles

```bash
npm run dev --workspace=server            # dev con recarga (tsx watch)
npm run build --workspace=server          # tsc → dist/
npm run start --workspace=server          # node dist/index.js
npm run prisma:migrate --workspace=server # prisma migrate dev
npm run prisma:seed --workspace=server    # siembra datos
```
