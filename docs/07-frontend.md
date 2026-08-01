# 07 — Frontend

## Stack

- **React 18 + TypeScript** (SPA).
- **Vite** como bundler/dev server (puerto 5173, con proxy `/api` → backend).
- **Tailwind CSS** para estilos.
- **TanStack Query** para estado del servidor (caché, loading, re-fetch).
- **React Router** para navegación.
- **vite-plugin-pwa** (Workbox) → PWA instalable. Caché offline del dashboard de inventario.

## Estructura de carpetas

```
client/
├── index.html
├── vite.config.ts        → proxy /api + configuración PWA
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
└── src/
    ├── main.tsx          → proveedores (QueryClient, Auth, Router)
    ├── App.tsx           → definición de rutas + guard RequireAuth
    ├── index.css
    ├── api/
    │   └── client.ts     → helper fetch con token y tipos
    ├── auth/
    │   └── AuthContext.tsx → estado de sesión (localStorage)
    ├── components/
    │   └── Layout.tsx    → header, nav y <Outlet />
    └── pages/
        ├── Login.tsx
        ├── InventoryDashboard.tsx
        ├── ProductionUpload.tsx
        └── Dispatches.tsx
```

## `main.tsx` — composición de proveedores

```tsx
<QueryClientProvider client={queryClient}>
  <AuthProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </AuthProvider>
</QueryClientProvider>
```

## `App.tsx` — rutas

```tsx
<Routes>
  <Route path="/login" element={<Login />} />
  <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
    <Route index element={<InventoryDashboard />} />
    <Route path="despachos" element={<Dispatches />} />
    <Route path="produccion" element={<ProductionUpload />} />
  </Route>
</Routes>
```

- `RequireAuth` redirige a `/login` si no hay usuario.
- Las rutas protegidas viven dentro de `<Layout />` (nav + `<Outlet />`).

## `api/client.ts` — el helper HTTP

Es el **único** punto que hace `fetch`. Toda página usa sus métodos.

```ts
const API_BASE = "/api";

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

Métodos expuestos (`api.*`):

| Método | HTTP | Uso |
|---|---|---|
| `login(email, password)` | POST /auth/login | |
| `getInventory(category?)` | GET /inventory | |
| `getAlerts()` | GET /inventory/alerts | |
| `getProducts()` | GET /inventory/products | |
| `getClients()` / `createClient(name)` | GET/POST /clients | |
| `createProductionEntry(data)` | POST /production/entries | |
| `previewImport(file)` | POST /production/import/preview (`FormData`) | |
| `confirmImport(filename, rows)` | POST /production/import/confirm | |
| `getDispatches(params?)` | GET /dispatches | |
| `createDispatch(clientId, items)` | POST /dispatches | |
| `markItemDispatched(dispatchId, itemId, qty)` | PATCH /dispatches/:id/items/:id | |

## `auth/AuthContext.tsx` — sesión

- Guarda `token` y `user` en `localStorage`.
- `login(token, user)` los persiste y actualiza el estado.
- `logout()` los limpia.
- `useAuth()` expone `{ user, login, logout }`. Lanza error si se usa fuera del proveedor.
- El `user` incluye `role: "produccion" | "despacho" | "admin"`. El rol aún no condiciona la UI, pero está disponible.

## TanStack Query — patrón en las páginas

**Lectura** (`InventoryDashboard.tsx`):

```tsx
const { data: stock, isLoading } = useQuery({
  queryKey: ["inventory", category],
  queryFn: () => api.getInventory(category || undefined),
});
```

- `queryKey` varía con los filtros → caché por combinación de filtros.
- La UI muestra `isLoading` / datos.

**Invalidación tras mutaciones** (`ProductionUpload.tsx` / `Dispatches.tsx`):

```tsx
const queryClient = useQueryClient();
// tras confirmar importación:
queryClient.invalidateQueries({ queryKey: ["inventory"] });
queryClient.invalidateQueries({ queryKey: ["alerts"] });
// tras marcar un item despachado:
queryClient.invalidateQueries({ queryKey: ["dispatches"] });
queryClient.invalidateQueries({ queryKey: ["inventory"] });
queryClient.invalidateQueries({ queryKey: ["alerts"] });
```

Las consultas mutan con `api.*` directo. No hay `useMutation` todavía. Se usan handlers `async` y se invalidan claves.

## Páginas

### `Login.tsx`
- Formulario email + contraseña. Valores por defecto (`despacho@empresa.com` / `password123`).
- Al enviar: `api.login(...)` → `login(token, user)` → `navigate("/")`.

### `InventoryDashboard.tsx`
- Filtro por categoría (botones).
- Alerta superior si hay productos bajo el stock mínimo (`api.getAlerts`).
- Tabla de stock (`api.getInventory`) con columnas SKU, Producto, Medida, Stock actual, Mínimo, Estado (bajo el stock mínimo).

### `ProductionUpload.tsx`
- Sube Excel/CSV → `api.previewImport` → muestra preview con filas válidas/inválidas.
- "Confirmar importación" → `api.confirmImport` → invalida inventario y alertas.

### `Dispatches.tsx`
- Filtros de cliente (desde `api.getClients`) y estado.
- Lista de despachos con items. Botón "Marcar despachado" por item → `api.markItemDispatched` → invalida despachos/inventario/alertas.
- **No hay aún UI de creación de despachos**. El endpoint `POST /dispatches` existe y `api.createDispatch` está definido, pero sin pantalla.

## `components/Layout.tsx`

- Header oscuro con nombre del usuario y botón "Salir" (`logout`).
- Nav con `NavLink` activo: **Inventario** (`/`), **Despachos** (`/despachos`), **Carga de Producción** (`/produccion`).
- `<Outlet />` renderiza la página de la ruta.

## PWA (`vite.config.ts`)

- `registerType: "autoUpdate"`.
- Manifest: nombre "Inventario y Despachos", `display: "standalone"`.
- `runtimeCaching`: `StaleWhileRevalidate` para todo lo que matchea `/\/api\/inventory/`. Incluye `/api/inventory/alerts` y `/api/inventory/products`. Es la caché offline del stock.

## Dependencias principales (`client/package.json`)

- `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `tailwindcss`, `vite`, `vite-plugin-pwa`, `@vitejs/plugin-react`.
