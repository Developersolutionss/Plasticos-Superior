# 05 — API

Base URL en desarrollo: `http://localhost:4000`. Los endpoints están bajo `/api/*`. El frontend los consume como `/api/*` a través del proxy de Vite. Ver [03 — Arquitectura](03-architecture.md).

## Autenticación

Todos los endpoints exigen el header:

```
Authorization: Bearer <token>
```

excepto:
- `POST /api/auth/login` (crea el token).
- `POST /api/auth/forgot-password` y `POST /api/auth/reset-password`.
- `GET /webhook/whatsapp` y `POST /webhook/whatsapp` (handshake de Meta).
- `GET /api/public/locations/:token` (consulta pública de una ubicación de bodega vía QR, sin login — ver sección Almacén/WMS).

Si el token falta o es inválido → `401 { "error": "..." }`.

### Obtener un token

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","password":"password123"}'
```

Respuesta (sin 2FA):

```json
{
  "token": "<jwt>",
  "user": { "id": 1, "name": "Admin", "role": "super_admin", "email": "admin@empresa.com", "twoFactorEnabled": false }
}
```

### Permisos por rol

Además de `requireAuth`, varios routers aplican el rol **a nivel de router** (protegen también los `GET`). Reglas por módulo:

- **Clientes (CRM)** — `GET /clients` acepta también almacén y gestión de producción (para elegir cliente al armar una OP o un despacho); el resto del módulo (crear, editar, contactos, direcciones, interacciones, cartera, productos manuales) exige rol de ventas (`super_admin`, `admin`, `ventas_pedidos`).
- **Cotizaciones, Pedidos y Facturas** — todo el módulo: rol de ventas.
- **Despachos** — la lectura (`GET /`, `GET /summary-by-client`) admite también Ventas (`ROLES.DESPACHOS_LECTURA`), para que puedan confirmarle a un cliente si ya se despachó. Crear, marcar ítems y cancelar siguen siendo solo de rol de almacén (`super_admin`, `admin`, `almacen_despachos`).
- **Órdenes de producción** — todo el módulo: rol de OPERARIOS (`ROLES.OPERARIOS`, que incluye gestión de producción). Crear, derivar, editar el encabezado, Planeación y borrar rollo/adjunto exigen además gestión de producción (`gerente_produccion`, `planeacion`). Cerrar una OP (`POST /:id/close`) es del **operario de esa estación** (`ROLES.CIERRE_OP`), no de gestión — gestión no cierra OPs directamente. `PATCH /:id/material-para` es de cualquier operario, pero solo puede tocar OPs de su propia estación. Registrar un rollo: operarios o gestión (un operario solo en **su** estación, `OPERARIO_STATIONS`). Calidad y Auditoría entran al router solo para las lecturas que necesitan (cola de Calidad, Trazabilidad); Calidad además tiene su propio endpoint de mutación (`POST /:id/quality-check`).
- **Etiquetas de bulto** — todo el módulo: rol de OPERARIOS. Generar un lote (`POST /generate`) exige además gestión de producción.
- **Producción** (alta manual/Excel) — almacén o gestión de producción.
- **Inventario** — `GET /`, `GET /alerts` exigen `ROLES.EXISTENCIAS` (almacén, planeación, ventas — **no** `gerente_produccion`, a pedido del cliente); `GET /products` (el selector de producto que reutilizan Cotizaciones/Pedidos/Facturas/OP) exige `ROLES.INVENTARIO` (existencias + `gerente_produccion`); `GET /movements` exige rol de almacén.
- **Materia prima** — todo el módulo: `ROLES.INVENTARIO`.
- **Almacén / WMS** — todo el módulo: rol de almacén.
- **Productos** — lectura y CRUD (crear/editar/desactivar/reactivar) exigen `ROLES.CATALOGO_GESTION` (`super_admin`, `admin`, `planeacion` — **no** `gerente_produccion`, a pedido del cliente: sigue pudiendo *elegir* un producto ya cargado con `ROLES.INVENTARIO`, pero no gestionar el catálogo).
- **Usuarios** — todo el módulo: solo `super_admin`/`admin` (`ROLES.ADMIN`).
- **Dashboard** y **Exportaciones** — todo el módulo: solo `ROLES.ADMIN`, excepto `GET /export/pedidos` y `GET /export/facturas` que además exigen rol de ventas.
- **Notificaciones** — solo `requireAuth`; cada usuario ve y marca únicamente las suyas.

> Los grupos de roles crecieron respecto de la versión inicial: además de `ADMIN`, `VENTAS`, `ALMACEN`, `PRODUCCION_GESTION`, `OPERARIOS`, `CALIDAD` y `AUDITORIA`, hoy existen `CIERRE_OP`, `INVENTARIO`, `EXISTENCIAS`, `CATALOGO_GESTION` y `DESPACHOS_LECTURA` (`server/src/middleware/auth.ts`, objeto `ROLES`). Cada uno separa un permiso que antes estaba mezclado con otro, a pedido del cliente (p. ej. "puede elegir un producto para una OP" ya no implica "puede ver cuánto stock hay" ni "puede editar el catálogo").

`GET /api/auth/me` no exige rol, pero sí token. `super_admin` y `admin` siempre pasan.

## Formato de errores

| Código | Cuándo | Body |
|---|---|---|
| 400 | Body inválido (zod), parámetro de URL inválido o regla de negocio fallida | `{ "error": ..., "details": {...} }` o `{ "error": "mensaje" }` |
| 401 | Token no provisto, inválido o expirado | `{ "error": "..." }` |
| 403 | Rol sin permiso, o estación no asignada al rol de operario | `{ "error": "..." }` |
| 404 | Recurso no encontrado | `{ "error": "..." }` |
| 423 | Login: cuenta bloqueada o se bloquea por intentos fallidos | `{ "error": "..." }` |

## Referencia de endpoints

### Auth

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password, totpToken? }` | Valida credenciales. Respuesta `{ token, user }`. Si el usuario tiene 2FA y no manda `totpToken` → `200 { requires2fa: true }`. 5 fallos seguidos bloquean la cuenta 15 min (`423`). También rechaza `401` si el usuario fue desactivado (`active: false` en el CRUD de Usuarios), con el mismo mensaje genérico que credenciales inválidas |
| GET | `/api/auth/me` | — | Datos del usuario actual desde el token |
| POST | `/api/auth/forgot-password` | `{ email }` | Crea un token de reseteo de 1 h y envía el link por email (o lo imprime en consola sin `RESEND_API_KEY`). Respuesta idéntica exista o no el correo |
| POST | `/api/auth/reset-password` | `{ token, newPassword }` | Valida el token hasheado, actualiza la contraseña y marca el token usado (transaccional, un solo uso) |
| POST | `/api/auth/2fa/setup` | — | Genera el secret TOTP y devuelve el QR (`qrCodeDataUrl`) sin activarlo aún. Devuelve `400` si el 2FA ya está activado (hay que pasar por `/2fa/disable` primero) |
| POST | `/api/auth/2fa/verify` | `{ token }` | Confirma un código TOTP de 6 dígitos y activa el 2FA |
| POST | `/api/auth/2fa/disable` | `{ token }` | Desactiva el 2FA (valida el código vigente) |

```bash
# login con 2FA (primero responde requires2fa → enviar totpToken)
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"despacho@empresa.com","password":"password123","totpToken":"123456"}'

# recuperación de contraseña
curl -X POST http://localhost:4000/api/auth/forgot-password \
  -H "Content-Type: application/json" -d '{"email":"despacho@empresa.com"}'
```

### Clientes (CRM)

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/clients` | — | Lista clientes activos, ordenados por nombre (incluye `avatarUrl`, `viewCount`, `lastViewedAt`) |
| POST | `/api/clients` | `{ name, contactInfo?, creditLimit? }` | Crea un cliente (rol de ventas). Nace **arriba del ranking** "Frecuentes" (máximo actual + 1) y con el umbral del ciclo ya alcanzado |
| PATCH | `/api/clients/:id` | `{ name?, contactInfo?, creditLimit? }` | Edita datos del cliente |
| POST | `/api/clients/:id/avatar` | multipart `avatar` (JPG/PNG/WEBP, ≤2 MB) | Sube o reemplaza la foto de perfil; setea `avatarUrl`. Borra el avatar anterior tras persistir |
| POST | `/api/clients/:id/visit` | — | Registra una visita a la ficha (motor "Frecuentes"): +1 interacción. Al llegar al umbral 5 sube `viewCount` al máximo+1 y consume el boost. Respuesta `{ viewCount, lastViewedAt, cycleInteractions }` |
| PATCH | `/api/clients/:id/credit-limit` | `{ creditLimit }` | Edita el límite de crédito manual |
| DELETE | `/api/clients/:id` | — | Desactiva el cliente (`active: false`, soft delete: conserva facturas/cotizaciones/pedidos y deja de aparecer en listas) |
| GET | `/api/clients/:id/cartera` | — | Saldo pendiente calculado (total facturado no anulado − pagos) + `facturasPendientes` (cada una con `saldo`, `dueDate` y `vencida`: `true` si `dueDate` ya pasó y todavía tiene saldo) |
| GET | `/api/clients/contacts` | — | **Lista global** de contactos con la empresa relacionada (nombre, `avatarUrl`, `viewCount`, `lastViewedAt`) — pantalla CRM "Contactos" |
| GET | `/api/clients/:id/contacts` | — | Contactos del cliente (principal primero) |
| POST | `/api/clients/:id/contacts` | `{ name, position?, phone?, email?, isPrimary? }` | Crea un contacto. Si `isPrimary: true`, desmarca los demás en una transacción |
| PATCH | `/api/clients/:id/contacts/:contactId` | `{ name, position?, phone?, email?, isPrimary? }` | Edita un contacto (misma validación que el alta). Si `isPrimary=true`, desmarca los demás en una transacción |
| DELETE | `/api/clients/:id/contacts/:contactId` | — | Borra un contacto; si era principal, asigna el más reciente restante |
| GET | `/api/clients/:id/addresses` | — | Lista direcciones del cliente |
| POST | `/api/clients/:id/addresses` | `{ label, addressLine, city?, region?, postalCode?, isPrimary?, notes? }` | Crea una dirección (principal exclusivo por transacción) |
| DELETE | `/api/clients/:id/addresses/:addressId` | — | Borra una dirección |
| GET | `/api/clients/:id/interactions` | — | Historial de interacciones |
| POST | `/api/clients/:id/interactions` | `{ type, description }` | Registra una interacción (`llamada` / `email` / `reunion` / `nota`) |
| POST | `/api/clients/contacts/:contactId/visit` | — | Visita a un contacto (frecuencia **propia** del contacto, mismo motor que clientes) |
| GET | `/api/clients/:id/top-products` | `?limit=` (máx 20, por defecto 5) | Top de productos **calculados** del historial real de pedidos del cliente (frecuencia y cantidad total, de la versión vigente de cada pedido) |
| GET | `/api/clients/:id/manual-products` | — | Productos que el cliente pide, **cargados a mano** (aparte de los calculados arriba) — para un cliente nuevo sin pedidos todavía, o para dejar registrado lo que pedía antes de este sistema |
| POST | `/api/clients/:id/manual-products` | `{ productId, quantity?, notes? }` | Crea o actualiza (upsert) un producto manual del cliente. Cargar el mismo producto dos veces actualiza cantidad/notas en vez de duplicar |
| DELETE | `/api/clients/:id/manual-products/:manualProductId` | — | Borra un producto manual del cliente |

```bash
curl http://localhost:4000/api/clients -H "Authorization: Bearer <token>"
curl http://localhost:4000/api/clients/1/cartera -H "Authorization: Bearer <token>"

curl -X POST http://localhost:4000/api/clients/1/contacts \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"María","position":"Compras","phone":"3001234","email":"maria@acme.com","isPrimary":true}'
```

Reglas de validación: en los endpoints de **contactos**, el `:id` debe ser numérico (`>0`); si no → `400`, y el recurso debe existir → `404`. Los endpoints de direcciones, interacciones, cartera y límite de crédito no replican esa validación de `:id`. El email del contacto se valida con zod.

### Inventario

| Método | Ruta | Query/Param | Descripción |
|---|---|---|---|
| GET | `/api/inventory` | `?category=rollos_fuelle` (opcional) | Stock de todos los productos (o filtrado por categoría). Incluye `currentStock`, `minStock`, `belowMinimum` |
| GET | `/api/inventory/alerts` | — | Solo productos bajo el stock mínimo |
| GET | `/api/inventory/products` | — | Catálogo de productos activos |
| GET | `/api/inventory/movements` | `?productId=&movementType=&page=&pageSize=` (rol almacén) | Historial paginado de `InventoryMovement` (`pageSize` tope 200, default 50). Devuelve `{ items, total, page, pageSize }` |

### Materia prima

Catálogo e inventario de insumos de Extrusión (BAJA, ALTA, BIODEGRADABLE, LINEAL, PIGMENTO, TERMO, SECANTE, ANTIBLOCK, AGLUTINADO, PELETIZADO — sembrados con esos códigos, ver `services/opTemplates.ts`). El stock se descuenta **solo** automáticamente: al cerrar una OP de Extrusión (`POST /production-orders/:id/close`), por cada fila de `specs.materiaPrima` con `kg` cargado se busca una `RawMaterial` cuyo `code` sea igual al `ref` de la fila y se resta ese kg — si no matchea ninguna, se avisa en `skippedRawMaterialRefs` de la respuesta pero **no bloquea** el cierre (la OP ya tiene rollos reales).

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/raw-materials` | — | Catálogo completo (incluye inactivos), rol INVENTARIO |
| GET | `/api/raw-materials/stock` | — | Stock por insumo con `currentStock`, `minStock`, `belowMinimum` |
| GET | `/api/raw-materials/alerts` | — | Solo insumos activos bajo el mínimo |
| GET | `/api/raw-materials/movements` | `?rawMaterialId=&page=&pageSize=` | Historial paginado de `RawMaterialMovement` |
| POST | `/api/raw-materials` | `{ code, name?, minStock? }` | Crea un insumo (gestión de producción). `409` si el código ya existe |
| PATCH | `/api/raw-materials/:id` | `{ code?, name?, minStock? }` | Edita un insumo |
| DELETE | `/api/raw-materials/:id` | — | Desactiva (soft delete) |
| POST | `/api/raw-materials/:id/reactivate` | — | Reactiva |
| POST | `/api/raw-materials/:id/adjust` | `{ quantity, notes? }` | Entrada manual (`quantity > 0`, movimiento `compra`) o ajuste (`quantity < 0`, movimiento `ajuste`) |

### Producción

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| POST | `/api/production/entries` | `{ sku, labelCode?, operatorName, clientName?, measure?, kilos, driverName?, observations? }` | Alta manual (almacén o gestión de producción). Crea la entrada + movimiento de entrada en una transacción |
| POST | `/api/production/import/preview` | `multipart/form-data`: campo `file` (xlsx/xls/csv, máx 10 MB) | Parsea y devuelve preview (filas válidas/inválidas) sin persistir. Exige almacén o gestión de producción (igual que `entries` e `import/confirm`) |
| POST | `/api/production/import/confirm` | `{ filename, rows: [...] }` | Persiste solo las filas válidas. Registra en `import_logs`. Devuelve `{ processed, failed, errors }` |

**Formato esperado del Excel/CSV** (columnas): `SKU | Etiqueta | Operario | Cliente | Medida | Kilos | Conductor | Observaciones`.

```bash
curl -X POST http://localhost:4000/api/production/import/preview \
  -H "Authorization: Bearer <token>" -F "file=@/ruta/reporte.csv"
```

### Órdenes de producción (OP)

Modelo: **una OP por proceso** (Extrusión / Impresión / Sellado / Precorte), replicando los formatos en papel del cliente. Extrusión es el proceso base; de ella se **derivan** las OPs de los procesos siguientes (`parentOrderId`). Toda la cadena derivada comparte el mismo `orderNumber` del padre raíz — es "una OP, un número", aunque cada estación siga siendo su propia fila con sus propios rollos/specs. Cada OP lleva sus specs de plantilla (`specs`, JSON — ver `services/opTemplates.ts`) y su **registro acumulativo de rollos** (`production_rolls`).

**Una OP nace en `borrador`, sin proceso asignado** (`station: null`): Gestión todavía tiene que cargar materia prima, medidas, cliente y referencia. Un operario puro nunca ve una OP en `borrador` (ni en el listado ni en el detalle: le devuelve `404`). El ciclo:

```
POST / o POST /from-pedido-item/:id   →   status: borrador, station: null
POST /:id/derive { station: "extrusion" }   →   asigna Extrusión (misma fila, no crea una nueva)
POST /:id/release                            →   status: pendiente (ya visible/operable para planta)
POST /:id/derive { station: "sellado" }, etc. →   crea la OP hija del siguiente proceso (nace en "pendiente")
POST /:id/close                              →   finalizada (Extrusión) o pendiente_calidad (Impresión/Sellado/Precorte)
POST /:id/quality-check                      →   finalizada + inventario, o detenida
```

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/production-orders` | `?status=` `?station=` (opcionales) | Lista OPs con producto, cliente, rollos (para sumar kg), OP padre y derivadas (en el orden real en que se derivaron), por fecha desc. A un operario puro nunca le muestra las OPs en `borrador` |
| GET | `/api/production-orders/pending-planning` | — | **Cola de Planeación** (gestión de producción): ítems de pedidos `aprobado`/`en_produccion` que aún no tienen OP. Devuelve `pedidoVersionItemId`, `pedidoId`, `pedidoOrderNumber`, `clientName`, `productId`, `productName`, `productSku`, `quantity`, `measure` |
| GET | `/api/production-orders/reports/por-operario` | `?from=&to=` (YYYY-MM-DD, por defecto últimos 7 días) `?station=` | (gestión de producción) Cuadre de kg cargados por operario y día: agrupa los rollos ya registrados (sin que nadie tipee nada nuevo) por operario + día calendario + estación, con conteo de rollos, kg producidos y kg de desperdicio |
| GET | `/api/production-orders/rolls/by-code/:code` | — | Resuelve un rollo por el código de su etiqueta QR (`EXT-12`, `PRE-30`... — ver más abajo "Numeración de rollos"). Devuelve además `remainingKg`: el saldo que le queda al rollo como rollo madre. Sigue resolviendo el formato viejo `RL-<id>` de etiquetas ya impresas antes de la numeración por estación |
| GET | `/api/production-orders/:id` | — | **Detalle completo**: producto, cliente, rollos (con su rollo madre), adjuntos, la **cadena completa** de derivación (`chain`, todas las etapas que comparten `orderNumber`), resultado de Calidad, pedido/cliente de origen, stock actual por ubicación del producto (`warehouseLocations`) y los últimos 5 ítems de despacho de ese producto (`recentDispatchItems`) — no es trazabilidad por lote, es la foto actual del producto (el stock es fungible, no queda atado a la OP que lo produjo) |
| POST | `/api/production-orders` | `{ station?, productId, clientId?, quantityPlanned, measure?, specs?, notes? }` | Crea una OP en `borrador`, con numeración `OP-00001` (gestión de producción). `station` normalmente se omite: se asigna después con `POST /:id/derive` |
| POST | `/api/production-orders/from-pedido-item/:pedidoVersionItemId` | — | Genera la OP de un ítem de pedido, en `borrador` y sin proceso, con el cliente del pedido. `404` si el ítem no existe; `400` si ya tiene OP, o si la versión del pedido ya no es la vigente, o si el pedido no está `aprobado`/`en_produccion` |
| POST | `/api/production-orders/:id/release` | — | (gestión de producción) **Libera** una OP `borrador` a planta: pasa a `pendiente` y queda visible/operable para los operarios de su estación. `400` si ya fue liberada o si todavía no tiene proceso asignado (primero hay que derivarla a Extrusión) |
| POST | `/api/production-orders/:id/derive` | `{ station, quantityPlanned?, measure?, specs?, notes? }` | (gestión de producción) **Deriva** la OP. Si la OP todavía no tiene proceso (`station: null`), este mismo endpoint se lo asigna (debe ser `"extrusion"`, y actualiza la fila existente, no crea una hija). Si ya tiene proceso, crea una OP **hija** en `pendiente`: grafo válido extrusión → impresión/sellado/precorte, impresión → sellado/precorte; `400` si la OP está en `borrador` (hay que liberarla primero), si ya fue derivada antes a esa misma estación, o si la derivación no es válida. La hija hereda producto, cliente, medida, specs heredables (color/ancho/fuelles/calibre/etc., ver `inheritSpecs`) y la **cantidad realmente producida** por el padre (no su meta planificada) |
| PATCH | `/api/production-orders/:id` | `{ specs?, measure?, quantityPlanned?, clientId?, notes?, alertThresholdKg? }` | (gestión de producción) Edita el encabezado/specs mientras la OP esté `borrador` o abierta (`pendiente`/`en_proceso`). `400` si `quantityPlanned` baja de lo ya cargado (peso + desperdicio), o si `alertThresholdKg` es mayor a la meta. Editar `specs` **propaga** los campos heredables a toda la cadena de OPs derivadas ya existentes, no solo a las futuras |
| PATCH | `/api/production-orders/:id/material-para` | `{ materialPara: string \| null }` | (cualquier operario, solo en OPs de **su** estación) Único campo del encabezado que también puede tocar un operario: a qué proceso va a derivar esta OP (`specs.materialPara`) — lo decide el operario de Extrusión al terminar, el resto del encabezado sigue siendo exclusivo de Gestión |
| POST | `/api/production-orders/:id/close` | — | (operario de **esa** estación, `ROLES.CIERRE_OP` — no gestión) **Cierra** la OP (requiere ≥1 rollo). Extrusión → `finalizada` directo, sin mover stock de producto (pero sí descuenta su materia prima, ver abajo); **Impresión, Sellado y Precorte son procesos finales** → `pendiente_calidad` + notificación a Calidad (cerrar una OP y derivarla son decisiones independientes: Impresión puede cerrarse e ir a Calidad aunque también tenga OPs derivadas a Sellado o Precorte). Al cerrar Extrusión, descuenta del stock de materia prima el kg cargado en cada fila de `specs.materiaPrima`; si un `ref` no matchea ningún código del catálogo, se avisa en `skippedRawMaterialRefs` de la respuesta sin bloquear el cierre; si no alcanza el stock del insumo, `400` y no cierra |
| POST | `/api/production-orders/:id/reopen` | — | (gestión de producción) **Reabre** una OP `finalizada`/`pendiente_calidad`/`detenida` a `en_proceso`, para corregir un error. Revierte todo efecto de inventario ya aplicado: si tenía calidad `aprobado`, revierte la entrada de producto terminado y borra el control; si tenía `rechazado`, solo borra el control; si es de Extrusión, revierte la materia prima descontada al cerrar. `400` si ya generó un Despacho **vivo** (no cancelado) para su cliente — hay que cancelar ese despacho primero (`POST /dispatches/:id/cancel`) |
| POST | `/api/production-orders/:id/rolls` | `{ date?, machine?, label?, weightKg, wasteKg?, details?, notes?, sourceRollId?, sourceRollIds?, bultoLabelCode? }` | Agrega una fila al **registro acumulativo de rollos**. Un operario solo carga en OPs de **su** estación; `400` si la OP no está abierta o no tiene proceso asignado. El turno (`shift`) ya no se manda: se calcula solo de la hora del servidor (6:00–17:59 = "Día", resto = "Noche"). `sourceRollIds` (Sellado/Precorte, reemplaza al `sourceRollId` único de antes) son los rollos madre escaneados en orden — los kilos se reparten agotando el primero antes de tocar el siguiente. `bultoLabelCode` consume una etiqueta física de bulto pre-impresa (ver "Etiquetas de bulto" más abajo) en vez de tipear el número a mano |
| DELETE | `/api/production-orders/:id/rolls/:rollId` | — | (gestión de producción) Borra un rollo cargado por error, solo si la OP sigue abierta. `400` si ya se le sacó material a este rollo en otra estación (hay que borrar primero esas filas) |
| GET | `/api/production-orders/:id/rolls/:rollId/label` | — | **Etiqueta térmica imprimible del rollo**: QR con el código `<prefijo>-<n>` (`EXT-1`, `IMP-2`, `SELL-3`, `PRE-4`...), para pegar en el rollo físico |
| POST | `/api/production-orders/:id/quality-check` | `{ result: "aprobado" \| "rechazado", observations? }` | **Calidad**: aprueba o rechaza una OP final en `pendiente_calidad` (una sola vez por OP). Si aprueba: genera la entrada de inventario con la **suma de kg de los rollos** y finaliza la OP; **si la OP tiene un cliente asignado** (el "destino" de la OP), además genera automáticamente un `Dispatch` en `pendiente` para ese cliente con el producto y la cantidad ya cargados (Almacén solo confirma la salida física) y notifica a `ROLES.ALMACEN`. Si rechaza: la OP queda `detenida` sin tocar stock y notifica a `ROLES.PRODUCCION_GESTION` |
| GET | `/api/production-orders/:id/report.pdf` | — | **Reporte consolidado** en PDF con el layout del formato en papel (encabezado, materia prima con kg calculados, specs, rollos, totales, operarios por turno, adjuntos) |
| GET | `/api/production-orders/:id/attachments` | — | Adjuntos de la OP |
| POST | `/api/production-orders/:id/attachments` | multipart `file` | Sube un adjunto (máx 10 MB) |
| GET | `/api/production-orders/:id/attachments/:attachmentId/download` | — | Descarga un adjunto |
| DELETE | `/api/production-orders/:id/attachments/:attachmentId` | — | (gestión de producción) Borra un adjunto subido por error |

**El "destino" de la OP** es simplemente su `clientId`: sin cliente, el producto aprobado por Calidad entra a inventario general (estantería); con cliente, entra a inventario **y** genera el despacho automático de arriba. `clientId` se edita con `PATCH /:id` mientras la OP esté abierta.

**Rollo madre con saldo vivo (Sellado/Precorte)**: un rollo grande de Extrusión (45, 50, 70 kg) se monta en la máquina y de ahí salen varios rollos chicos hasta agotarlo, en vez de consumirse entero de una sola vez. Cada fila nueva descuenta del saldo del/los rollo(s) madre escaneados (`sourceRollIds`, en el orden en que se escanearon); si el rollo chico se pasa del saldo que quedaba, el excedente sale del siguiente rollo madre de la lista. `GET /rolls/by-code/:code` devuelve `remainingKg` para que el operario sepa cuánto le queda antes de tener que montar el próximo. El reparto real en kilos queda en la tabla `roll_consumptions` (ver [04 — Base de datos](04-database.md)).

**Numeración de rollos por estación**: cada estación numera su propio código desde 1 (`EXT-1`, `EXT-2`... `PRE-1`, `PRE-2`...), en vez de compartir un contador global — antes sacar un rollo de Extrusión después de uno de Precorte podía saltar de `EXT-70` a `PRE-71`. Las etiquetas físicas viejas (formato `RL-<id>`) impresas antes de este cambio siguen resolviendo con `GET /rolls/by-code/:code`.

```bash
curl -X POST http://localhost:4000/api/production-orders/1/rolls \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"operatorName":"Juan","machine":"2","label":"R-100","weightKg":250,"details":{"pResistencia":"SI"}}'
```

### Etiquetas de bulto (`/api/bulto-labels`)

Etiqueta física de bulto **pre-impresa** con QR (Sellado): a diferencia del rollo (que el sistema crea como subproducto de cargar la fila), la etiqueta existe primero en el mundo real — Gestión genera un lote, se imprime, y se reparte a mano a cada operario antes de armar bultos. El operario escanea la que usó (`bultoLabelCode` en `POST /production-orders/:id/rolls`) en vez de tipear el número "E. BULTO"; una vez usada no se puede volver a escanear.

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/bulto-labels` | `?status=disponible\|usada` (opcional) | Lista etiquetas, para armar la hoja de impresión de las disponibles |
| POST | `/api/bulto-labels/generate` | `{ count }` (1–500) | (gestión de producción) Genera un lote de etiquetas nuevas en blanco, numeración `EXT-00001` consecutiva |
| GET | `/api/bulto-labels/:id/qr` | — | QR imprimible de una etiqueta (`{ code, status, qrDataUrl }`) |
| GET | `/api/bulto-labels/by-code/:code` | — | Resuelve el código escaneado a la etiqueta, para confirmar cuál se está tomando antes de cargar el rollo |

### Despachos

Un despacho puede nacer manual (`POST /`, Almacén) o **automático**: al aprobar Calidad una OP con cliente asignado, se crea solo (ver "Órdenes de producción" arriba, `POST /production-orders/:id/quality-check`) — en ese caso queda enlazado a la OP (`Dispatch.productionOrderId`), lo que además bloquea reabrir esa OP mientras el despacho siga vivo.

| Método | Ruta | Cuerpo/Query | Descripción |
|---|---|---|---|
| GET | `/api/dispatches` | `?clientId=1&status=pendiente\|en_proceso\|despachado\|cancelada` | (almacén o ventas) Lista despachos (cliente + ítems con producto), por fecha desc |
| GET | `/api/dispatches/summary-by-client` | — | (almacén o ventas) Histórico de cuánto se le ha despachado a cada cliente, agrupado por cliente + producto: cantidad total, número de despachos y fecha del último. Solo cuenta lo efectivamente despachado (no lo pendiente) y excluye despachos cancelados |
| POST | `/api/dispatches` | `{ clientId, items: [{ productId, quantityRequested, labelCode?, notes? }] }` | Crea un despacho con sus ítems (almacén). `404` si el cliente o algún producto no existen; `400` si algún producto está desactivado |
| PATCH | `/api/dispatches/:dispatchId/items/:itemId` | `{ quantityDispatched, locationId? }` | (almacén) Marca un ítem despachado. Descuenta stock (del total y, si se manda `locationId`, también de esa ubicación puntual) y actualiza el estado del despacho, en una transacción. `400` si se pide despachar más de lo solicitado, si el despacho está `cancelada`, o si la ubicación indicada no tiene suficiente cantidad |
| POST | `/api/dispatches/:dispatchId/cancel` | — | (almacén) **Cancela** un despacho. Si ya tenía ítems marcados como despachados, revierte esos movimientos de stock (y de la ubicación de origen, si se había cargado una) dentro de la misma transacción. El histórico de `quantityDispatched` de cada ítem no se borra — solo cambia el estado del despacho. `400` si ya estaba cancelado |

Cuando el `PATCH` de un ítem deja el despacho en `despachado` (recién en ese momento, no en reintentos posteriores), el sistema intenta avisar por WhatsApp al contacto principal del cliente (`services/whatsapp.ts`, `sendWhatsAppMessage`). El resultado del intento queda **guardado en el despacho**, no solo en un log de servidor: `notifiedAt` sin `notifyError` significa que se mandó bien; `notifyError` con un mensaje (p. ej. "El cliente no tiene teléfono de contacto cargado") significa que no se pudo avisar. Sin `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` configuradas, el envío queda en modo no-op silencioso (igual que `email.ts` sin `RESEND_API_KEY`), pero igual queda su constancia en `notifyError`.

```bash
curl -X PATCH http://localhost:4000/api/dispatches/1/items/2 \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"quantityDispatched":25,"locationId":3}'

curl -X POST http://localhost:4000/api/dispatches/1/cancel -H "Authorization: Bearer <token>"
```

### Productos

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/products` | — | Catálogo completo, incluidos los productos inactivos (rol `CATALOGO_GESTION`: `super_admin`, `admin`, `planeacion`) |
| GET | `/api/products/:id/label` | — | Etiqueta imprimible: `{ sku, name, category, measure, unit, qrDataUrl }` con QR generado en el servidor |
| POST | `/api/products` | `{ name, category, measure?, measureUnit?, talla?, color?, densidad?, calibre?, unit, minStock, unitPrice }` (rol `CATALOGO_GESTION`) | Crea un producto (el SKU se genera solo por categoría, consecutivo). `measureUnit` (`Pulgadas`/`Cms.`) aclara en qué unidad viene `measure`; `talla`, `color` (enum de colores fijos), `densidad` (`ALTA`/`BAJA`) y `calibre` son atributos opcionales del producto. El viejo campo libre "Medida de referencia" (`medidaRef`) ya no está en el formulario de creación/edición |
| PATCH | `/api/products/:id` | campos parciales de arriba | Edita un producto. `400` si el body viene vacío; `404`/`409` según corresponda |
| DELETE | `/api/products/:id` | — | Soft delete (`active: false`) |
| POST | `/api/products/:id/reactivate` | — | Reactiva un producto desactivado |

### Usuarios y permisos

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/users` | — | Lista usuarios (sin `passwordHash`). Solo `ROLES.ADMIN` |
| POST | `/api/users` | `{ name, email, password (≥8), role }` | Crea un usuario. Hashea la contraseña con bcrypt. `409` si el email ya existe |
| PATCH | `/api/users/:id` | campos parciales de arriba | Edita un usuario. Si viene `password`, la rehashea |
| DELETE | `/api/users/:id` | — | Soft delete (`active: false`), bloquea el login. `400` si el admin intenta desactivarse a sí mismo |
| POST | `/api/users/:id/reactivate` | — | Reactiva un usuario desactivado |

### Almacén / WMS

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/warehouse/locations` | — | Lista ubicaciones de bodega (sin `publicToken`) |
| POST | `/api/warehouse/locations` | `{ code, label }` | Crea una ubicación. Genera un `publicToken` aleatorio de 32 hex para su QR |
| GET | `/api/warehouse/locations/:id/qr` | — | `{ dataUrl, url }` — el QR imprimible; `url` apunta a `<FRONTEND_URL>/qr/<publicToken>` |
| GET | `/api/warehouse/locations/by-token/:token` | — | `{ id, code, label }` — resuelve una ubicación por su token (uso interno, autenticado) |
| GET | `/api/warehouse/stock` | — | Stock por producto y ubicación: `{ productId, sku, name, unit, totalStock, unassigned, locations: [{ locationId, code, label, quantity }] }`. `unassigned` puede ser negativo (no se bloquea) |
| POST | `/api/warehouse/assign` | `{ productId, toLocationId, quantity, fromLocationId? }` | Mueve/asigna cantidad a una ubicación (transacción). `400` si la ubicación de origen no tiene suficiente |

`GET /api/public/locations/:token` (**sin `requireAuth`**, fuera de `/api/warehouse`) es la ruta que consume el QR físico: devuelve `{ location: { code, label }, items: [{ productId, sku, name, unit, quantity }] }`. El `token` — no el `code`, corto y adivinable — es la única credencial.

### Dashboard

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/dashboard/resumen` | Ventas de los últimos 6 meses, `cambioVentasPct` (variación vs. mes anterior; `null` si el mes anterior fue 0), cartera pendiente, `carteraVencida` (suma del saldo de facturas con `dueDate` pasado), facturas con saldo, OPs en curso, pedidos en producción, cotizaciones abiertas, top 5 `topClientesSaldo` |
| GET | `/api/dashboard/indicadores` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (opcional; sin params, últimos 30 días) — top 5 productos despachados, `calidad: { aprobadas, rechazadas, pctAprobacion }`, `tiempoPromedioProduccionHoras`, todo calculado sobre el rango |

### Exportaciones

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/export/inventario` | Descarga `.xlsx` del stock actual, con estilo de marca (`services/exportExcel.ts`) |
| GET | `/api/export/pedidos` | Descarga `.xlsx` de pedidos (rol de ventas) |
| GET | `/api/export/facturas` | Descarga `.xlsx` de facturas (rol de ventas) |
| GET | `/api/export/clientes` | Descarga `.xlsx` del listado de clientes |

### Notificaciones

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/notifications` | — | Últimas 50 notificaciones del usuario autenticado |
| GET | `/api/notifications/unread-count` | — | `{ count }` |
| PATCH | `/api/notifications/:id/read` | — | Marca una notificación como leída. `404` si no pertenece al usuario |
| PATCH | `/api/notifications/read-all` | — | Marca todas como leídas |

No hay `POST` manual: las notificaciones solo las crea `notifyRoles()` desde otros routers (ver [06 — Backend](06-backend.md) y [08 — Reglas de negocio](08-workflow.md)).

### Cotizaciones

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/cotizaciones` | `?clientId=` (opcional) | Lista con cliente e ítems |
| POST | `/api/cotizaciones` | `{ clientId, validUntil?, notes?, items: [{ productId, quantity, unitPrice?, measure? }] }` | Crea cotización (`COT-00001`). Si un ítem no trae precio, toma el del catálogo |
| PATCH | `/api/cotizaciones/:id/status` | `{ status }` | Cambia estado (`borrador` / `enviada` / `aceptada` / `rechazada` / `expirada`) |
| POST | `/api/cotizaciones/:id/convertir-a-pedido` | — | Copia los ítems a un Pedido nuevo (v1). La cotización queda enlazada, sin borrar |
| GET | `/api/cotizaciones/:id/pdf` | — | Descarga un PDF (`services/pdfDocument.ts`) listo para mandar al cliente: ítems, total y validez |

### Pedidos

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/pedidos` | `?clientId=&status=` | Lista con la última versión vigente |
| POST | `/api/pedidos` | `{ clientId, notes?, items: [{ productId, quantity, unitPrice?, measure? }] }` | Crea pedido + versión 1 (`PED-00001`) |
| GET | `/api/pedidos/:id/versions` | — | Todas las versiones del pedido (historial completo) |
| PATCH | `/api/pedidos/:id` | `{ status, notes?, items }` | **Crea una versión nueva completa** (v+1) en vez de sobrescribir. Actualiza `currentVersion` |
| POST | `/api/pedidos/:id/duplicar` | — | Crea un pedido nuevo copiando los ítems de la última versión |
| GET | `/api/pedidos/:id/attachments` | — | Lista adjuntos |
| POST | `/api/pedidos/:id/attachments` | `multipart/form-data`: campo `file` | Sube un adjunto (disco `server/uploads/pedidos/`, máx 20 MB) |
| GET | `/api/pedidos/:id/attachments/:attachmentId/download` | — | Descarga el archivo con su nombre original |

### Facturas y pagos

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/facturas` | `?clientId=&status=` | Lista con cliente, ítems y pagos |
| POST | `/api/facturas` | `{ clientId, notes?, dueDate?, items }` | Crea factura suelta (`FAC-00001`). `dueDate` es opcional (fecha de vencimiento) |
| POST | `/api/facturas/desde-pedido/:pedidoId` | `{ dueDate? }` (opcional) | Factura desde la **última versión** del pedido (copia sus ítems) |
| PATCH | `/api/facturas/:id/anular` | — | Marca la factura `anulada` (acción manual) |
| GET | `/api/facturas/:id/payments` | — | Lista abonos |
| POST | `/api/facturas/:id/payments` | `{ amount, method, paidAt?, notes? }` | Registra un abono. La factura recalcula sola su estado (`emitida` / `pagada_parcial` / `pagada`) |
| GET | `/api/facturas/:id/pdf` | — | Descarga un PDF con ítems, total, pagado, saldo y vencimiento; incluye un sello "Vencida" si aplica |

```bash
curl -X POST http://localhost:4000/api/facturas/1/payments \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"amount":50000,"method":"transferencia"}'
```

### Auditoría

| Método | Ruta | Query | Descripción |
|---|---|---|---|
| GET | `/api/audit-log` | `?tableName=&recordId=&page=&pageSize=` (paginado) | Bitácora forense de cambios en tablas críticas. Filtra por tabla y/o registro. Devuelve `{ items, total, page, pageSize }`, por fecha desc. Rol auditoría |

Los registros los escribe automáticamente la extensión de Prisma (`withAudit`) en cada `create`/`update`/`delete` sobre `Client`, `Dispatch`, `ProductionEntry` e `InventoryMovement`. Cada entrada guarda la tabla, el id del registro, la acción, el estado antes/después (JSON), el usuario y su IP/user-agent.

```bash
curl "http://localhost:4000/api/audit-log?tableName=Client&pageSize=20" \
  -H "Authorization: Bearer <token>"
```

### WhatsApp Business API (fase 2)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/webhook/whatsapp` | Handshake de verificación de Meta (`hub.mode`, `hub.verify_token`, `hub.challenge`) |
| POST | `/webhook/whatsapp` | Recibe eventos. Si llega un documento, lo descarga vía Graph API, lo parsea con `parseProductionFile` y lo registra en `import_logs` (`source = whatsapp_bot`). No crea entradas aún |

Configuración pendiente (documentada en `server/src/routes/whatsappWebhook.ts`):

1. Cuenta de WhatsApp Business API aprobada en Meta for Developers.
2. Webhook URL a `https://<tu-dominio>/webhook/whatsapp`.
3. `WHATSAPP_VERIFY_TOKEN` como Verify Token en Meta.
4. Suscríbase al campo `messages`.
5. Complete `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` en `server/.env`.

## Respuestas de ejemplo

### `GET /api/inventory`

```json
[
  {
    "id": 1,
    "sku": "BUL-001",
    "name": "Bulto 25kg Tipo A",
    "category": "bultos",
    "measure": "25kg",
    "unit": "unidad",
    "minStock": 50,
    "currentStock": 120,
    "belowMinimum": false
  }
]
```

### `GET /api/dispatches`

```json
[
  {
    "id": 1,
    "clientId": 1,
    "client": { "id": 1, "name": "Cliente ACME", "active": true },
    "status": "en_proceso",
    "requestedDate": "2026-07-31T00:00:00.000Z",
    "dispatchedDate": null,
    "items": [
      { "id": 2, "productId": 1, "product": { "id": 1, "sku": "BUL-001", "name": "Bulto 25kg Tipo A" }, "quantityRequested": "25", "quantityDispatched": null }
    ]
  }
]
```

> El shape completo depende del `include` de cada ruta. Los decimales de Prisma se serializan como string (p. ej. en `/api/dispatches`). `stockService` los convierte a `Number()` en `/api/inventory`.

## Convenciones de implementación

- Validación con **zod** (`safeParse`). Si falla → `400` con `parsed.error.flatten()`.
- Errores de negocio → `400` con `{ error: message }` (p. ej. SKU inexistente en producción).
- Recurso no encontrado → `404`; sin permiso de rol → `403`.
- Las mutaciones multi-tabla usan `prisma.$transaction(...)`. Ver [06 — Backend](06-backend.md) y [08 — Reglas de negocio](08-workflow.md).