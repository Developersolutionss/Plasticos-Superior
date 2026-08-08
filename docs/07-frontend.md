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
    ├── App.tsx           → rutas + guards RequireAuth, RequireRole y RequireStationRole
    ├── index.css         → solo @import "tailwindcss"
    ├── api/
    │   └── client.ts     → objeto `api` (único helper fetch, tipado)
    ├── auth/
    │   └── AuthContext.tsx → sesión (localStorage) y tipo UserRole (11 valores)
    ├── lib/
    │   └── frequency.ts  → motor "Frecuentes" del lado del cliente (byFrequency, nextInteraction)
    ├── components/
    │   ├── Layout.tsx    → shell: Sidebar + header + <Outlet />
    │   ├── Sidebar.tsx   → menú lateral filtrado por rol + atajos
    │   ├── Sidebar.css   → variables CSS del sidebar (tema oscuro)
    │   ├── NavIcon.tsx   → mapa clave → ícono lucide
    │   ├── navConfig.ts  → ítems del menú con `roles` por entrada + filterNavSections
    │   ├── useShortcuts.tsx / ShortcutsConfig.tsx → atajos favoritos (localStorage)
    │   ├── Modal.tsx     → modal genérico sin dependencias
    │   ├── ClienteAvatar.tsx → avatar del cliente (foto o iniciales)
    │   ├── ClientePicker.tsx → selector de cliente con búsqueda por frecuencia
    │   ├── ClienteForm.tsx   → formulario crear/editar cliente con foto
    │   └── ContactoForm.tsx  → formulario reutilizable crear/editar contacto
    └── pages/
        ├── Login.tsx
        ├── ForgotPassword.tsx
        ├── ResetPassword.tsx
        ├── InventoryDashboard.tsx
        ├── Dispatches.tsx
        ├── ProductionUpload.tsx
        ├── OrdenesProduccion.tsx
        ├── EstacionProduccion.tsx
        ├── Planeacion.tsx    → cola de Planeación: items de pedidos sin OP + generar OP
        ├── Clients.tsx       → listado con búsqueda/filtros/vistas + ficha del cliente
        ├── NuevoCliente.tsx  → página dedicada "Crear cliente" (botón "+" del listado)
        ├── Contactos.tsx     → pantalla global de contactos
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

  {/* protegidas — RequireAuth valida la sesión; RequireRole valida el rol */}
  <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
    <Route index element={<InventoryDashboard />} />
    <Route path="despachos" element={<RequireRole roles={ALMACEN}><Dispatches /></RequireRole>} />
    <Route path="produccion" element={<RequireRole roles={[...ALMACEN, ...PRODUCCION_GESTION]}><ProductionUpload /></RequireRole>} />
    <Route path="produccion/ordenes" element={<RequireRole roles={PRODUCCION_GESTION}><OrdenesProduccion /></RequireRole>} />
    <Route path="produccion/estacion/:station" element={<RequireStationRole><EstacionProduccion /></RequireStationRole>} />
    <Route path="planeacion" element={<RequireRole roles={PRODUCCION_GESTION}><Planeacion /></RequireRole>} />
    <Route path="clientes" element={<RequireRole roles={VENTAS}><Clients /></RequireRole>} />
    <Route path="clientes/nuevo" element={<RequireRole roles={VENTAS}><NuevoCliente /></RequireRole>} />
    <Route path="clientes/contactos" element={<RequireRole roles={VENTAS}><Contactos /></RequireRole>} />
    <Route path="clientes/cotizaciones" element={<RequireRole roles={VENTAS}><Cotizaciones /></RequireRole>} />
    <Route path="pedidos" element={<RequireRole roles={VENTAS}><Pedidos /></RequireRole>} />
    <Route path="facturas" element={<RequireRole roles={VENTAS}><Facturas /></RequireRole>} />
    <Route path="configuracion/autenticacion" element={<RequireRole roles={ADMIN}><SecuritySettings /></RequireRole>} />
  </Route>
</Routes>
```

- `RequireAuth` redirige a `/login` si no hay usuario en sesión.
- `RequireRole` muestra un mensaje de acceso denegado si el rol no pertenece al grupo. Los grupos (`VENTAS`, `ALMACEN`, `PRODUCCION_GESTION`, `OPERARIOS`, `ADMIN`, …) vienen de `navConfig.ts`.
- `RequireStationRole` mapea la estación de la URL al grupo de operarios adecuado (`extrusion`→ extrusión, `impresion`→ impresión, `sellado`/`precorte`→ sellado-precorte).

## Menú lateral

`navConfig.ts` declara los ítems del menú. Cada ítem tiene un campo `roles` (los grupos de roles que lo ven) y un `icon` como **clave** (p. ej. `"users"`, `"truck"`, `"factory"`). `NavIcon.tsx` resuelve la clave a un componente de `lucide-react`. Los módulos del roadmap no construidos salen como `disabled: true` con la etiqueta "Próximamente".

La función `filterNavSections(role)` filtra secciones y entradas según el rol del usuario. `Sidebar.tsx` llama a `filterNavSections(user.role)` y dibuja solo lo que el rol puede ver. Los atajos (`useShortcuts`, `ShortcutsConfig`) aplican el mismo filtro con `buildChoices(role)`: un operario no puede marcar como atajo un módulo sin acceso.

## `api/client.ts` — el helper HTTP

Es el **único** punto que hace `fetch`. Toda página usa sus métodos.

```ts
const API_BASE = "/api";   // sin dominio: usa el proxy de Vite

function getToken() {
  return localStorage.getItem("token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      // FormData (subidas de archivos) no lleva Content-Type manual: lo pone el navegador
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
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
| Clientes (CRM) | `getClients()`, `createClient(name)`, `updateClient(id, data)`, `uploadClientAvatar(id, file)`, `recordClientVisit(id)`, `deleteClient(id)`, `getAllContacts()`, `recordContactVisit(contactId)`, `updateClientContact(id, contactId, data)`, `updateCreditLimit(id, creditLimit)`, `getClientContacts(id)`, `createClientContact(id, data)`, `deleteClientContact(id, contactId)`, `getClientAddresses(id)`, `createClientAddress(id, data)`, `deleteClientAddress(id, addressId)`, `getClientInteractions(id)`, `createClientInteraction(id, data)`, `getClientCartera(id)` |
| Producción | `createProductionEntry(data)`, `previewImport(file)`, `confirmImport(filename, rows)`, `getProductionOrders(status?)`, `createProductionOrder(data)`, `updateProductionOrderStatus(id, status)`, `getProductionOrderStages(id)`, `createProductionStageLog(id, data)`, `getPendingPlanning()`, `createProductionOrderFromPedidoItem(pedidoVersionItemId)` |
| Despachos | `getDispatches(params?)`, `createDispatch(clientId, items)`, `markItemDispatched(dispatchId, itemId, qty)` |
| Comercial | `getCotizaciones(clientId?)`, `createCotizacion(data)`, `updateCotizacionStatus(id, status)`, `convertCotizacionToPedido(id)`, `getPedidos(params?)`, `createPedido(data)`, `getPedidoVersions(id)`, `updatePedido(id, data)`, `duplicatePedido(id)`, `getPedidoAttachments(id)`, `uploadPedidoAttachment(id, file)` (descarga como blob), `getFacturas(params?)`, `createFactura(data)`, `createFacturaFromPedido(pedidoId)`, `anularFactura(id)`, `getFacturaPayments(id)`, `createPayment(id, data)` |

## `auth/AuthContext.tsx` — sesión

- Guarda `token` y `user` en `localStorage`.
- `login(token, user)` los persiste y actualiza el estado. `logout()` los limpia.
- `useAuth()` expone `{ user, login, logout }`. Lanza error si se usa fuera del proveedor.
- El tipo `UserRole` tiene **11 valores** (matriz completa).

> El frontend replica el control del servidor: el menú se filtra con `filterNavSections(user.role)` y cada ruta valida su grupo con `RequireRole`. Un rol sin permiso no ve el ítem y no puede abrir la URL. El servidor sigue siendo la autoridad final (`requireRole`). Ver [06 — Backend](06-backend.md).

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
- Layout maestro–detalle en dos columnas: listado (izquierda) y ficha (derecha).
- Filtros de orden: **ABC**, **Antigüedad** (`createdAt`) y **Frecuentes** (orden por defecto). El orden Frecuentes usa `byFrequency(viewCount, lastViewedAt)` de `client/src/lib/frequency.ts`.
- Vistas: **lista** o **cajas** (avatar con `ClienteAvatar`, fallback de iniciales). Preselección opcional con `location.state.selectedClientId`.
- Al abrir la ficha se registra la visita (`api.recordClientVisit`) con actualización optimista (`nextInteraction`).
- La ficha tiene **5 pestañas**: contactos, direcciones, historial, cartera y editar/eliminar.
- Pestaña "Editar/Eliminar": botón "Editar" abre `ClienteForm` en modal; zona de peligro para **eliminar** (`api.deleteClient`, soft delete: `active: false`).

### `NuevoCliente.tsx`
- Página "Crear cliente": envuelve `ClienteForm` en modo crear. Tras guardar navega a `/clientes` y deja el cliente nuevo seleccionado.

### `ClienteForm.tsx` (componente reutilizable)
- Formulario único para **crear** y **editar** clientes. Campos: nombre, email/teléfono/notas (`contactInfo`), límite de crédito y **foto de perfil** (preview + upload).
- En modo crear: `createClient(name)` + `updateClient(id, datos)`. Si hay archivo: `uploadClientAvatar(id, file)`.

### `Contactos.tsx`
- Pantalla global de contactos de todos los clientes (`api.getAllContacts`). Buscador, filtro **por cliente** (select) y orden ABC / Antigüedad / Frecuentes. Vistas lista/cajas con el avatar del cliente relacionado.
- La frecuencia del contacto es **propia e independiente** de la del cliente (mismo motor, umbral `HOT_THRESHOLD`).
- Un clic en un contacto abre un **modal con sus datos** (cliente, cargo, teléfono `tel:`, email `mailto:`, principal, alta) y registra la visita (`api.recordContactVisit`, optimista con `nextInteraction`). `Esc` o el ✕ cierran el modal.
- El modal ofrece **"Editar"**: abre `ContactoForm` precargado y guarda con `api.updateClientContact`. Al marcar **principal**, el servidor desmarca a los demás.
- Cada contacto tiene un **menú ⋮**: "Abrir empresa" (navega a `/clientes` con el cliente seleccionado) y "Eliminar" (confirmación en dos pasos).

### `Planeacion.tsx`
- Cola de Planeación (`api.getPendingPlanning`). Tabla con pedido, cliente, producto (SKU), cantidad, medida y botón **"Generar OP"** por fila.
- "Generar OP" llama a `api.createProductionOrderFromPedidoItem`. Tras el éxito invalida `["pendingPlanning"]` y `["productionOrders"]`.

### `Cotizaciones.tsx` / `Pedidos.tsx` / `Facturas.tsx`
- Crear y listar cotizaciones con estado; pedidos versionados con adjuntos; facturas con abonos y anulación.
- El formulario de cotización usa **`ClientePicker.tsx`**: con el campo **vacío** sugiere **4 clientes por frecuencia** (`byFrequency(viewCount, lastViewedAt)`); a partir del 1.º carácter filtra por coincidencia; muestra la foto del seleccionado (`ClienteAvatar`); `×` limpia y `Esc`/clic afuera cierran el listado.
- **Pendiente**: reutilizar `ClientePicker` en otros módulos de selección de cliente (Pedidos, Facturas, Despachos).
- El botón **"Cotizar"** de la ficha del cliente navega a `/clientes/cotizaciones` con el cliente preseleccionado (`location.state.clientId`).
- El alta de cliente vive solo en el botón "+ Crear cliente" del listado (`/clientes/nuevo`).

### `SecuritySettings.tsx`
- Activar/desactivar 2FA: `setup2fa` (QR) → `verify2fa` → estado activo.

## `components/Layout.tsx`

- Sidebar oscuro generado desde `navConfig`, header con nombre de usuario y botón "Salir" (`logout`), y `<Outlet />`.

## PWA (`vite.config.ts`)

- `registerType: "autoUpdate"`. El service worker se registra **a mano** en `main.tsx` (`injectRegister: false`) para forzar la recarga cuando hay una build nueva; así nadie queda pegado en un build viejo en memoria.
- Manifest: nombre "Plásticos Superior", `short_name` "Pl. Superior", `display: "standalone"`, tema `#0f172a`.
- `runtimeCaching`: `StaleWhileRevalidate` para lo que coincide con `/\/api\/inventory/`. Las mutaciones (POST/PATCH/DELETE) nunca se cachean.

## Dependencias principales (`client/package.json`)

- `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `lucide-react`, `tailwindcss`, `vite`, `vite-plugin-pwa`, `@vitejs/plugin-react`, `@tailwindcss/vite`.