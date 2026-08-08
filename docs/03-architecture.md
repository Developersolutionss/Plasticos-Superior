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

- Todo es **JSON** (salvo la subida de Excel, que es `multipart/form-data`).
- Respuestas de éxito: JSON plano del recurso (objeto o arreglo). También `{ "ok": true }` o `204` en mutaciones simples.
- Respuestas de error: `{ "error": string }` o `{ "error": ..., "details": ... }` (errores de zod).

### Autenticación (JWT)

1. El usuario hace login → `POST /api/auth/login`. El servidor valida las credenciales. Firme un token con `jwt.sign({ userId, role, name }, JWT_SECRET, { expiresIn: "12h" })`.
2. El frontend guarda `token` y `user` en `localStorage` (ver `client/src/auth/AuthContext.tsx`).
3. Cada request protegido viaja con `Authorization: Bearer <token>`.
4. El middleware `requireAuth` (`server/src/middleware/auth.ts`) verifica la firma. Expone `req.user`. Si el token falta o es inválido → `401`.

El token define **quién es** el usuario. Después del login, las rutas sensibles aplican `requireRole(...)` con los grupos de `ROLES` (Ventas, Almacén, Producción, Operarios) de `server/src/middleware/auth.ts`:

- `requireAuth` protege **todo** router (excepto login y webhook de WhatsApp).
- `requireRole(...)` restringe una ruta concreta. Devuelve `403` si el rol no está en la lista.
- `super_admin` y `admin` pertenecen a todos los grupos, así que siempre pasan.

Ejemplo: `POST /api/cotizaciones` exige rol de ventas; `POST /api/production-orders/:id/stages` exige un rol de operario, y el operario solo registra su estación (via `OPERARIO_STATIONS`).

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

1. **Frontend**: `client/src/pages/Dispatches.tsx` llama `api.getClients()` → `fetch("/api/clients")` con `Authorization: Bearer <token>`.
2. **Vite proxy** (dev): reenvía a `http://localhost:4000/api/clients`.
3. **Express**: `server/src/index.ts` monta `app.use("/api/clients", clientsRouter)`.
4. **Router**: `clientsRouter.use(requireAuth)` valida el token. El handler consulta `prisma.client.findMany({ where: { active: true } })`.
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
| `/api/auth` | `authRouter` | `server/src/routes/auth.ts` |
| `/api/clients` | `clientsRouter` | `server/src/routes/clients.ts` |
| `/api/inventory` | `inventoryRouter` | `server/src/routes/inventory.ts` |
| `/api/production` | `productionRouter` | `server/src/routes/production.ts` |
| `/api/production-orders` | `productionOrdersRouter` | `server/src/routes/productionOrders.ts` |
| `/api/dispatches` | `dispatchesRouter` | `server/src/routes/dispatches.ts` |
| `/api/cotizaciones` | `cotizacionesRouter` | `server/src/routes/cotizaciones.ts` |
| `/api/pedidos` | `pedidosRouter` | `server/src/routes/pedidos.ts` |
| `/api/facturas` | `facturasRouter` | `server/src/routes/facturas.ts` |
| `/webhook/whatsapp` | `whatsappWebhookRouter` | `server/src/routes/whatsappWebhook.ts` |

El router de clientes también expone sub-recursos: contactos (`GET/POST/DELETE /api/clients/:id/contacts`), direcciones (`.../addresses`), interacciones (`.../interactions`), cartera (`.../cartera`) y límite de crédito (`PATCH .../credit-limit`). No requieren montaje aparte en `index.ts`.

## Configuración compartida (una sola instancia)

`server/src/prisma.ts` exporta un único `PrismaClient`. Todos los routers y servicios lo importan. El proyecto no crea una conexión por archivo.
