# 07 — Frontend

## Stack

- **React 19 + TypeScript** (SPA).
- **Vite 8** como bundler/dev server (puerto 5173, con proxy `/api` → backend).
- **Tailwind CSS 4** para estilos (`@import "tailwindcss"`, sin `tailwind.config`). Modo oscuro por clase (`@custom-variant dark`), ver [Modo oscuro](#modo-oscuro).
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
    ├── main.tsx          → proveedores (QueryClient, Auth, Theme, Shortcuts, Router)
    ├── App.tsx           → rutas + guards RequireAuth, RequireRole y RequireStationRole
    ├── index.css         → @import "tailwindcss" + @custom-variant dark + fallback de color base en modo oscuro
    ├── api/
    │   └── client.ts     → objeto `api` (único helper fetch, tipado)
    ├── auth/
    │   └── AuthContext.tsx → sesión (localStorage) y tipo UserRole (12 valores)
    ├── theme/
    │   └── ThemeContext.tsx → preferencia de tema (claro/oscuro/sistema), persistida por usuario
    ├── lib/
    │   └── frequency.ts  → motor "Frecuentes" del lado del cliente (byFrequency, nextInteraction)
    ├── components/
    │   ├── Layout.tsx    → shell: Sidebar (con cajón móvil) + header (con NotificationBell y ThemeToggle) + <Outlet />
    │   ├── Sidebar.tsx   → menú lateral filtrado por rol + atajos; cajón (`drawer`) en móvil
    │   ├── Sidebar.css   → variables CSS del sidebar (tema oscuro) + breakpoints móviles
    │   ├── NavIcon.tsx   → mapa clave → ícono lucide
    │   ├── navConfig.ts  → ítems del menú con `roles` por entrada + filterNavSections
    │   ├── useShortcuts.tsx / ShortcutsConfig.tsx → atajos favoritos (localStorage)
    │   ├── Modal.tsx     → modal genérico sin dependencias
    │   ├── ClienteAvatar.tsx → avatar del cliente (foto o iniciales)
    │   ├── ClientePicker.tsx → selector de cliente con búsqueda por frecuencia
    │   ├── ClienteForm.tsx   → formulario crear/editar cliente con foto
    │   ├── ContactoForm.tsx  → formulario reutilizable crear/editar contacto
    │   ├── BarcodeScanner.tsx → escaneo QR/código de barras por cámara (`html5-qrcode`), modal reutilizable
    │   ├── NotificationBell.tsx → campanita del header: no-leídas (polling 60s) + dropdown
    │   ├── ThemeToggle.tsx   → botón sol/luna del header, alterna claro/oscuro
    │   ├── ProductoForm.tsx  → formulario crear/editar producto
    │   └── UsuarioForm.tsx   → formulario crear/editar usuario
    └── pages/
        ├── Login.tsx
        ├── ForgotPassword.tsx
        ├── ResetPassword.tsx
        ├── InventoryDashboard.tsx
        ├── Dispatches.tsx
        ├── DespachosPorCliente.tsx → historial de despachos agrupado por cliente y producto (rol de ventas y almacén)
        ├── ProductionUpload.tsx
        ├── OrdenesProduccion.tsx → lista de OPs y alta de una OP nueva (nace sin proceso, ver "Destino")
        ├── OrdenProduccionDetalle.tsx → **la hoja de trabajo de una OP** (ruta `/produccion/ordenes/:id`): acá pasa todo el trabajo real de estación
        ├── EstacionProduccion.tsx → solo la cola de una estación + escáner, ya no carga rollos (ver más abajo)
        ├── ProduccionPorOperario.tsx → reporte por operario/turno/estación en un rango de fechas
        ├── EtiquetasBulto.tsx → genera e imprime etiquetas de bulto (`E. BULTO-*`) para mercancía comprada afuera
        ├── MateriaPrima.tsx → catálogo, stock y ajustes manuales de insumos de Extrusión
        ├── Planeacion.tsx    → cola de Planeación: ítems de pedidos sin OP + generar OP
        ├── Calidad.tsx       → cola de OPs `pendiente_calidad`: aprobar o rechazar el lote
        ├── Trazabilidad.tsx  → historial completo de una OP (estaciones, calidad, origen)
        ├── Auditoria.tsx     → bitácora forense de tablas críticas (filtro + diff expandible)
        ├── Clients.tsx       → listado con búsqueda/filtros/vistas + ficha del cliente
        ├── NuevoCliente.tsx  → página dedicada "Crear cliente" (botón "+" del listado)
        ├── Contactos.tsx     → pantalla global de contactos
        ├── Cotizaciones.tsx
        ├── Pedidos.tsx
        ├── Facturas.tsx
        ├── SecuritySettings.tsx
        ├── Apariencia.tsx        → preferencia de tema: claro/oscuro/sistema
        ├── Productos.tsx        → CRUD de catálogo + impresión de etiquetas QR
        ├── Usuarios.tsx          → CRUD de usuarios y roles
        ├── Almacen.tsx           → ubicaciones de bodega + stock por ubicación (Almacén/WMS)
        ├── UbicacionDetalle.tsx  → página pública del QR de una ubicación (ruta `/qr/:token`, sin login)
        ├── Movimientos.tsx       → historial paginado de movimientos de inventario
        ├── DashboardEjecutivo.tsx   → KPIs de ventas, cartera y producción
        ├── DashboardIndicadores.tsx → indicadores de calidad y producción
        ├── Notificaciones.tsx    → lista completa de notificaciones del usuario
        └── Exportaciones.tsx     → descarga de Excel (inventario/pedidos/facturas/clientes)
```

`components/` también suma: `AsyncState.tsx` (estado de carga/error reutilizable para una query), `Skeleton.tsx` (`SkeletonRows`, placeholders de carga para tablas), `ConfirmDialog.tsx` (`useConfirm`, diálogo de confirmación sin `window.confirm`), `ErrorBoundary.tsx` y `ErrorToast.tsx` (captura y aviso de errores no controlados).

## `main.tsx` — composición de proveedores

```tsx
<QueryClientProvider client={queryClient}>
  <AuthProvider>
    <ThemeProvider>
      <ShortcutsProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ShortcutsProvider>
    </ThemeProvider>
  </AuthProvider>
</QueryClientProvider>
```

`ThemeProvider` va **adentro** de `AuthProvider`: necesita `useAuth()` para guardar la preferencia de tema por usuario (ver [Modo oscuro](#modo-oscuro)).

## `App.tsx` — rutas

```tsx
<Routes>
  {/* públicas */}
  <Route path="/login" element={<Login />} />
  <Route path="/forgot-password" element={<ForgotPassword />} />
  <Route path="/reset-password" element={<ResetPassword />} />
  <Route path="/qr/:token" element={<UbicacionDetalle />} />  {/* pública: el token es la credencial */}

  {/* protegidas — RequireAuth valida la sesión; RequireRole valida el rol */}
  <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
    <Route index element={<InventoryDashboard />} />
    <Route path="despachos" element={<RequireRole roles={ALMACEN}><Dispatches /></RequireRole>} />
    <Route path="despachos/por-cliente" element={<RequireRole roles={DESPACHOS_LECTURA}><DespachosPorCliente /></RequireRole>} />
    <Route path="produccion" element={<RequireRole roles={[...ALMACEN, ...PRODUCCION_GESTION]}><ProductionUpload /></RequireRole>} />
    <Route path="produccion/ordenes" element={<RequireRole roles={PRODUCCION_GESTION}><OrdenesProduccion /></RequireRole>} />
    <Route path="produccion/ordenes/:id" element={<RequireRole roles={OP_DETALLE}><OrdenProduccionDetalle /></RequireRole>} />
    <Route path="produccion/estacion/:station" element={<RequireStationRole><EstacionProduccion /></RequireStationRole>} />
    <Route path="produccion/por-operario" element={<RequireRole roles={PRODUCCION_GESTION}><ProduccionPorOperario /></RequireRole>} />
    <Route path="produccion/etiquetas-bulto" element={<RequireRole roles={PRODUCCION_GESTION}><EtiquetasBulto /></RequireRole>} />
    <Route path="inventario/materia-prima" element={<RequireRole roles={CATALOGO_GESTION}><MateriaPrima /></RequireRole>} />
    <Route path="calidad" element={<RequireRole roles={CALIDAD}><Calidad /></RequireRole>} />
    <Route path="trazabilidad" element={<RequireRole roles={[...PRODUCCION_GESTION, ...CALIDAD, ...AUDITORIA]}><Trazabilidad /></RequireRole>} />
    <Route path="auditoria" element={<RequireRole roles={AUDITORIA}><Auditoria /></RequireRole>} />
    <Route path="planeacion" element={<RequireRole roles={PRODUCCION_GESTION}><Planeacion /></RequireRole>} />
    <Route path="clientes" element={<RequireRole roles={VENTAS}><Clients /></RequireRole>} />
    <Route path="clientes/nuevo" element={<RequireRole roles={VENTAS}><NuevoCliente /></RequireRole>} />
    <Route path="clientes/contactos" element={<RequireRole roles={VENTAS}><Contactos /></RequireRole>} />
    <Route path="clientes/cotizaciones" element={<RequireRole roles={VENTAS}><Cotizaciones /></RequireRole>} />
    <Route path="pedidos" element={<RequireRole roles={VENTAS}><Pedidos /></RequireRole>} />
    <Route path="facturas" element={<RequireRole roles={VENTAS}><Facturas /></RequireRole>} />
    <Route path="configuracion/autenticacion" element={<RequireRole roles={ADMIN}><SecuritySettings /></RequireRole>} />
    <Route path="configuracion/usuarios" element={<RequireRole roles={ADMIN}><Usuarios /></RequireRole>} />
    <Route path="configuracion/apariencia" element={<Apariencia />} />  {/* sin RequireRole: preferencia personal, no algo que restringir por rol */}
    <Route path="inventario/productos" element={<RequireRole roles={PRODUCCION_GESTION}><Productos /></RequireRole>} />
    <Route path="inventario/movimientos" element={<RequireRole roles={ALMACEN}><Movimientos /></RequireRole>} />
    <Route path="almacen" element={<RequireRole roles={ALMACEN}><Almacen /></RequireRole>} />
    <Route path="dashboard-ejecutivo" element={<RequireRole roles={ADMIN}><DashboardEjecutivo /></RequireRole>} />
    <Route path="dashboard-indicadores" element={<RequireRole roles={ADMIN}><DashboardIndicadores /></RequireRole>} />
    <Route path="exportaciones" element={<RequireRole roles={ADMIN}><Exportaciones /></RequireRole>} />
    <Route path="notificaciones" element={<Notificaciones />} />  {/* sin RequireRole: cualquier autenticado ve las suyas */}
  </Route>
</Routes>
```

- `RequireAuth` redirige a `/login` si no hay usuario en sesión.
- `RequireRole` muestra un mensaje de acceso denegado si el rol no pertenece al grupo. Los grupos (`VENTAS`, `ALMACEN`, `PRODUCCION_GESTION`, `OPERARIOS`, `CALIDAD`, `AUDITORIA`, `ADMIN`, …) vienen de `navConfig.ts`.
- `RequireStationRole` mapea la estación de la URL al grupo de operarios adecuado (`extrusion`→ extrusión, `impresion`→ impresión, `sellado`→ sellado, `precorte`→ precorte), usando los subgrupos `OP_EXTRUSION`, `OP_IMPRESION`, `OP_SELLADO` y `OP_PRECORTE` (cada uno un subconjunto de `OPERARIOS` con un solo rol de operario) definidos también en `navConfig.ts`.
- `OP_DETALLE` (`App.tsx`) es la unión de `OPERARIOS`, `CALIDAD` y `AUDITORIA` — protege `/produccion/ordenes/:id`, la hoja de trabajo completa de una OP, para que cualquiera de esos roles pueda entrar (cada uno ve/edita según su propio permiso dentro de la página). `DESPACHOS_LECTURA` y `CATALOGO_GESTION` (`navConfig.ts`) son grupos análogos para despachos de solo lectura y gestión de catálogo/materia prima.
- `/qr/:token` es la **única ruta pública fuera de `Layout`**: la abre el QR físico impreso de una ubicación de bodega. No pasa por `RequireAuth` — el token de la URL es la credencial (ver [05 — API](05-api.md), `publicLocation.ts`).

## Menú lateral

`navConfig.ts` declara los ítems del menú. Cada ítem tiene un campo `roles` (los grupos de roles que lo ven), un `icon` como **clave** (p. ej. `"users"`, `"truck"`, `"factory"`) y un `group?` opcional (p. ej. `"Ventas"`, `"Producción"`, `"Inventario"`, `"Sistema"`). `NavIcon.tsx` resuelve la clave a un componente de `lucide-react`. `Sidebar.tsx` dibuja un separador con el nombre del grupo arriba de un ítem cuando su `group` cambia respecto del ítem visible anterior (para el rol actual) — un ítem sin `group` no lleva separador. Los módulos del roadmap no construidos salen como `disabled: true` con la etiqueta "Próximamente".

La función `filterNavSections(role)` filtra secciones y entradas según el rol del usuario. `Sidebar.tsx` llama a `filterNavSections(user.role)` y dibuja solo lo que el rol puede ver. Los atajos (`useShortcuts`, `ShortcutsConfig`) aplican el mismo filtro con `buildChoices(role)`: un operario no puede marcar como atajo un módulo sin acceso.

Grupos de roles nuevos en `navConfig.ts`: `TODOS` (los 12 roles — usado por la entrada "Notificaciones" y por la sección "Configuración", que ahora es visible para cualquier rol; sus dos ítems internos, "Autenticación" y "Usuarios", siguen restringidos a `ADMIN` — solo el ítem "Apariencia" hereda `TODOS`) e `INVENTARIO` (`ADMIN` + `almacen_despachos` + `gerente_produccion` + `planeacion` + `ventas_pedidos`, uso interno del archivo).

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
| Clientes (CRM) | `getClients()`, `createClient(name)`, `updateClient(id, data)`, `uploadClientAvatar(id, file)`, `recordClientVisit(id)`, `deleteClient(id)`, `getAllContacts()`, `recordContactVisit(contactId)`, `updateClientContact(id, contactId, data)`, `updateCreditLimit(id, creditLimit)`, `getClientContacts(id)`, `createClientContact(id, data)`, `deleteClientContact(id, contactId)`, `getClientAddresses(id)`, `createClientAddress(id, data)`, `deleteClientAddress(id, addressId)`, `getClientInteractions(id)`, `createClientInteraction(id, data)`, `getClientCartera(id)`, `getClientTopProducts(id, limit?)`, `getClientManualProducts(id)`, `addClientManualProduct(id, data)`, `deleteClientManualProduct(id, manualProductId)` |
| Producción | `createProductionEntry(data)`, `previewImport(file)`, `confirmImport(filename, rows)`, `getProductionOrders(params?: { status?, station? })`, `getProductionOrder(id)`, `createProductionOrder(data)` (nace **sin** `station`; se deriva después), `deriveProductionOrder(id, data)`, `updateProductionOrder(id, data)` (incluye `clientId` para editar el Destino), `updateProductionOrderStatus(id, status)`, `updateMaterialPara(id, materialPara)`, `closeProductionOrder(id)`, `reopenProductionOrder(id)`, `releaseProductionOrder(id)`, `createProductionRoll(id, data)` (acepta `sourceRollId?`), `deleteProductionRoll(id, rollId)`, `getProductionRollLabel(id, rollId)` (etiqueta QR imprimible del rollo, con el código por-estación `EXT-1`/`PRE-1`/…), `getProductionRollByCode(code)` (resuelve un rollo por su QR, para el escaneo de rollo madre), `downloadProductionOrderPdf(id, filename)` (descarga como blob), `getProductionOrderAttachments(id)`, `uploadProductionOrderAttachment(id, file)`, `downloadProductionOrderAttachment(id, attachmentId, filename)`, `getPendingPlanning()`, `createProductionOrderFromPedidoItem(pedidoVersionItemId)`, `getProduccionPorOperario(params?: { from?, to?, station? })` |
| Materia prima | `getRawMaterials()`, `getRawMaterialStock()`, `getRawMaterialAlerts()`, `getRawMaterialMovements(params?)`, `createRawMaterial(data)`, `updateRawMaterial(id, data)`, `deactivateRawMaterial(id)`, `reactivateRawMaterial(id)`, `adjustRawMaterialStock(id, quantity, type, notes?)` |
| Etiquetas de bulto | `getBultoLabels(status?)`, `generateBultoLabels(count)`, `getBultoLabelQr(id)`, `getBultoLabelByCode(code)` |
| Calidad | `submitQualityCheck(id, { result, observations? })` |
| Despachos | `getDispatches(params?)`, `createDispatch(clientId, items)`, `markItemDispatched(dispatchId, itemId, qty)`, `cancelDispatch(dispatchId)` (revierte el stock ya despachado, transaccional) |
| Comercial | `getCotizaciones(clientId?)`, `createCotizacion(data)`, `updateCotizacionStatus(id, status)`, `convertCotizacionToPedido(id)`, `downloadCotizacionPdf(id, filename)` (descarga como blob), `getPedidos(params?)`, `createPedido(data)`, `getPedidoVersions(id)`, `updatePedido(id, data)`, `duplicatePedido(id)`, `getPedidoAttachments(id)`, `uploadPedidoAttachment(id, file)`, `downloadPedidoAttachment(pedidoId, attachmentId, filename)` (descarga como blob), `getFacturas(params?)`, `createFactura(data)` (acepta `dueDate?`), `createFacturaFromPedido(pedidoId)`, `anularFactura(id)`, `getFacturaPayments(id)`, `createPayment(id, data)`, `downloadFacturaPdf(id, filename)` (descarga como blob) |
| Auditoría | `getAuditLog(params?: { tableName?, recordId?, page?, pageSize? })` |
| Productos | `getAllProducts()`, `createProduct(data)`, `updateProduct(id, data)`, `deactivateProduct(id)`, `reactivateProduct(id)`, `getProductLabel(id)` (QR + SKU para la etiqueta) |
| Usuarios | `getUsers()`, `createUser(data)`, `updateUser(id, data)`, `deactivateUser(id)`, `reactivateUser(id)` |
| Almacén / WMS | `getWarehouseLocations()`, `createWarehouseLocation(data)`, `getWarehouseStock()`, `assignWarehouseStock(data)`, `getWarehouseLocationQr(id)`, `getWarehouseLocationByToken(token)`, `getPublicLocation(token)` (sin token de sesión — consume la ruta pública) |
| Inventario (movimientos) | `getInventoryMovements(params?: { productId?, movementType?, page?, pageSize? })` |
| Dashboard | `getDashboardResumen()`, `getDashboardIndicadores(params?: { from?, to? })` |
| Notificaciones | `getNotifications()`, `getUnreadNotificationCount()`, `markNotificationRead(id)`, `markAllNotificationsRead()` |
| Exportaciones | `downloadExport(resource: "inventario" \| "pedidos" \| "facturas" \| "clientes")` (descarga como blob, mismo patrón que `downloadPedidoAttachment`) |

## `auth/AuthContext.tsx` — sesión

- Guarda `token` y `user` en `localStorage`.
- `login(token, user)` los persiste y actualiza el estado. `logout()` los limpia.
- `useAuth()` expone `{ user, login, logout }`. Lanza error si se usa fuera del proveedor.
- El tipo `UserRole` tiene **12 valores** (matriz completa).

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
- Pantalla partida: panel de marca (logo, frase de bienvenida) a la izquierda, solo en pantallas grandes (`lg:`); en celular se oculta y el formulario ocupa toda la pantalla, para no desperdiciar espacio.
- El logo (`logo-full.png`) siempre va sobre una tarjeta de **fondo blanco fijo**, sin importar el tema: el PNG trae texto oscuro "quemado" (no es un SVG que se adapte con `currentColor`), así que en modo oscuro quedaba casi invisible.
- Email + contraseña + paso TOTP si `api.login` devuelve `requires2fa`.
- Al autenticar con éxito, no navega de una: muestra una **pantalla de transición** (`WelcomeTransition`, 1.6 s) con 3 frases rotando y el nombre del usuario, y solo entonces navega a `/`. Es puramente cosmético — la sesión ya quedó armada antes de mostrarla — para que el salto del formulario al dashboard no se sienta brusco.

### `ForgotPassword.tsx` / `ResetPassword.tsx`
- Formulario de recuperación y de nueva contraseña (lee `?token=` de la URL).

### `InventoryDashboard.tsx`
- Filtro por categoría. Alerta superior si hay productos bajo el mínimo (`api.getAlerts`). Tabla de stock con SKU, producto, medida, stock actual, mínimo y estado.

### `ProductionUpload.tsx`
- Sube Excel/CSV → `api.previewImport` → preview válidas/inválidas → "Confirmar" → `api.confirmImport` e invalida inventario/alertas.

### `Dispatches.tsx`
- Filtros de cliente y estado. Lista despachos, botón "Marcar despachado" por ítem. La **creación de despachos existe solo vía API** (`api.createDispatch`); la UI aún no la expone.
- Escaneo de producto por cámara con `BarcodeScanner`.

### `OrdenesProduccion.tsx`
- Lista OPs con indicador de etapas completadas (íconos de lucide por estación).
- El alta crea una OP **sin proceso asignado** (nace "en blanco"): el formulario solo pide producto, cantidad y el campo **Destino**.
- **Destino** es un radio: **Estantería** (stock general, sin cliente — el valor por defecto) o **Cliente** (elige un cliente puntual, `ClientePicker`). Se guarda como `clientId` en la OP; internamente no hay un campo "destino", es la UI la que traduce `clientId` presente/ausente a estas dos etiquetas. Cambia el resultado de Calidad: si la OP tiene cliente y se aprueba, el sistema genera un despacho automático a ese cliente (ver [08 — Reglas de negocio](08-workflow.md)).
- Cada fila lleva a `OrdenProduccionDetalle.tsx` (`/produccion/ordenes/:id`) — ahí pasa el resto del trabajo.

### `OrdenProduccionDetalle.tsx`
Es la **hoja de trabajo completa de una OP** — reemplaza lo que antes vivía repartido entre la lista y la pantalla de estación. Desde acá:
- Se **deriva** la OP al siguiente proceso (`GitBranch`, grafo extrusión→impresión/sellado/precorte, impresión→sellado/precorte), solo gestión de producción.
- Se edita el encabezado/specs de la plantilla (`OP_TEMPLATES`, por estación) mientras la OP esté abierta, incluido el campo **Destino** (select: "Estantería (stock general)" o el nombre del cliente).
- Se cargan **rollos**: formulario con los campos de la plantilla de la estación (`OP_TEMPLATES`), escaneo de un rollo madre por cámara (`BarcodeScanner`) para completar `sourceRollId`, y vista previa del reparto de kilos entre rollos madre escaneados (`previewAllocation`, misma cuenta que hace el servidor) antes de guardar.
- **Rollo madre con saldo vivo** (Sellado/Precorte): cada rollo madre escaneado se muestra como una ficha (`SourceRollChip`) con su **saldo restante** (`remainingKg`, lo calcula el servidor). Un rollo chico puede agotar un madre y seguir tomando kilos del siguiente escaneado — el reparto real vive en `RollConsumption` (ver [04 — Base de datos](04-database.md)).
- El código de un rollo (etiqueta, QR, "insumo: rollo X") se muestra con el **prefijo de su estación y su numeración propia** (`EXT-1`, `EXT-2`… `PRE-1`, `PRE-2`…, `ROLL_CODE_PREFIX` + `stationSequence`), no un id global — así coincide con lo que el operario ve pegado en el rollo físico.
- Se **cierra** la OP (requiere ≥1 rollo) y, si gestión lo necesita, se **reabre** (`reopenProductionOrder`) o se **libera** (`releaseProductionOrder`) una OP bloqueada.
- Adjuntos (subir/descargar) y descarga del **reporte PDF** consolidado.
- Reglas de UI por rol: cada estación solo la operan los grupos `OP_EXTRUSION` / `OP_IMPRESION` / `OP_SELLADO` / `OP_PRECORTE` (espejo de `OPERARIO_STATIONS` del backend) más gestión de producción.

**Corregido**: en la tarjeta de celular de "Registro de rollos / avance" (la fila de carga de un rollo nuevo, `md:hidden`), los campos automáticos (FECHA, TURNO, OPERARIO, HORA, ETIQUETA, TOTAL...) no se distinguían de los campos que sí hay que llenar a mano — ambos se veían como texto plano. Ahora los campos automáticos llevan un ícono de candado (`Lock`, lucide) y quedan sobre fondo celeste; los campos editables usan un estilo de input real (`draftInput`: fondo blanco/oscuro sólido, borde visible, foco con anillo) en vez del estilo "hoja de papel" transparente (`sheetInput`) que se usa en el resto de la plantilla — ese estilo es intencional para las Especificaciones (parece papel impreso), pero en la fila de carga hacía que no se notara cuál campo era tocable hasta que ya se había tocado. También se agregó una leyenda arriba de la tarjeta explicando el flujo (completar → **Confirmar rollo**, ya no editable después) y se renombró el botón de "+ Agregar fila" a **"Confirmar rollo"** para que quede explícito que ese es el paso que lo guarda y lo bloquea — antes de confirmar, los campos siguen siendo editables las veces que haga falta. Verificado en el navegador con Playwright en viewport de celular (iPhone 13): se cargó y confirmó un rollo de prueba (`EXT-3`, 12.5 kg) de punta a punta.

**Pendiente**: hoy la única forma de corregir un rollo **ya confirmado** (guardado) es **borrarlo** (`handleDeleteRoll`, botón de tacho) y volver a cargarlo — no se puede editar un rollo ya guardado (peso, desperdicio, detalles). Falta una forma de corregir esos datos sin perder el rollo (por ejemplo, un modal de edición), sobre todo porque una fila con un rollo madre asociado no se puede borrar si ya se le sacó material en otra estación.

**Pendiente**: `deriveSpecsFromMeasure` (línea ~67) no es robusta a cualquier texto que el usuario escriba en el campo "Medidas". La función espera un patrón `número` o `número x número` al inicio del texto; un valor sin ese patrón (vacío, solo símbolos, o un separador que no es `x`/`X`) no deriva nada, pero un valor a medio escribir puede dejar campos derivados (`ancho`, `calibre`, `medAncho`, `medLargo`) a medio completar o con el número mal partido antes de que el usuario termine de tipear. Hay que revisar el parseo para que sea tolerante a cualquier entrada intermedia sin dejar valores basura en los campos derivados.

**Corregido**: cambiar el campo **"Material para"** (sección FORMA DEL MATERIAL, único campo que un operario puede guardar solo, vía `handleMaterialParaChange`) invalidaba `["productionOrder", orderId]` después de guardar. Ese refetch disparaba de nuevo el `useEffect` que reconstruye `specsDraft` a partir de `order.specs` (línea ~267) y, como el servidor solo había guardado `materialPara`, pisaba con eso cualquier otro dato de ESPECIFICACIONES que el usuario ya hubiera escrito sin guardar todavía (el guardado de esa sección es aparte, con su propio botón). Se quitó esa invalidación de `handleMaterialParaChange` — el campo ya se refleja localmente en `specsDraft` sin necesidad de releer toda la OP. Verificado a mano en el navegador (Playwright, ventana visible): se creó una OP de Extrusión, se escribió un valor en Calibre sin guardar, se cambió "Material para" y el valor de Calibre siguió intacto.

### `EstacionProduccion.tsx`
- Ya **no** carga rollos ni cierra OPs — eso se mudó por completo a `OrdenProduccionDetalle.tsx`.
- Hoy es solo la **cola de la estación**: lista las OPs de ese proceso (abiertas primero) y da un acceso rápido por **escaneo QR** (`BarcodeScanner`) para saltar directo a la hoja de la OP escaneada.

### `ProduccionPorOperario.tsx`
- Reporte por operario: filas de rollos agrupadas por operario/día/estación en un rango de fechas, con conteo de rollos, kilos y desperdicio (`api.getProduccionPorOperario`). Rol de gestión de producción.

### `EtiquetasBulto.tsx`
- Genera lotes de etiquetas de bulto (`E. BULTO-*`, `BultoLabel`) e imprime stickers térmicos 40×30 mm con QR (mismo patrón de ventana nueva que `Productos.tsx`).
- Es solo para mercancía **comprada afuera** que entra como bulto — no para rollos que el sistema ya etiqueta solo al cargarlos. El operario escanea la etiqueta usada al cargar el rollo en vez de tipear el número a mano; una etiqueta usada no se puede volver a escanear.

### `MateriaPrima.tsx`
- CRUD del catálogo de insumos de Extrusión (`RawMaterial`) y su stock (`RawMaterialStock`): crear/editar/desactivar/reactivar, ver alertas de mínimo y el historial de movimientos, y hacer ajustes manuales de entrada/salida.
- El descuento automático (al cerrar una OP de Extrusión) no pasa por acá — es lógica de servidor. Ver [08 — Reglas de negocio](08-workflow.md).

### `DespachosPorCliente.tsx`
- Historial de despachos agrupado por cliente y producto: cantidad total despachada, número de despachos y fecha del último, para responder "¿qué le hemos despachado a este cliente?" sin recorrer despacho por despacho.

### `Clients.tsx`
- Layout maestro–detalle en dos columnas: listado (izquierda) y ficha (derecha).
- Filtros de orden: **ABC**, **Antigüedad** (`createdAt`) y **Frecuentes** (orden por defecto). El orden Frecuentes usa `byFrequency(viewCount, lastViewedAt)` de `client/src/lib/frequency.ts`.
- Vistas: **lista** o **cajas** (avatar con `ClienteAvatar`, fallback de iniciales). Preselección opcional con `location.state.selectedClientId`.
- Al abrir la ficha se registra la visita (`api.recordClientVisit`) con actualización optimista (`nextInteraction`).
- La ficha tiene **6 pestañas**: contactos, direcciones, historial, cartera, **productos** y editar/eliminar.
- Pestaña "Productos" (`ClientManualProduct`): productos que el cliente pide, cargados **a mano** (cantidad y notas opcionales). Es una lista aparte de los "top productos" que el sistema calcula solo del historial real de pedidos — nunca se mezclan, se muestran como dos secciones separadas. Sirve para un cliente nuevo sin pedidos todavía, o para dejar registrado lo que pedía antes de este sistema. Cargar el mismo producto dos veces actualiza la fila existente en vez de duplicarla.
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

### `Calidad.tsx`
- Cola de OPs `pendiente_calidad` (`api.getProductionOrders("pendiente_calidad")`). Muestra OP, producto, cantidad planificada y el kilaje del precorte.
- Por fila: **Aprobar** (envía `api.submitQualityCheck(id, { result: "aprobado" })`) o **Rechazar** (pide motivo opcional antes de confirmar, `result: "rechazado"`). Tras el éxito invalida `["productionOrders"]`.
- El bloque de acciones (aprobar/rechazar con motivo) vive en un componente de módulo aparte, no anidado en el render de la fila: anidado, React lo remontaba en cada tecla y el textarea del motivo perdía el foco.

### `Trazabilidad.tsx`
- Selector de OP (`api.getProductionOrders`) + detalle de solo lectura (`api.getProductionOrder(id)`).
- Muestra el producto y la cantidad planificada, el **origen** (pedido/cliente si vino de Planeación, o "Producción a stock"), la lista de pasos por estación y el **resultado de Calidad** (aprobado/rechazado con observaciones y quién lo registró).

### `Auditoria.tsx`
- Bitácora forense (`api.getAuditLog`) con filtro **por tabla** (Client, Dispatch, ProductionEntry, InventoryMovement) y paginado.
- Cada fila expandible muestra el diff **antes/después** (JSON) y el user-agent. La columna Usuario sale del `include.user.name`.

### `Cotizaciones.tsx` / `Pedidos.tsx` / `Facturas.tsx`
- Crear y listar cotizaciones con estado; pedidos versionados con adjuntos; facturas con abonos y anulación.
- **Pedidos**: un clic en un pedido de la lista abre su **detalle completo** (antes solo se veía en la lista). El detalle de un pedido `pendiente` tiene un botón **"Aprobar y enviar a Planeación"** (`handleAprobar`): pasa el pedido a `aprobado` sin abrir un formulario aparte, para no obligar a editar el pedido solo para aprobarlo. Una vez aprobado, sus ítems entran a la cola de Planeación (ver [08 — Reglas de negocio](08-workflow.md)).
- El formulario de cotización usa **`ClientePicker.tsx`**: con el campo **vacío** sugiere **4 clientes por frecuencia** (`byFrequency(viewCount, lastViewedAt)`); a partir del 1.º carácter filtra por coincidencia; muestra la foto del seleccionado (`ClienteAvatar`); `×` limpia y `Esc`/clic afuera cierran el listado.
- **Pendiente**: reutilizar `ClientePicker` en otros módulos de selección de cliente (Pedidos, Facturas, Despachos).
- El botón **"Cotizar"** de la ficha del cliente navega a `/clientes/cotizaciones` con el cliente preseleccionado (`location.state.clientId`).
- El alta de cliente vive solo en el botón "+ Crear cliente" del listado (`/clientes/nuevo`).
- Cada ítem de cotización/pedido/factura se edita dentro de su propia tarjeta (`border rounded p-2`, cantidad y precio en una fila con `flex-1`) en vez de una grilla de columnas fijas — así los inputs no se desbordan en pantallas angostas.
- **Cotizaciones**: botón **"PDF"** / **"Descargar PDF"** por fila llama a `api.downloadCotizacionPdf(id, quoteNumber)`.
- **Facturas**: el formulario de alta tiene un campo **"Vencimiento (opcional)"** (`dueDate`). La lista marca **"Vencida"** (`isVencida`, calculado en el cliente igual que en el backend) junto al estado; el detalle muestra "Vence: `fecha`" y, si aplica, "· Vencida" en rojo. Botón **"Descargar PDF"** en el encabezado del detalle llama a `api.downloadFacturaPdf(id, invoiceNumber)`.

### `SecuritySettings.tsx`
- Activar/desactivar 2FA: `setup2fa` (QR) → `verify2fa` → estado activo.

### `Apariencia.tsx`
- Selector de tema con 3 opciones (Claro/Oscuro/Sistema), mismo patrón visual que `SecuritySettings.tsx`. Usa `useTheme()` para leer y fijar la preferencia. Visible para cualquier rol (ruta `configuracion/apariencia` sin `RequireRole`).

### `Productos.tsx`
- CRUD de catálogo: `api.getAllProducts`, `createProduct`, `updateProduct`, `deactivateProduct` (soft delete), `reactivateProduct`. Modal con `ProductoForm` para crear/editar.
- Selección múltiple + botón "Imprimir etiquetas": pide `api.getProductLabel` de cada seleccionado y abre una ventana nueva con los QR listos para imprimir (`printLabels`, con `escapeHtml` sobre el contenido para evitar XSS vía `document.write`).

### `Usuarios.tsx`
- CRUD de usuarios y roles: `api.getUsers`, `createUser`, `updateUser`, `deactivateUser`, `reactivateUser`. Modal con `UsuarioForm`.
- `deactivateUser` sobre el propio usuario devuelve `400`; la UI muestra un mensaje explicando que no puede autodesactivarse.

### `Almacen.tsx`
- Ubicaciones de bodega y su stock: `api.getWarehouseLocations`, `getWarehouseStock`, `createWarehouseLocation`, `assignWarehouseStock`, `getWarehouseLocationQr`, `getWarehouseLocationByToken`.
- Filas expandibles con un formulario de asignación (mover/ubicar stock entre ubicaciones), con escaneo de producto por `BarcodeScanner`. Botón "Escanear producto" busca por SKU. Modal con el QR imprimible de cada ubicación.

### `UbicacionDetalle.tsx`
- Página **pública** (ruta `/qr/:token`, fuera de `Layout`, sin login) a la que apunta el QR físico de una ubicación. Usa `api.getPublicLocation(token)` con refetch cada 5 s (`refetchInterval: 5000`) para reflejar el stock casi en tiempo real.

### `Movimientos.tsx`
- Historial paginado de `InventoryMovement` (`api.getInventoryMovements`), filtro por tipo de movimiento, paginación de 50, badges de color por tipo y signo (+/−) según sea entrada o salida.

### `DashboardEjecutivo.tsx`
- KPIs (`api.getDashboardResumen`): ventas del mes con variación %, cartera pendiente, **cartera vencida** (resaltada en rojo si es mayor a 0), facturas con saldo, OPs en curso, pedidos en producción, cotizaciones abiertas.
- Gráfico de barras de ventas de 6 meses (Recharts) y top 5 clientes con mayor saldo pendiente.

### `DashboardIndicadores.tsx`
- Indicadores (`api.getDashboardIndicadores(range)`): tasa de aprobación de calidad, checks aprobados/rechazados, tiempo promedio de producción en horas.
- Gráfico de barras horizontal con el top 5 de productos despachados en el rango.
- **Rango de fechas configurable**: dos inputs `type="date"` ("Desde"/"Hasta") con estado borrador propio, más un botón **"Aplicar"** que recién ahí actualiza el `range` que dispara el refetch (`queryKey: ["dashboardIndicadores", range.from, range.to]`) — cambiar las fechas sin aplicar no dispara pedidos de más. Arranca con los últimos 30 días por defecto.

### `Notificaciones.tsx`
- Lista completa de notificaciones del usuario (`api.getNotifications`). Botones para marcar una (`markNotificationRead`) o todas (`markAllNotificationsRead`) como leídas. Un clic navega al `link` de la notificación.

### `Exportaciones.tsx`
- Cuatro tarjetas (Inventario / Pedidos / Facturas / Clientes); cada una dispara `api.downloadExport(resource)` y descarga un `.xlsx`.

## `components/Layout.tsx`

- Sidebar oscuro generado desde `navConfig`, header con nombre de usuario, `NotificationBell` y botón "Salir" (`logout`), y `<Outlet />`.
- **Móvil**: `Sidebar` gana un cajón (`drawer`, prop `mobileOpen`/`onCloseMobile`) que se abre con un botón hamburguesa (ícono `Menu` de lucide, visible solo por debajo del breakpoint `md`) en el header. El cajón se cierra solo al navegar (`useEffect` sobre `location.pathname`).

## Modo oscuro

- Tailwind v4 no trae variante `dark` por defecto en modo clase: `client/src/index.css` la habilita con `@custom-variant dark (&:where(.dark, .dark *));`. La clase `.dark` se aplica sobre `<html>`.
- `.dark body { color: #e2e8f0; }` en `index.css` da un color base a todo texto sin clase de color propia (spans y divs sueltos de listados). Evita perseguir cada elemento suelto uno por uno.
- `theme/ThemeContext.tsx` (`ThemeProvider`/`useTheme`) expone `{ preference: "light" | "dark" | "system", resolved: "light" | "dark", setPreference }`. Si `preference` es `"system"`, resuelve con `window.matchMedia("(prefers-color-scheme: dark)")` y escucha su evento `change`.
- **Persistencia por usuario**: la preferencia se guarda en `localStorage` bajo la key `ps_theme:<userId>` (`ps_theme:anon` si no hay sesión) — no es una preferencia de dispositivo, sino de cada usuario logueado. Al cambiar de usuario en el mismo dispositivo, cada uno ve su propia preferencia (o "Sistema" por defecto si nunca la fijó), no la del anterior.
- `client/index.html` trae un script inline en el `<head>` que lee la misma key antes de que React monte y aplica `.dark` a `<html>` de una — evita el flash de contenido claro al cargar.
- `components/ThemeToggle.tsx` es el ícono sol/luna del header (alterna claro/oscuro); `pages/Apariencia.tsx` da las 3 opciones completas (Claro/Oscuro/Sistema).
- **Gráficos de Recharts** (`DashboardEjecutivo.tsx`, `DashboardIndicadores.tsx`): el color de barras y ejes es un prop JS, no una clase CSS — `dark:` no aplica ahí. Se resuelve leyendo `resolved` de `useTheme()` y eligiendo el color a mano (p. ej. `fill={resolved === "dark" ? "#38bdf8" : "#1e293b"}`).
- Los colores de modo oscuro se validaron contra WCAG AA (contraste mínimo 4.5:1 texto normal, 3:1 texto grande/UI), no solo a ojo.

## Convención: páginas con ancho máximo

Una página con `max-w-*` (p. ej. `max-w-4xl`) siempre lleva `mx-auto` junto al `max-w-*`. Sin `mx-auto`, el contenido queda pegado a la izquierda en pantallas anchas en vez de centrado. Al crear una página nueva con ancho limitado, agregue las dos clases juntas.

## PWA (`vite.config.ts`)

- `registerType: "autoUpdate"`. El service worker se registra **a mano** en `main.tsx` (`injectRegister: false`) para forzar la recarga cuando hay una build nueva; así nadie queda pegado en un build viejo en memoria.
- Manifest: nombre "Plásticos Superior", `short_name` "Pl. Superior", `display: "standalone"`, tema `#0f172a`.
- `runtimeCaching`: `StaleWhileRevalidate` para lo que coincide con `/\/api\/inventory/`. Las mutaciones (POST/PATCH/DELETE) nunca se cachean.

## Dependencias principales (`client/package.json`)

- `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `lucide-react`, `tailwindcss`, `vite`, `vite-plugin-pwa`, `@vitejs/plugin-react`, `@tailwindcss/vite`.
- `recharts` (gráficos del dashboard), `html5-qrcode` (escaneo QR/código de barras por cámara, `BarcodeScanner.tsx`).