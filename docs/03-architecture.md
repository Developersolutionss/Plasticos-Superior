# 03 — Arquitectura y comunicación

## Vista general

```
┌─────────────────────────────────────────────────────────┐
│  Navegador                                              │
│  React SPA/PWA (client)  →  http://localhost:5173       │
│                                                         │
│  api/client.ts: fetch("/api/...") + Bearer token        │
└──────────────────────────┬──────────────────────────────┘
                           │  /api/*  (dev)
                           ▼
                ┌──────────────────────────┐
                │  Vite dev proxy          │  client/vite.config.ts
                │  "/api" → localhost:4000 │
                └──────────────────────────┘
                           │  /api/*  (prod: reverse proxy → API)
                           ▼
                ┌──────────────────────┐
                │  Express (server)    │  server/src/index.ts
                │  mounts routers      │
                │  requireAuth (JWT)   │
                └──────────────────────┘
                           │  Prisma Client
                           ▼
                ┌─────────────────────────┐
                │  PostgreSQL 16 (Docker) │  localhost:5432
                └─────────────────────────┘
```

## El proxy de desarrollo (pieza clave)

En desarrollo, el frontend no se comunica directamente con el backend. El `vite.config.ts` define el proxy:

```ts
server: {
  proxy: { "/api": "http://localhost:4000" },
}
```

El navegador envía una petición a `http://localhost:5173/api/*`. Vite la reenvía a `http://localhost:4000/api/*`.

Por eso el frontend usa una base relativa en `client/src/api/client.ts`:

```ts
const API_BASE = "/api";   // sin dominio
```

Beneficios:
- Sin CORS en desarrollo (mismo origen percibido: `localhost:5173`).
- El token y los headers viajan igual. El navegador no percibe el reenvío.

En **producción**, el servidor solo expone la API (no sirve el build del frontend). Sirva el cliente compilado (`client/dist`) con un servidor estático. Ese servidor debe **reenviar `/api/*` a la API** (p. ej. con un reverse proxy como nginx). Esto replica el papel del proxy de desarrollo.

## Contrato entre frontend y backend

### Formato

- Todo es **JSON**. Solo las subidas de archivos usan `multipart/form-data`: Excel de producción, avatar de cliente y adjuntos de pedido.
- Respuestas de éxito: JSON plano del recurso (objeto o arreglo). También `{ "ok": true }` o `204` en mutaciones simples.
- Respuestas de error: `{ "error": string }` o `{ "error": ..., "details": ... }` (errores de zod).

### Autenticación (JWT)

1. El usuario hace login → `POST /api/auth/login`. El servidor valida las credenciales. Firme un token con `jwt.sign({ userId, role, name }, JWT_SECRET, { expiresIn: "12h" })`.
2. El frontend guarda `token` y `user` en `localStorage` (ver `client/src/auth/AuthContext.tsx`).
3. Cada request protegido viaja con `Authorization: Bearer <token>`.
4. El middleware `requireAuth` (`server/src/middleware/auth.ts`) verifica la firma. Expone `req.user`. Si el token falta o es inválido → `401`.

El token define **quién es** el usuario. Después del login, las rutas sensibles aplican `requireRole(...)` con los grupos de `ROLES` (Ventas, Almacén, Producción, Operarios, Calidad, Auditoría) de `server/src/middleware/auth.ts`:

- `requireAuth` protege **todo** router, excepto `POST /api/auth/login`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `GET /api/public/locations/:token` y el webhook de WhatsApp.
- `GET /health` y `/api/uploads` son **públicos**. El primero es el health check. El segundo sirve los archivos subidos (avatares de clientes y adjuntos de pedidos) para las etiquetas `<img>`.
- `GET /api/public/locations/:token` (Almacén/WMS) también es público: en vez de sesión, usa el `publicToken` de la ubicación como credencial — solo quien escaneó el QR físico de esa ubicación puede consultarla. La alimenta la página pública `/qr/:token` del frontend, fuera de `RequireAuth`.
- `requireRole(...)` restringe una ruta concreta. Devuelve `403` si el rol no está en la lista.
- `super_admin` y `admin` pertenecen a todos los grupos, así que siempre pasan.

`requireAuth` además captura quién hace la petición (usuario, IP y user-agent) y lo propaga con `AsyncLocalStorage` (`server/src/services/auditContext.ts`). La extensión de Prisma de auditoría usa ese contexto al registrar cambios (ver "Configuración compartida").

Ejemplo: `POST /api/cotizaciones` exige rol de ventas; `POST /api/production-orders/:id/rolls` exige un rol de operario, y el operario solo carga rollos en OPs de su estación (mediante `OPERARIO_STATIONS`).

### Formato de errores

| Código | Cuándo |
|---|---|
| `400` | Body inválido (zod) o regla de negocio fallida |
| `401` | Token no provisto, inválido o expirado |
| `403` | Rol sin permiso para la ruta (`requireRole`) o estación no asignada al operario |
| `404` | Recurso no encontrado |
| `423` | Cuenta bloqueada temporalmente por intentos fallidos (login) |

El helper `request()` del frontend lanza una excepción cuando `!res.ok`. Extrae `body.error`.

## Flujo de una petición (ejemplo: GET /api/clients)

1. **Frontend**: `client/src/pages/Clients.tsx` llama `api.getClients()` → `fetch("/api/clients")` con `Authorization: Bearer <token>`.
2. **Vite proxy** (dev): reenvía a `http://localhost:4000/api/clients`.
3. **Express**: `server/src/index.ts` monta `app.use("/api/clients", clientsRouter)`.
4. **Router**: `clientsRouter.use(requireAuth)` valida el token. Además, `clientsRouter.use(requireVentas)` restringe **todo** el módulo CRM (incluidos los `GET`) al rol de ventas. El handler consulta `prisma.client.findMany({ where: { active: true } })`.
5. **Prisma**: traduce a SQL. Consulta PostgreSQL. Devuelve objetos JS.
6. **Respuesta**: JSON de vuelta por el mismo camino.

## TanStack Query (frontend)

La UI no llama `fetch` directo. Envuelve los helpers del `api` en `useQuery`.

```tsx
const { data: alerts } = useQuery({ queryKey: ["alerts"], queryFn: api.getAlerts });
```

- `queryKey` identifica la consulta (caché y re-fetch).
- `queryFn` es la función del helper `api`.
- Tras una mutación, se invalidan las claves afectadas con `queryClient.invalidateQueries(...)`. Por ejemplo: tras confirmar una importación se invalidan `["inventory"]` y `["alerts"]`.

## PWA / Service Worker

Configurado en `vite.config.ts` con `vite-plugin-pwa`:

- La app es instalable (manifest con `display: "standalone"`).
- Workbox almacena en caché las peticiones que coinciden con el patrón `/\/api\/inventory/`. Esto incluye `GET /api/inventory`, `/api/inventory/alerts` y `/api/inventory/products`. La estrategia es `StaleWhileRevalidate`. El dashboard de stock es legible con conectividad intermitente en planta.
- **Las mutaciones (POST/PATCH/DELETE) nunca se almacenan en caché.**

> Para que un GET nuevo funcione offline (p. ej. consultas del futuro CRM), amplíe el `urlPattern` del `runtimeCaching`.

## Mapa de montaje de routers (`server/src/index.ts`)

| Prefijo | Router | Archivo |
|---|---|---|
| `GET /health` | — | `index.ts` (público) |
| `/api/uploads` | `express.static` | sirve archivos subidos de forma pública: avatares (`.../clients/`) y adjuntos de pedidos (`.../pedidos/`) |
| `/api/auth` | `authRouter` | `server/src/routes/auth.ts` |
| `/api/clients` | `clientsRouter` | `server/src/routes/clients.ts` |
| `/api/inventory` | `inventoryRouter` | `server/src/routes/inventory.ts` |
| `/api/production` | `productionRouter` | `server/src/routes/production.ts` |
| `/api/production-orders` | `productionOrdersRouter` | `server/src/routes/productionOrders.ts` |
| `/api/dispatches` | `dispatchesRouter` | `server/src/routes/dispatches.ts` |
| `/api/products` | `productsRouter` | `server/src/routes/products.ts` |
| `/api/users` | `usersRouter` | `server/src/routes/users.ts` |
| `/api/warehouse` | `warehouseRouter` | `server/src/routes/warehouse.ts` |
| `/api/public/locations` | `publicLocationRouter` | `server/src/routes/publicLocation.ts` (sin `requireAuth`) |
| `/api/dashboard` | `dashboardRouter` | `server/src/routes/dashboard.ts` |
| `/api/export` | `exportRouter` | `server/src/routes/export.ts` |
| `/api/notifications` | `notificationsRouter` | `server/src/routes/notifications.ts` |
| `/api/cotizaciones` | `cotizacionesRouter` | `server/src/routes/cotizaciones.ts` |
| `/api/pedidos` | `pedidosRouter` | `server/src/routes/pedidos.ts` |
| `/api/facturas` | `facturasRouter` | `server/src/routes/facturas.ts` |
| `/api/audit-log` | `auditLogRouter` | `server/src/routes/auditLog.ts` |
| `/webhook/whatsapp` | `whatsappWebhookRouter` | `server/src/routes/whatsappWebhook.ts` |

El router de clientes también expone sub-recursos: contactos (`GET/POST/DELETE /api/clients/:id/contacts`), direcciones (`.../addresses`), interacciones (`.../interactions`), cartera (`.../cartera`) y límite de crédito (`PATCH .../credit-limit`). No requieren montaje aparte en `index.ts`.

Varios routers aplican el rol a nivel de **router completo** (no solo a la ruta sensible): `clients`, `cotizaciones`, `pedidos` y `facturas` exigen ventas; `dispatches` y `warehouse` exigen almacén; `production-orders` exige OPERARIOS + CALIDAD + AUDITORIA (cada grupo accede a lo suyo dentro del router); `users`, `dashboard` y `export` exigen `ROLES.ADMIN` (`export` suma rol de ventas en `/pedidos` y `/facturas`). Ver [06 — Backend](06-backend.md).

Al iniciar, `index.ts` también arranca el cron de purga semanal de "Frecuentes" (`scheduleFrecuentesReset`).

## Configuración compartida (una sola instancia)

`server/src/prisma.ts` exporta un único `PrismaClient`. Todos los routers y servicios lo importan. El proyecto no crea una conexión por archivo.

El cliente se exporta **envuelto** en una extensión de Prisma (`withAudit`, `server/src/services/auditExtension.ts`). La extensión intercepta `create`/`update`/`delete` sobre las tablas críticas (Client, Dispatch, ProductionEntry, InventoryMovement) y escribe un `AuditLog` con el estado antes/después y quién lo hizo. El "quién/desde dónde" (usuario, IP, user-agent) llega por `AsyncLocalStorage`, capturado en `requireAuth`. Los routers existentes no se tocan: la extensión envuelve el cliente compartido, no cada endpoint. Ver [06 — Backend](06-backend.md).
