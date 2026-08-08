# 07 — Frontend

## Stack

- **React 19 + TypeScript** (SPA).
- **Vite 8** como bundler/dev server (puerto 5173, con proxy `/api` → backend).
- **Tailwind CSS 4** para estilos (`@import "tailwindcss"`, sin `tailwind.config`).
- **lucide-react** para íconos SVG (sin emojis).
- **TanStack Query** para estado del servidor (caché, loading, re-fetch).
- **React Router 7** para navegación.
- **vite-plugin-pwa** (Workbox) → PWA instalable. Caché offline del dashboard de inventario.

## Estructura de carpetas

```
client/
├── index.html
├── vite.config.ts        → proxy /api + plugin Tailwind + PWA
├── tsconfig.json
└── src/
    ├── main.tsx          → proveedores (QueryClient, Auth, Router)
    ├── App.tsx           → definición de rutas + guard RequireAuth
    ├── index.css         → solo @import "tailwindcss"
    ├── api/
    │   └── client.ts     → objeto `api` (único helper fetch, tipado)
    ├── auth/
    │   └── AuthContext.tsx → sesión (localStorage) y tipo UserRole (11 valores)
    ├── components/
    │   ├── Layout.tsx    → shell: Sidebar + header + <Outlet />
    │   ├── Sidebar.tsx   → menú lateral + atajos
    │   ├── Sidebar.css   → variables CSS del sidebar (tema oscuro)
    │   ├── NavIcon.tsx   → mapa clave → ícono lucide
    │   ├── navConfig.ts  → declaración de los ítems del menú (iconos por clave)
    │   ├── useShortcuts.tsx / ShortcutsConfig.tsx → atajos favoritos (localStorage)
    │   └── Modal.tsx     → modal genérico sin dependencias
    └── pages/
        ├── Login.tsx
        ├── ForgotPassword.tsx
        ├── ResetPassword.tsx
        ├── InventoryDashboard.tsx
        ├── Dispatches.tsx
        ├── ProductionUpload.tsx
        ├── OrdenesProduccion.tsx
        ├── EstacionProduccion.tsx
        ├── Clients.tsx
        ├── Cotizaciones.tsx
        ├── Pedidos.tsx
        ├── Facturas.tsx
        └── SecuritySettings.tsx
```

## `main.tsx` — composición de proveedores

```tsx
<QueryClientProvider client={queryClient}>
  <AuthProvider>
    <ShortcutsProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ShortcutsProvider>
  </AuthProvider>
</QueryClientProvider>
```

## `App.tsx` — rutas

```tsx
<Routes>
  {/* públicas */}
  <Route path="/login" element={<Login />} />
  <Route path="/forgot-password" element={<ForgotPassword />} />
  <Route path="/reset-password" element={<ResetPassword />} />

  {/* protegidas */}
  <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
    <Route index element={<InventoryDashboard />} />
    <Route path="despachos" element={<Dispatches />} />
    <Route path="produccion" element={<ProductionUpload />} />
    <Route path="clientes" element={<Clients />} />
    <Route path="clientes/nuevo" element={<Clients />} />
    <Route path="clientes/contactos" element={<Clients />} />
    <Route path="clientes/cotizaciones" element={<Cotizaciones />} />
    <Route path="produccion/ordenes" element={<OrdenesProduccion />} />
    <Route path="produccion/estacion/:station" element={<EstacionProduccion />} />
    <Route path="pedidos" element={<Pedidos />} />
    <Route path="facturas" element={<Facturas />} />
    <Route path="configuracion/autenticacion" element={<SecuritySettings />} />
  </Route>
</Routes>
```

- `RequireAuth` redirige a `/login` si no hay usuario en sesión.
- `Clients` es una sola pantalla con 3 modos según `pathname`.

## Menú lateral

`navConfig.ts` declara los ítems del menú. Cada ítem usa un `icon` como **clave** (p. ej. `"users"`, `"truck"`, `"factory"`) y `NavIcon.tsx` la resuelve a un componente de `lucide-react`. Los módulos del roadmap no construidos salen como `disabled: true` con la etiqueta "Próximamente".

## `api/client.ts` — el helper HTTP

Es el **único** punto que hace `fetch`. Toda página usa sus métodos.

```ts
const API_BASE = "/api";   // sin dominio: usa el proxy de Vite

async function request<T>(path, options) {
  const token = getToken();                     // localStorage.getItem("token")
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(opciones multipart ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
```

Métodos expuestos (`api.*`), agrupados por dominio:

| Dominio | Métodos |
|---|---|
| Auth | `login(email, password, totpToken?)`, `getMe()`, `forgotPassword(email)`, `resetPassword(token, newPassword)`, `setup2fa()`, `verify2fa(token)`, `disable2fa(token)` |
| Inventario | `getInventory(category?)`, `getAlerts()`, `getProducts()` |
| Clientes (CRM) | `getClients()`, `createClient(name)`, `updateCreditLimit(id, creditLimit)`, `getClientContacts(id)`, `createClientContact(id, data)`, `deleteClientContact(id, contactId)`, `getClientAddresses(id)`, `createClientAddress(id, data)`, `deleteClientAddress(id, addressId)`, `getClientInteractions(id)`, `createClientInteraction(id, data)`, `getClientCartera(id)` |
| Producción | `createProductionEntry(data)`, `previewImport(file)`, `confirmImport(filename, rows)`, `getProductionOrders(status?)`, `createProductionOrder(data)`, `updateProductionOrderStatus(id, status)`, `getProductionOrderStages(id)`, `createProductionStageLog(id, data)` |
| Despachos | `getDispatches(params?)`, `createDispatch(clientId, items)`, `markItemDispatched(dispatchId, itemId, qty)` |
| Comercial | `getCotizaciones(clientId?)`, `createCotizacion(data)`, `updateCotizacionStatus(id, status)`, `convertCotizacionToPedido(id)`, `getPedidos(params?)`, `createPedido(data)`, `getPedidoVersions(id)`, `updatePedido(id, data)`, `duplicatePedido(id)`, `getPedidoAttachments(id)`, `uploadPedidoAttachment(id, file)` (descarga como blob), `getFacturas(params?)`, `createFactura(data)`, `createFacturaFromPedido(pedidoId)`, `anularFactura(id)`, `getFacturaPayments(id)`, `createPayment(id, data)` |

## `auth/AuthContext.tsx` — sesión

- Guarda `token` y `user` en `localStorage`.
- `login(token, user)` los persiste y actualiza el estado. `logout()` los limpia.
- `useAuth()` expone `{ user, login, logout }`. Lanza error si se usa fuera del proveedor.
- El tipo `UserRole` tiene **11 valores** (matriz completa).

> El frontend **no** filtra por rol: `RequireAuth` solo comprueba que haya sesión. El control de permisos vive en el servidor (`requireRole`). Ver [06 — Backend](06-backend.md).

## TanStack Query — patrón en las páginas

**Lectura** (`InventoryDashboard.tsx`):

```tsx
const { data: stock, isLoading } = useQuery({
  queryKey: ["inventory", category],
  queryFn: () => api.getInventory(category || undefined),
});
```

- `queryKey` varía con los filtros → caché por combinación.
- La UI muestra `isLoading` / datos.

**Invalidación tras mutaciones**:

```tsx
const queryClient = useQueryClient();
// tras confirmar una importación de producción:
queryClient.invalidateQueries({ queryKey: ["inventory"] });
queryClient.invalidateQueries({ queryKey: ["alerts"] });
// tras marcar un item despachado:
queryClient.invalidateQueries({ queryKey: ["dispatches"] });
queryClient.invalidateQueries({ queryKey: ["inventory"] });
queryClient.invalidateQueries({ queryKey: ["alerts"] });
// tras registrar una etapa de producción:
queryClient.invalidateQueries({ queryKey: ["productionOrderStages", id] });
queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
queryClient.invalidateQueries({ queryKey: ["inventory"] });
```

Las consultas mutan con `api.*` directo (patrón imperativo, sin `useMutation`).

## Páginas

### `Login.tsx`
- Email + contraseña + paso TOTP si `api.login` devuelve `requires2fa`. Valores por defecto `despacho@empresa.com` / `password123`.
- Al autenticar: `api.login(...)` → `login(token, user)` → `navigate("/")`.

### `ForgotPassword.tsx` / `ResetPassword.tsx`
- Formulario de recuperación y de nueva contraseña (lee `?token=` de la URL).

### `InventoryDashboard.tsx`
- Filtro por categoría. Alerta superior si hay productos bajo el mínimo (`api.getAlerts`). Tabla de stock con SKU, producto, medida, stock actual, mínimo y estado.

### `ProductionUpload.tsx`
- Sube Excel/CSV → `api.previewImport` → preview válidas/inválidas → "Confirmar" → `api.confirmImport` e invalida inventario/alertas.

### `Dispatches.tsx`
- Filtros de cliente y estado. Lista despachos, botón "Marcar despachado" por item. La **creación de despachos existe solo vía API** (`api.createDispatch`); la UI aún no la expone.

### `OrdenesProduccion.tsx`
- Lista OPs con indicador de etapas completadas (íconos de lucide por estación). Crea OPs y cambia estado.

### `EstacionProduccion.tsx`
- Pantalla por `:station`. El operario registra su etapa (kilos, merma, tiempos, etc.).

### `Clients.tsx`
- Ficha del cliente con pestañas: contactos, direcciones, interacciones y cartera.

### `Cotizaciones.tsx` / `Pedidos.tsx` / `Facturas.tsx`
- Crear y listar cotizaciones con estado; pedidos versionados con adjuntos; facturas con abonos y anulación.

### `SecuritySettings.tsx`
- Activar/desactivar 2FA: QR (`setup2fa`) → `verify2fa` → estado activo.

## `components/Layout.tsx`

- Sidebar oscuro generado desde `navConfig`, header con nombre de usuario y botón "Salir" (`logout`), y `<Outlet />`.

## PWA (`vite.config.ts`)

- `registerType: "autoUpdate"`.
- Manifest: nombre "Inventario y Despachos", `display: "standalone"`.
- `runtimeCaching`: `StaleWhileRevalidate` para todo lo que matchea `/\/api\/inventory/` (incluye `/api/inventory/alerts` y `/api/inventory/products`). Las mutaciones (POST/PATCH/DELETE) nunca se cachean.

## Dependencias principales (`client/package.json`)

- `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `lucide-react`, `tailwindcss`, `vite`, `vite-plugin-pwa`, `@vitejs/plugin-react`, `@tailwindcss/vite`.