# 06 — Backend

## Estructura de carpetas

```
server/
├── .env.example           → plantilla de variables de entorno
├── tsconfig.json          → TypeScript estricto, CommonJS, outDir: dist
├── uploads/
│   ├── pedidos/           → adjuntos de pedidos (disco)
│   └── clients/           → avatares de clientes (disco)
├── prisma/
│   ├── schema.prisma      → fuente de verdad de la BD (30 modelos)
│   ├── seed.ts            → datos de ejemplo (npm run prisma:seed)
│   └── migrations/        → SQL versionado (prisma migrate dev)
└── src/
    ├── index.ts           → inicio de Express, monta los routers, arranca el cron de Frecuentes
    ├── prisma.ts          → una única instancia de PrismaClient (adapter pg), envuelta en withAudit
    ├── middleware/
    │   └── auth.ts        → requireAuth (JWT + contexto de auditoría) + requireRole + ROLES + OPERARIO_STATIONS
    ├── services/
    │   ├── stockService.ts   → applyMovement, getStockByCategory, getLowStockAlerts
    │   ├── importExcel.ts    → parseProductionFile (ExcelJS)
    │   ├── email.ts          → sendPasswordResetEmail (Resend, fallback console)
    │   ├── emailTemplate.ts  → plantilla HTML inline del correo
    │   ├── totp.ts           → TOTP + QR (otplib / qrcode)
    │   ├── sequentialNumber.ts → withSequentialNumberRetry (reintenta la numeración)
    │   ├── frequency.ts      → motor de "Frecuentes": umbral, boost, reorden, redistribución
    │   ├── frecuentesReset.ts → purga semanal del ranking (cron en memoria)
    │   ├── auditContext.ts   → AsyncLocalStorage: usuario/IP/user-agent de la petición actual
    │   ├── auditExtension.ts → withAudit: $extends que audita create/update/delete de tablas críticas
    │   ├── exportExcel.ts    → buildExcelBuffer: helper compartido de Excel con estilo de marca
    │   ├── notify.ts         → notifyRoles: crea notificaciones in-app para un grupo de roles
    │   ├── pdfDocument.ts     → buildDocumentPdf/pdfToBuffer: PDF de cotización/factura con pdfkit
    │   └── whatsapp.ts        → sendWhatsAppMessage: mensaje saliente (no-op sin credenciales)
    ├── routes/
    │   ├── auth.ts            → login (rechaza usuarios inactivos), me, forgot/reset-password, 2FA
    │   ├── clients.ts         → CRM: clientes, contactos, direcciones, interacciones, cartera (con vencidas), avatares, visitas
    │   ├── inventory.ts       → GET /api/inventory[/alerts[/products][/movements]]
    │   ├── production.ts      → alta manual + import Excel (preview/confirm)
    │   ├── productionOrders.ts→ OPs + registro de etapa + cola de Planeación + control de calidad + dispara notificaciones
    │   ├── dispatches.ts      → GET/POST despachos + marcar ítems + notifica por WhatsApp al completarse
    │   ├── products.ts        → CRUD de catálogo + etiqueta QR imprimible
    │   ├── users.ts           → CRUD de usuarios y roles
    │   ├── warehouse.ts       → ubicaciones de bodega + stock por ubicación + QR
    │   ├── publicLocation.ts  → consulta pública de una ubicación vía token (sin requireAuth)
    │   ├── dashboard.ts       → indicadores ejecutivos y de producción/calidad
    │   ├── export.ts          → descargas .xlsx (inventario, pedidos, facturas, clientes)
    │   ├── notifications.ts   → listar/marcar notificaciones del usuario
    │   ├── cotizaciones.ts    → cotizaciones + convertir a pedido + PDF
    │   ├── pedidos.ts         → pedidos versionados + adjuntos
    │   ├── facturas.ts        → facturas (con vencimiento) + abonos/pagos + anulación + PDF
    │   ├── auditLog.ts        → GET /api/audit-log (bitácora forense)
    │   └── whatsappWebhook.ts → handshake + recepción de documentos (fase 2)
    └── generated/prisma/    → Prisma Client generado
```

## `index.ts` (entrada)

```ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
// ... routers
import { scheduleFrecuentesReset } from "./services/frecuentesReset";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Archivos subidos (avatares, adjuntos): ruta pública /api/uploads/<carpeta>/<archivo>
app.use("/api/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/production", productionRouter);
app.use("/api/production-orders", productionOrdersRouter);
app.use("/api/dispatches", dispatchesRouter);
app.use("/api/products", productsRouter);
app.use("/api/users", usersRouter);
app.use("/api/warehouse", warehouseRouter);
app.use("/api/public/locations", publicLocationRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/export", exportRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/cotizaciones", cotizacionesRouter);
app.use("/api/pedidos", pedidosRouter);
app.use("/api/facturas", facturasRouter);
app.use("/api/audit-log", auditLogRouter);
app.use("/webhook/whatsapp", whatsappWebhookRouter);

scheduleFrecuentesReset(); // purga semanal del ranking "Frecuentes"

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => console.log(`API escuchando en http://localhost:${port}`));
```

Notas:
- `dotenv/config` carga `server/.env` automáticamente.
- `express.json()` parsea cuerpos JSON. Las subidas de archivos usan `multer` en la ruta correspondiente (memoria para el Excel; disco para adjuntos de pedido y avatares de cliente).
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

> Los sub-recursos dependientes (contactos, direcciones, interacciones de un cliente) viven dentro del router padre con rutas anidadas (`/:id/contacts`). Valide `:id` y `:contactId` a mano (`Number.isInteger`) en los endpoints de cliente y de contactos. Los endpoints de cartera, límite de crédito, direcciones e interacciones no validan el `:id`. Las mutaciones multi-tabla usan `$transaction`.

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
| `ROLES.CALIDAD` | `calidad` |
| `ROLES.AUDITORIA` | `auditor` |
| `ROLES.ADMIN` | — (solo `super_admin`/`admin`) |

Varios routers aplican el rol con `router.use(...)` (protege también los `GET`): `clients`, `cotizaciones`, `pedidos` y `facturas` usan `use(requireVentas)`; `dispatches` y `warehouse` usan `use(requireAlmacen)`; `production-orders` usa `use(requireRole(...OPERARIOS, ...CALIDAD, ...AUDITORIA))` y aplica `requireProduccionGestion` en crear/cambiar estado/Planeación; `users`, `dashboard` y `export` usan `use(requireRole(...ROLES.ADMIN))` (`export` suma rol de ventas en `/pedidos` y `/facturas`). El control de calidad (`POST /:id/quality-check`) exige `CALIDAD`; la bitácora (`/api/audit-log`) exige `AUDITORIA`. `publicLocation.ts` es la única ruta de negocio sin `requireAuth` además del webhook de WhatsApp: usa el `publicToken` de la ubicación como credencial.

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
  tx: TxClient,
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

> `TxClient` se exporta desde `stockService.ts`. Se deriva de `prisma.$transaction` (no es el `Prisma.TransactionClient` genérico), porque `prisma` está envuelto en `$extends` y el tipo del cliente de transacción cambia. Los routers que necesitan el tipo lo importan de acá.

### `services/auditExtension.ts` — `withAudit`

**`withAudit(basePrisma)`** envuelve el `PrismaClient` con una extensión `$extends` que intercepta las mutaciones de las tablas críticas y escribe la bitácora:

- Tablas auditadas: `Client`, `Dispatch`, `ProductionEntry`, `InventoryMovement`.
- Operaciones auditadas: `create`, `update`, `delete`.
- Cada entrada guarda `before`/`after` (JSON), el usuario, la IP y el user-agent.
- Para `update`/`delete`, lee el estado previo con `basePrisma` antes de ejecutar la mutación. Para `delete`, el `after` es `NULL`.
- Usa `basePrisma` (no el cliente extendido) para el `auditLog.create` interno: así esa escritura no se re-audita ni entra en recursión.
- La extensión vive en `server/src/prisma.ts`: `export const prisma = withAudit(new PrismaClient({ adapter }))`. Los routers existentes no se tocan.

### `services/auditContext.ts` — contexto de la petición

La extensión no tiene acceso al `req` de Express. `requireAuth` guarda en un `AsyncLocalStorage` el contexto actual (`userId`, `ipAddress`, `userAgent`) apenas valida el token. Node lo propaga automáticamente por toda la cadena async de esa petición. Los requests que no pasan por `requireAuth` (p. ej. el webhook de WhatsApp o el seed) registran auditoría con `userId`/IP vacíos.

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

### `services/frequency.ts` — motor "Frecuentes"

Funciones puras (sin I/O). `clients.ts` las usa en tiempo real; `frecuentesReset.ts` usa la distribución.

- `HOT_THRESHOLD = 5` — umbral de interacciones por ciclo.
- `isHot(cycle, threshold)` — ¿el ciclo llegó al umbral?
- `boostValue(currentMax)` — `máximo actual + 1` (el boost en vivo).
- `nextVisitState(state, maxScore)` — estado siguiente tras una visita: suma 1 a `cycleInteractions`; si cruza el umbral, `viewCount` sube a `maxScore + 1`, `cycleInteractions` vuelve a 0 (el boost se consume).
- `sortByFrequency(entries)` — ordena por `score` desc, desempata por actividad reciente.
- `redistributeScores(entries)` — re-escala la escalera `n-1 … 0` según el orden (para la purga semanal).

### `services/frecuentesReset.ts` — purga semanal

Evita que los puntajes crezcan sin límite:

- `runFrecuentesReset(kind)` — procesa un grupo (`clients` o `contacts`). Reordena con `redistributeScores`, aplica `viewCount = score`, deja `cycleInteractions` en 0 (en transacción) y actualiza la fecha en `app_meta`.
- `scheduleFrecuentesReset()` — cron en memoria: corre a los 5 s del arranque y luego cada hora. Guarda la última purga en `app_meta` (`frecuentes:lastResetAt` y `frecuentes:lastResetAt:contacts`).

La purga **no reordena posiciones**: solo remapea los números. El más visitado conserva el valor más alto.

### `services/exportExcel.ts`

**`buildExcelBuffer(sheetName, columns, rows, options)`** — helper compartido con ExcelJS usado por los 4 endpoints de `export.ts`. Genera el estilo de marca: título y subtítulo (fecha de generación) fusionados arriba, encabezado con fondo oscuro y texto blanco, filas cebra, bordes finos, formato por columna (`currency`/`number`/`date`), autofiltro y fila superior congelada. `humanize()` convierte valores de enum en `snake_case` a texto legible.

### `services/notify.ts`

**`notifyRoles(roles, { type, message, link? })`** — crea una `Notification` (`createMany`) para cada usuario activo que tenga alguno de los roles dados. No hay bus de eventos central: cada router que necesita notificar llama a esta función explícitamente. Hoy el único llamador es `productionOrders.ts`: notifica a `ROLES.CALIDAD` cuando una etapa de `precorte` deja la OP `pendiente_calidad`, y a `ROLES.PRODUCCION_GESTION` cuando Calidad rechaza un lote.

### `services/pdfDocument.ts`

**`buildDocumentPdf({ kind, number, cliente, fecha, items, totalLines, metaLines?, notes?, stamp? })`** + **`pdfToBuffer(doc)`** — genera un PDF con `pdfkit` para una cotización o factura: encabezado con tipo/número/cliente/fecha, tabla de ítems, líneas de total (con `emphasis` opcional para resaltar una, p. ej. el saldo), notas y un sello de texto opcional (`stamp: "Vencida"`). Usado por `GET /cotizaciones/:id/pdf` y `GET /facturas/:id/pdf`. `formatCOP()` vive en el mismo archivo y es el formateador de moneda compartido por ambos endpoints.

### `services/whatsapp.ts`

**`sendWhatsAppMessage(to, message)`** — manda un mensaje de texto libre por la Graph API de Meta (WhatsApp Business). Sin `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` en el entorno, queda en modo no-op silencioso: solo lo imprime en consola, mismo criterio que `email.ts` sin `RESEND_API_KEY` — nunca rompe el flujo que lo llama. Los errores de red o de la API de Meta tampoco se propagan (se loguean y se ignoran). Único llamador hoy: `dispatches.ts`, al completar un despacho.

## Transacciones (`prisma.$transaction`)

Use transacciones donde la operación debe ser atómica (todo o nada). Operaciones transaccionales actuales:

- **Alta de producción** (`createProductionEntry`): crea `production_entry` + `applyMovement` de entrada.
- **Despacho** (PATCH de ítem): actualiza ítem + `applyMovement` de salida + estado del despacho. Si esa actualización deja el despacho `despachado` (y no lo estaba ya), **fuera** de la transacción intenta avisar por WhatsApp al cliente (ver `services/whatsapp.ts`).
- **Etapa de producción** (`POST /:id/stages`): crea la etapa; si la estación es `precorte`, deja la OP `pendiente_calidad` (no mueve stock todavía).
- **Control de calidad** (`POST /:id/quality-check`): crea el `quality_check`; si aprueba, `applyMovement` de entrada (con el kilaje del precorte) + marca la OP `finalizada`; si rechaza, deja la OP `detenida`.
- **Contactos/direcciones principal**: desmarca el anterior + crea el nuevo.
- **Numeración consecutiva** (`OP-`, `COT-`, `PED-`, `FAC-`): el `count()` y el `create` corren en la misma transacción, envuelta en `withSequentialNumberRetry`. Si dos requests calculan el mismo número y chocan contra el `@unique` (P2002), el servicio reintenta la transacción, hasta **8 intentos**, con backoff creciente y jitter (`delayMs = 10 * intento + Math.random() * 30`) para que varios requests trabados no vuelvan a chocar en el mismo instante.
- **OP desde Planeación** (`POST /from-pedido-item/:id`): valida que el ítem no tenga OP, la crea con numeración y enlaza `pedidoVersionItemId`.
- **Asignar stock a una ubicación** (`POST /api/warehouse/assign`): descuenta de la ubicación de origen (si aplica) y suma a la de destino en una transacción; `400` si el origen no tiene suficiente.
- **Purga semanal de Frecuentes** (`frecuentesReset`): redistribuye `viewCount` y resetea `cycleInteractions` en transacción, y actualiza la marca en `app_meta`.
- **Reset de contraseña**: actualiza el password + marca el token usado.
- **Factura** (abono): registra el pago + `recalculateStatus`.

## Uso de `req.user`

Los handlers que registran quién hizo la acción usan `req.user!.userId` como `createdById` (producción, despachos, etapas, control de calidad, cotizaciones, pedidos, facturas, pagos, interacciones, `import_logs`).

## Scripts útiles

```bash
npm run dev --workspace=server            # dev con recarga (tsx watch)
npm run build --workspace=server          # prisma generate && tsc → dist/
npm run start --workspace=server          # node dist/index.js
npm run prisma:migrate --workspace=server # prisma migrate dev + prisma generate
npm run prisma:seed --workspace=server    # prisma db seed
```

## Dependencias del server (`server/package.json`)

- **Runtime:** `@prisma/client`, `@prisma/adapter-pg`, `pg`, `bcryptjs`, `cors`, `dotenv`, `exceljs`, `express`, `jsonwebtoken`, `multer`, `otplib`, `pdfkit` (PDF de cotizaciones/facturas), `qrcode`, `resend`, `zod`.
- **Dev:** `prisma`, `tsx`, `typescript`, `@types/*`.