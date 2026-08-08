# 06 — Backend

## Estructura de carpetas

```
server/
├── .env.example           → plantilla de variables de entorno
├── tsconfig.json          → TypeScript estricto, CommonJS, outDir: dist
├── uploads/pedidos/       → adjuntos de pedidos (disco)
├── prisma/
│   ├── schema.prisma      → fuente de verdad de la BD (24 modelos)
│   ├── seed.ts            → datos de ejemplo (npm run prisma:seed)
│   └── migrations/        → SQL versionado (prisma migrate dev)
└── src/
    ├── index.ts           → inicio de Express, monta los routers
    ├── prisma.ts          → una única instancia de PrismaClient (adapter pg)
    ├── middleware/
    │   └── auth.ts        → requireAuth (JWT) + requireRole + ROLES + OPERARIO_STATIONS
    ├── services/
    │   ├── stockService.ts   → applyMovement, getStockByCategory, getLowStockAlerts
    │   ├── importExcel.ts    → parseProductionFile (ExcelJS)
    │   ├── email.ts          → sendPasswordResetEmail (Resend, fallback console)
    │   ├── emailTemplate.ts  → plantilla HTML inline del correo
    │   ├── totp.ts           → TOTP + QR (otplib / qrcode)
    │   └── sequentialNumber.ts → withSequentialNumberRetry (reintenta la numeración)
    ├── routes/
    │   ├── auth.ts            → login, me, forgot/reset-password, 2FA
    │   ├── clients.ts         → CRM: clientes, contactos, direcciones, interacciones, cartera
    │   ├── inventory.ts       → GET /api/inventory[/alerts[/products]]
    │   ├── production.ts      → alta manual + import Excel (preview/confirm)
    │   ├── productionOrders.ts→ OPs + registro de etapa por estación
    │   ├── dispatches.ts      → GET/POST despachos + marcar items
    │   ├── cotizaciones.ts    → cotizaciones + convertir a pedido
    │   ├── pedidos.ts         → pedidos versionados + adjuntos
    │   ├── facturas.ts        → facturas + abonos/pagos + anulación
    │   └── whatsappWebhook.ts → handshake + recepción de documentos (fase 2)
    └── generated/prisma/    → Prisma Client generado
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
app.use("/api/production-orders", productionOrdersRouter);
app.use("/api/dispatches", dispatchesRouter);
app.use("/api/cotizaciones", cotizacionesRouter);
app.use("/api/pedidos", pedidosRouter);
app.use("/api/facturas", facturasRouter);
app.use("/webhook/whatsapp", whatsappWebhookRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => console.log(`API escuchando en http://localhost:${port}`));
```

Notas:
- `dotenv/config` carga `server/.env` automáticamente.
- `express.json()` parsea cuerpos JSON. Las subidas de Excel y adjuntos usan `multer` en la ruta correspondiente (memoria para Excel, disco para adjuntos).
- No hay manejador global de errores. Cada router maneja sus propios errores con try/catch o `safeParse`.

## El patrón router → zod → prisma

Todos los routers siguen el mismo molde. Tomando `server/src/routes/clients.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);                                  // 1. protege TODAS las rutas

const requireVentas = requireRole(...ROLES.VENTAS);              // 2. rol para rutas sensibles

clientsRouter.get("/", async (_req, res) => {                    // 3. GET
  const clients = await prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  res.json(clients);
});

const createClientSchema = z.object({                            // 4. schema zod
  name: z.string().min(1),
  contactInfo: z.record(z.string(), z.any()).optional(),
  creditLimit: z.number().min(0).optional(),
});

clientsRouter.post("/", requireVentas, async (req, res) => {     // 5. validar + actuar
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const client = await prisma.client.create({ data: parsed.data });
  res.status(201).json(client);
});
```

**Los 5 pasos:**
1. `router.use(requireAuth)` — autenticación a nivel de router.
2. Middleware de rol (`requireRole`) para las rutas restringidas.
3. Handler asíncrono.
4. Schema zod que define la forma del body.
5. `safeParse` → si falla, `400` con errores. Si pasa, `prisma.<modelo>.<método>()` → respuesta.

> Los sub-recursos dependientes (contactos, direcciones, interacciones de un cliente) viven dentro del router padre con rutas anidadas (`/:id/contacts`). Valida el parámetro `:id` a mano (`Number.isInteger`) en los endpoints sin body. Las mutaciones multi-tabla usan `$transaction`.

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
```

- `AuthPayload = { userId, role, name }`. El token se firma en `routes/auth.ts` con `jwt.sign(...)` (expira en 12 h).
- `requireRole(...roles)` devuelve un middleware que responde `403` si `req.user.role` no está en la lista.
- Grupos reutilizables:

| Grupo | Roles (además de `super_admin` y `admin`) |
|---|---|
| `ROLES.VENTAS` | `ventas_pedidos` |
| `ROLES.ALMACEN` | `almacen_despachos` |
| `ROLES.PRODUCCION_GESTION` | `gerente_produccion`, `planeacion` |
| `ROLES.OPERARIOS` | `gerente_produccion`, `planeacion`, `operario_extrusion`, `operario_impresion`, `operario_sellado_precorte` |

- `OPERARIO_STATIONS` mapea cada rol de operario a sus estaciones (`operario_extrusion → ["extrusion"]`, etc.). Se aplica en el POST de etapas: el operario solo registra su estación.

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
  params: { productId; quantity; movementType; referenceType; referenceId?; productionEntryId?; createdById? }
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

- Columnas esperadas: `SKU | Etiqueta | Operario | Cliente | Medida | Kilos | Conductor | Observaciones`.
- Normaliza encabezados (minúsculas, sin acentos). Tolera variaciones.
- Valida por fila: SKU obligatorio, operario obligatorio, kilos numérico > 0.
- Devuelve `ParsedProductionRow[]`; cada fila puede llevar `error`. Las filas vacías se omiten.

### `services/totp.ts` y `services/email.ts`

- `totp.ts`: `generateSecret()`, `generateQrCodeDataUrl(email, secret)`, `verifyToken(token, secret)` con `otplib` y `qrcode`.
- `email.ts`: `sendPasswordResetEmail(email, url)` con Resend. Sin `RESEND_API_KEY` imprime el link en la consola del servidor (para pruebas locales).

## Transacciones (`prisma.$transaction`)

Use transacciones donde la operación debe ser atómica (todo o nada). Operaciones transaccionales actuales:

- **Alta de producción** (`createProductionEntry`): crea `production_entry` + `applyMovement` de entrada.
- **Despacho** (PATCH de item): actualiza item + `applyMovement` de salida + estado del despacho.
- **Etapa de producción** (`POST /:id/stages`): crea la etapa; si la estación es `precorte`, además `applyMovement` + marca la OP finalizada.
- **Contactos/direcciones principal**: desmarca el anterior + crea el nuevo.
- **Numeración consecutiva** (`OP-`, `COT-`, `PED-`, `FAC-`): el `count()` y el `create` corren en la misma transacción, envuelta en `withSequentialNumberRetry`. Si dos requests calculan el mismo número y chocan contra el `@unique` (P2002), el servicio reintenta la transacción (hasta 3 veces); en el reintento el `count()` ya ve la fila del otro request.
- **Reset de contraseña**: actualiza el password + marca el token usado.
- **Factura** (abono): registra el pago + `recalculateStatus`.

## Uso de `req.user`

Los handlers que registran quién hizo la acción usan `req.user!.userId` como `createdById` (producción, despachos, etapas, cotizaciones, pedidos, facturas, pagos, interacciones, `import_logs`).

## Scripts útiles

```bash
npm run dev --workspace=server            # dev con recarga (tsx watch)
npm run build --workspace=server          # prisma generate && tsc → dist/
npm run start --workspace=server          # node dist/index.js
npm run prisma:migrate --workspace=server # prisma migrate dev + prisma generate
npm run prisma:seed --workspace=server    # prisma db seed
```

## Dependencias del server (`server/package.json`)

- **Runtime:** `@prisma/client`, `@prisma/adapter-pg`, `pg`, `bcryptjs`, `cors`, `dotenv`, `exceljs`, `express`, `jsonwebtoken`, `multer`, `otplib`, `qrcode`, `resend`, `zod`.
- **Dev:** `prisma`, `tsx`, `typescript`, `@types/*`.