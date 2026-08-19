# 04 — Base de datos

## Stack de datos

- **PostgreSQL 16** en Docker (`docker-compose.yml`, o su equivalente con `docker run` si no se dispone del plugin Compose). Base `inventario_despachos`. Ver [02 — Puesta en marcha](02-setup.md).
- **Prisma** como ORM. El archivo fuente de la verdad es `server/prisma/schema.prisma`.
- Migraciones versionadas en `server/prisma/migrations/`.

## El ciclo de vida de Prisma

```
1. Edite schema.prisma  →  modelos/tablas (no se escribe SQL a mano)
2. npm run prisma:migrate  →  genera una migración SQL + regenera Prisma Client
3. import { prisma } ...  →  client tipado con autocompletado
```

Conceptos esenciales:

- **Un modelo Prisma = una tabla. Un campo = una columna.**
- **`?`** = opcional → la columna es `NULL` si no se llena.
- **`@default(x)`** = valor por defecto que aplica la BD.
- **`@id`** = llave primaria. **`@map`/`@@map`** traducen camelCase → snake_case (convención del proyecto).
- **Decimales** solo para cantidades y precios (`@db.Decimal(12, 2)`). Nada más usa decimal.

## Convenciones del proyecto

| Convención | Ejemplo |
|---|---|
| Tablas en snake_case plural | `@@map("production_entries")` |
| Columnas en snake_case | `@map("client_id")`, `@map("created_at")` |
| Relaciones declaradas en ambos lados | `contacts ClientContact[]` + `client Client @relation(...)` |
| FKs en `modelo_id` | `productId → @map("product_id")` |
| Timestamps con `@default(now())` | `createdAt DateTime @default(now()) @map("created_at")` |
| Precios y cantidades en Decimal | `@db.Decimal(12, 2)` + `Number()` al leerlos |

## Diagrama de relaciones (resumen)

```
users 1───N production_entries / inventory_movements / dispatches / import_logs
users 1───N notifications / stock_locations (updatedBy)
clients 1───N client_contacts / client_addresses / client_interactions / cotizaciones
clients 1───N dispatches / production_entries / facturas / pedidos
products 1───1 inventory_stock
products 1───N production_entries / dispatch_items / inventory_movements / stock_locations
warehouse_locations 1───N stock_locations
production_orders 1───N production_rolls / production_order_attachments
production_orders 0..1───N production_orders (derivación: parent_order_id)
clients 1───N production_orders (cliente asociado, opcional)
pedido_version_items 0..1───0..1 production_orders (vínculo opcional, módulo Planeación)
cotizaciones 1───N cotizacion_items · 1───0..N pedidos
pedidos 1───N pedido_versions 1───N pedido_version_items
pedidos 1───N pedido_attachments · 1───0..N facturas
facturas 1───N factura_items / payments
users 1───N password_reset_tokens
app_meta 1 fila (clave/valor, sin FKs)
```

## Modelos (tablas)

### `users`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK, autoincrement |
| name | String | |
| email | String | `@unique` |
| passwordHash | String | `@map("password_hash")`, hash bcrypt |
| role | `UserRole` | enum de **11 valores** (ver Enums) |
| failedLoginAttempts | Int | `@default(0)`. Se resetea en login exitoso |
| lockedUntil | DateTime? | Bloqueo temporal por intentos fallidos |
| twoFactorSecret | String? | Secret TOTP. `@map("two_factor_secret")` |
| twoFactorEnabled | Boolean | `@default(false)`. Se activa al confirmar el primer código |
| active | Boolean | `@default(true)`. En `false` (CRUD de Usuarios) el login rechaza `401` aunque la contraseña sea correcta |
| createdAt | DateTime | `@default(now())` `@map("created_at")` |

### `notifications`

Notificación in-app. `type` es texto libre (p. ej. `op_pendiente_calidad`) para no migrar el schema cada vez que se agrega un disparador nuevo — el frontend solo necesita mostrar `message`/`link`. Solo la escribe `notifyRoles()` (ver [06 — Backend](06-backend.md)); no hay endpoint para crearlas a mano.

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| userId | Int | FK → users |
| type | String | texto libre, identifica el disparador |
| message | String | texto mostrado al usuario |
| link | String? | ruta del frontend a la que navega al hacer clic |
| read | Boolean | `@default(false)` |
| createdAt | DateTime | `@map("created_at")`. Índice compuesto `[userId, read]` |

### `products`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| sku | String | `@unique` — p. ej. `BUL-001` |
| name | String | |
| category | `ProductCategory` | enum: `bultos` / `rollos_prec_lam` / `rollos_fuelle` / `mangueta` / `tiras` / `control_impresion` |
| measure | String? | p. ej. `25kg`, `20x30` |
| unit | `ProductUnit` | enum: `kg` / `unidad` |
| minStock | Decimal | `@default(0)`, umbral de alerta |
| unitPrice | Decimal | `@default(0)`. Precio de catálogo usado por cotizaciones/pedidos/facturas |
| active | Boolean | `@default(true)`. El catálogo de venta (`GET /products`) filtra `active: true`; el CRUD de Productos ve también los inactivos |
| createdAt | DateTime | `@map("created_at")` |

### `clients`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| name | String | (sin `@unique`: dos clientes pueden coincidir en nombre) |
| contactInfo | Json? | ⚠️ **columna antigua, sin uso**. Los datos reales viven en `client_contacts`, `client_addresses` e `client_interactions` |
| creditLimit | Decimal? | Límite de crédito **manual** (módulo "Cartera"), editable con `PATCH /credit-limit` |
| avatarUrl | String? | Foto de perfil. Ruta pública `/api/uploads/clients/<archivo>` |
| viewCount | Int | `@default(0)`. Conteo de "Frecuentes". Arranca arriba del ranking al crear el cliente |
| lastViewedAt | DateTime? | Última visita a la ficha |
| cycleInteractions | Int | `@default(0)`. Interacciones desde la última purga semanal. Al llegar a 5 el cliente se vuelve "hot", sube al máximo+1 y el contador vuelve a 0 |
| active | Boolean | `@default(true)` — el listado filtra `active: true` |
| createdAt | DateTime | `@map("created_at")` |

### `client_contacts`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK, autoincrement |
| clientId | Int | FK → clients. `ON DELETE RESTRICT` |
| name | String | obligatorio |
| position | String? | cargo |
| phone | String? | |
| email | String? | validado en la API con zod (`z.email()`) |
| isPrimary | Boolean | `@default(false)`. Un solo principal por cliente (lo garantiza una transacción) |
| viewCount / lastViewedAt | Int / DateTime? | Frecuencia **propia del contacto**, independiente del cliente (mismo motor) |
| cycleInteractions | Int | `@default(0)`. Igual que en el cliente, con umbral 5 |
| createdAt | DateTime | `@map("created_at")` |

### `client_addresses`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| clientId | Int | FK → clients |
| label | String | p. ej. "Bodega Principal" |
| addressLine | String | dirección |
| city / region / postalCode | String? | |
| isPrimary | Boolean | `@default(false)` |
| notes | String? | |
| createdAt | DateTime | `@map("created_at")` |

### `client_interactions`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| clientId | Int | FK → clients |
| type | `InteractionType` | `llamada` / `email` / `reunion` / `nota` |
| description | String | |
| createdById | Int? | `@map("created_by")`, quién registró la interacción |
| createdAt | DateTime | `@map("created_at")` |

### `production_entries`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| productId | Int | FK → products |
| labelCode | String? | etiqueta |
| operatorName | String | operario (obligatorio) |
| clientId | Int? | FK → clients (se crea el cliente por nombre si no existe) |
| measure | String? | hereda del producto si no se indica |
| kilos | Decimal | cantidad producida |
| driverName | String? | conductor |
| status | `ProductionStatus` | **hoy se crea como `recibido`** |
| source | `ProductionSource` | `manual` / `excel_import` / `whatsapp_bot` |
| observations | String? | |
| createdById | Int? | FK → users |
| createdAt | DateTime | `@map("created_at")` |

### `inventory_movements`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| productId | Int | FK → products |
| movementType | `MovementType` | `entrada_produccion` / `salida_despacho` / `ajuste` / `devolucion` |
| quantity | Decimal | positivo = entrada, negativo = salida |
| referenceType | `ReferenceType` | `production_entry` / `dispatch_item` / `manual_adjustment` |
| referenceId | Int? | id del registro que originó el movimiento |
| productionEntryId | Int? | FK → production_entries |
| createdById | Int? | FK → users |
| createdAt | DateTime | `@map("created_at")` |

### `inventory_stock`

**Stock desnormalizado** por producto (1:1). El sistema lo recalcula en cada movimiento (ver [08 — Reglas de negocio](08-workflow.md)).

| Campo | Tipo | Notas |
|---|---|---|
| productId | Int | PK + FK → products |
| currentQuantity | Decimal | `@default(0)` |
| updatedAt | DateTime | `@updatedAt` `@map("updated_at")` |

### `warehouse_locations` y `stock_locations` (Almacén / WMS)

`warehouse_locations` es la ubicación física de bodega (estante, rack, zona). `stock_locations` registra cuánto de un producto hay en una ubicación puntual. El stock total del producto sigue viviendo en `inventory_stock`; estas dos tablas son una capa complementaria de "dónde está guardado", administrada a mano por Almacén — la suma de las filas de un producto en `stock_locations` puede quedar por debajo de su `inventory_stock.currentQuantity` (diferencia = "sin ubicar").

| Modelo | Campos clave |
|---|---|
| `warehouse_locations` | `code` (`@unique`), `label`, `publicToken` (`@unique`, 32 hex aleatorio). El token — no el `code`, corto y adivinable — es la única credencial de `GET /api/public/locations/:token`: exige haber escaneado el QR físico de esa ubicación |
| `stock_locations` | `productId`, `locationId`, `quantity`, `updatedById`. `@@unique([productId, locationId])`: una fila por combinación producto+ubicación |

### `production_orders`

**Orden de Producción (OP)**: una por proceso de planta (formatos en papel del cliente). Extrusión es el proceso base; las OPs de los procesos siguientes se derivan de ella (`parent_order_id`).

| id | Int | PK |
| orderNumber | String | `@unique`, formato `OP-00001` (numeración consecutiva en transacción) |
| station | `ProductionStation` | `extrusion` / `impresion` / `sellado` / `precorte`. El proceso de esta OP |
| productId | Int | FK → products |
| clientId | Int? | `@map("client_id")`. FK → clients. Cliente asociado (del pedido en Planeación, o manual) |
| quantityPlanned | Decimal | `@map("quantity_planned")` |
| measure | String? | hereda del producto si no se indica |
| status | `ProductionOrderStatus` | `pendiente` / `en_proceso` / `pendiente_calidad` / `detenida` / `finalizada` / `cancelada` |
| specs | Json? | Encabezado de la plantilla de la estación (materia prima con %, medidas, montaje, colores, etc. — ver `services/opTemplates.ts`) |
| parentOrderId | Int? | `@map("parent_order_id")`. Self-FK → production_orders. OP de la que se derivó (cadena Extrusión → …) |
| pedidoVersionItemId | Int? | `@unique` `@map("pedido_version_item_id")`. FK → pedido_version_items. Vínculo opcional con el ítem del pedido que originó la OP (módulo Planeación). `NULL` en las OPs manuales |
| notes | String? | |
| createdById | Int? | |
| createdAt | DateTime | `@map("created_at")` |
| qualityCheck | QualityCheck? | 1:1. Registra el control de calidad de una OP final (una sola vez, al cerrarse) |

### `quality_checks`

Control de calidad de una OP final (Sellado/Precorte). Se registra **una sola vez**, al cerrarse la OP y antes de que se finalice.

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| productionOrderId | Int | `@unique`. FK → production_orders |
| result | `QualityResult` | `aprobado` (genera la entrada de inventario y finaliza la OP) / `rechazado` (la OP queda `detenida`, sin tocar stock) |
| observations | String? | Motivo (normalmente del rechazo) |
| createdById | Int? | FK → users |
| createdAt | DateTime | `@map("created_at")` |

### `audit_logs`

Bitácora forense genérica: registra `create`/`update`/`delete` sobre las tablas críticas con el estado antes/después y quién lo hizo desde dónde. La escribe automáticamente la extensión de Prisma (`withAudit`), no se crea a mano desde ningún router.

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| tableName | String | `@map("table_name")`. Modelo auditado (p. ej. `Client`, `Dispatch`) |
| recordId | Int? | `@map("record_id")` |
| action | `AuditAction` | `create` / `update` / `delete` |
| before / after | Json? | Estado antes y después (diff). `before` es `NULL` en `create`; `after` es `NULL` en `delete` |
| userId | Int? | FK → users |
| ipAddress / userAgent | String? | Desde dónde se hizo |
| createdAt | DateTime | `@map("created_at")` |

### `production_rolls`

Fila del **registro acumulativo de rollos/bultos** de una OP (la tabla inferior de los formatos en papel). Lo que varía entre estaciones (pruebas SI/NO, color, densidad, paq×unid, etiqueta/peso de origen) va en `details` (JSON). Reemplaza a la antigua `production_stage_logs` (dropeada en `20260819001850_op_por_proceso`).

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| productionOrderId | Int | FK → production_orders |
| date | DateTime | `@default(now())` |
| shift | String? | Turno |
| operatorName | String | `@map("operator_name")` |
| machine | String? | |
| label | String? | Etiqueta del rollo/bulto |
| weightKg | Decimal | `@map("weight_kg")` |
| wasteKg | Decimal | `@default(0)` `@map("waste_kg")` (desperdicio) |
| details | Json? | pruebas, color, densidad, etc. según la estación |
| notes / createdById | String? / Int? | |
| createdAt | DateTime | `@map("created_at")` |

### `production_order_attachments`

Adjuntos de una OP (fotos, fichas técnicas, artes). Espejo del patrón de `pedido_attachments`; los archivos viven en `uploads/produccion`.

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| productionOrderId | Int | FK → production_orders |
| storedName / originalName / mimeType / sizeBytes | String / String / String / Int | mismos campos que `pedido_attachments` |
| uploadedById | Int? | FK → users |
| createdAt | DateTime | `@map("created_at")` |

### `dispatches`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| clientId | Int | FK → clients |
| status | `DispatchStatus` | `pendiente` / `en_proceso` / `despachado` |
| requestedDate | DateTime | `@default(now())` `@map("requested_date")` |
| dispatchedDate | DateTime? | se fija cuando todos los ítems están despachados |
| createdById | Int? | |
| createdAt | DateTime | `@map("created_at")` |

### `dispatch_items`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| dispatchId | Int | FK → dispatches |
| productId | Int | FK → products |
| quantityRequested | Decimal | `@map("quantity_requested")` |
| quantityDispatched | Decimal? | `NULL` hasta marcarlo despachado |
| labelCode | String? | `@map("label_code")` |
| notes | String? | |

### `import_logs`

Registro de cada importación de producción (Excel manual o WhatsApp).

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| filename | String | |
| source | `ImportSource` | `manual_upload` / `whatsapp_bot` |
| rowsProcessed | Int | `@default(0)` `@map("rows_processed")` |
| rowsFailed | Int | `@default(0)` `@map("rows_failed")` |
| uploadedById | Int? | `@map("uploaded_by")` |
| createdAt | DateTime | `@map("created_at")` |

### `cotizaciones` y `cotizacion_items`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| quoteNumber | String | `@unique` `@map("quote_number")` — `COT-00001` |
| clientId | Int | FK → clients |
| status | `CotizacionStatus` | `borrador` / `enviada` / `aceptada` / `rechazada` / `expirada` |
| validUntil | DateTime? | `@map("valid_until")` |
| notes / createdById | String? / Int? |
| items | `CotizacionItem[]` | 1 cotización a N ítems (productId, quantity, unitPrice) |

### `pedidos` + `pedido_versions` + `pedido_version_items` + `pedido_attachments`

El pedido es **versionado**: la identidad vive en `pedidos`. El contenido real de cada edición vive en una `PedidoVersion` nueva completa (v1, v2, v3…). Así se puede navegar el historial sin sobrescribir versiones anteriores.

| Modelo | Campos clave |
|---|---|
| `pedidos` | `orderNumber` (`PED-00001` @unique), `clientId`, `cotizacionId?`, `status`, `currentVersion Int @default(1)`, `createdById` |
| `pedido_versions` | `pedidoId`, `versionNumber`, `status`, `notes`. `@@unique([pedidoId, versionNumber])` |
| `pedido_version_items` | `pedidoVersionId`, `productId`, `quantity`, `unitPrice`, `measure`. Un ítem puede tener una OP (`productionOrder 0..1`) generada desde Planeación |
| `pedido_attachments` | `pedidoId`, `storedName`, `originalName`, `mimeType`, `sizeBytes`, `uploadedById`. Los archivos viven en disco (`server/uploads/pedidos/`) |

### `facturas` + `factura_items` + `payments`

| Modelo | Campos clave |
|---|---|
| `facturas` | `invoiceNumber` (`FAC-00001`, `@unique`), `clientId`, `pedidoId?`, `status` (`emitida` / `pagada_parcial` / `pagada` / `anulada`), `notes`, `dueDate?` (`@map("due_date")`, fecha de vencimiento opcional), `createdById` |
| `factura_items` | `facturaId`, `productId`, `quantity`, `unitPrice`, `measure` |
| `payments` | `facturaId`, `amount`, `method` (`efectivo` / `transferencia` / `cheque` / `tarjeta` / `otro`), `paidAt`, `notes`, `createdById` |

El estado de la factura se **recalcula solo** con cada abono (`emitida` → `pagada_parcial` → `pagada`). `anulada` es una acción manual. Una factura está **vencida** cuando `dueDate` ya pasó y todavía tiene saldo pendiente (`total − pagado > 0`); no es un campo de la tabla, se calcula en cada consulta (`GET /clients/:id/cartera`, `GET /dashboard/resumen`).

### `password_reset_tokens`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| userId | Int | FK → users |
| tokenHash | String | `@unique` `@map("token_hash")` — se guarda hasheado (sha256) |
| expiresAt | DateTime | `@map("expires_at")` — 1 hora de validez |
| usedAt | DateTime? | `@map("used_at")` — usa el token una sola vez |
| createdAt | DateTime | `@map("created_at")` |

### `app_meta`

Tabla clave/valor para el estado interno del sistema. Hoy guarda la fecha de la última purga semanal de "Frecuentes".

| Campo | Tipo | Notas |
|---|---|---|
| key | String | PK. P. ej. `frecuentes:lastResetAt` y `frecuentes:lastResetAt:contacts` |
| value | String | Valor asociado |

## Enums (definidos en el schema)

| Enum | Valores |
|---|---|
| `UserRole` | `super_admin`, `admin`, `gerente_produccion`, `planeacion`, `ventas_pedidos`, `operario_extrusion`, `operario_impresion`, `operario_sellado_precorte`, `calidad`, `almacen_despachos`, `auditor` |
| `ProductCategory` | `bultos`, `rollos_prec_lam`, `rollos_fuelle`, `mangueta`, `tiras`, `control_impresion` |
| `ProductUnit` | `kg`, `unidad` |
| `ProductionStatus` | `pendiente`, `en_transito`, `recibido`, `rechazado` |
| `ProductionSource` | `manual`, `excel_import`, `whatsapp_bot` |
| `MovementType` | `entrada_produccion`, `salida_despacho`, `ajuste`, `devolucion` |
| `ReferenceType` | `production_entry`, `dispatch_item`, `manual_adjustment` |
| `DispatchStatus` | `pendiente`, `en_proceso`, `despachado` |
| `ImportSource` | `manual_upload`, `whatsapp_bot` |
| `ProductionOrderStatus` | `pendiente`, `en_proceso`, `pendiente_calidad`, `detenida`, `finalizada`, `cancelada` |
| `ProductionStation` | `extrusion`, `impresion`, `sellado`, `precorte` |
| `QualityResult` | `aprobado`, `rechazado` |
| `AuditAction` | `create`, `update`, `delete` |
| `InteractionType` | `llamada`, `email`, `reunion`, `nota` |
| `CotizacionStatus` | `borrador`, `enviada`, `aceptada`, `rechazada`, `expirada` |
| `PedidoStatus` | `borrador`, `pendiente`, `aprobado`, `en_produccion`, `despachado`, `cancelado` |
| `FacturaStatus` | `emitida`, `pagada_parcial`, `pagada`, `anulada` |
| `PaymentMethod` | `efectivo`, `transferencia`, `cheque`, `tarjeta`, `otro` |

## Migraciones

`server/prisma/migrations/` guarda el historial SQL:

| Migración | Cambio |
|---|---|
| `20260722012128_init` | Tablas base y enums iniciales |
| `20260801005245_add_client_contacts` | Tabla `client_contacts` y su FK |
| `20260807043612_add_production_orders` | `production_orders` y `production_stage_logs` |
| `20260807045314_add_crm_cotizaciones_pedidos` | Cotizaciones, pedidos versionados y adjuntos |
| `20260807051412_add_facturacion_pagos` | Facturas, ítems y pagos |
| `20260807180000_expand_role_matrix_and_auth_security` | Matriz de 11 roles + bloqueo + TOTP + reset de contraseña |
| `20260808021150_add_client_avatar_views` | `clients`: `avatar_url`, `view_count`, `last_viewed_at` |
| `20260808025104_add_pedido_link_to_production_order` | `production_orders`: `pedido_version_item_id` + FK a `pedido_version_items` |
| `20260808033245_add_app_meta` | Tabla `app_meta` (clave/valor) |
| `20260808033850_add_client_visit_streak` | `clients`: `visit_streak` |
| `20260808040000_rename_visit_streak_to_cycle_interactions` | Renombra `visit_streak` → `cycle_interactions` |
| `20260808045144_add_contact_frequency` | `client_contacts`: `view_count`, `last_viewed_at`, `cycle_interactions` |
| `20260809171233_add_quality_check` | Estado `pendiente_calidad`, tabla `quality_checks` y enum `QualityResult` |
| `20260810020619_add_audit_log` | Tabla `audit_logs` y enum `AuditAction` |
| `20260812223407_add_warehouse_locations` | Tablas `warehouse_locations` y `stock_locations` (Almacén/WMS) |
| `20260813044951_add_warehouse_location_public_token` | `warehouse_locations`: `public_token` (`@unique`) para el QR sin login |
| `20260813055010_add_product_active` | `products`: `active` (soft delete) |
| `20260813063722_add_user_active` | `users`: `active` (soft delete, bloquea login) |
| `20260813064611_add_notifications` | Tabla `notifications` |
| `20260815045824_add_factura_due_date` | `facturas`: `due_date` (fecha de vencimiento opcional) |
| `20260819001850_op_por_proceso` | Rediseño de OP: `station`, `client_id`, `specs`, `parent_order_id` en `production_orders`; nuevas `production_rolls` y `production_order_attachments`; drop de `production_stage_logs` |

Para aplicar cambios nuevos:

```bash
npm run prisma:migrate    # crea una carpeta nueva con el SQL + regenera el client
```

> Una migración que solo hace `CREATE TABLE` no afecta los datos existentes. Antes de borrar columnas o modelos, revise el impacto con cuidado.

## Seed (`server/prisma/seed.ts`)

`npm run prisma:seed` siembra datos iniciales (idempotente):

- **11 usuarios** de prueba (contraseña `password123`): uno por rol (tabla en [02 — Puesta en marcha](02-setup.md)).
- **6 productos** (SKUs `BUL-001`, `ROL-PL-001`, `ROL-F-001`, `MAN-001`, `TIR-001`, `CTL-001`) con precio de catálogo.
- **2 clientes**: "Cliente ACME" (con límite de crédito `5.000.000`, bodega principal y 2 contactos) y "Distribuidora Norte".
- **1 pedido de Planeación**: `PED-SEED-PLANEACION` (estado `aprobado`, 2 ítems de `BUL-001` y `ROL-PL-001`). Este pedido llena la cola de Planeación al entrar.
- **1 OP demo de Calidad**: `OP-SEED-CALIDAD` (producto `BUL-001`, estado `pendiente_calidad`, con su paso de precorte cargado). Llena la cola de Calidad al entrar.
- **3 ubicaciones de bodega** (`A-1`, `A-2`, `B-1`) con stock repartido en `stock_locations`, para poblar Almacén.
- **2 OPs demo cerradas** con control de calidad (una aprobada, una rechazada) y **1 despacho demo completado**, para poblar el dashboard de Indicadores.
- **1 notificación demo** para el admin (`type: "seed_demo"`, enlazada a `/calidad`), para que Notificaciones no quede vacío en la primera corrida.

El seed usa el mismo cliente auditado que la app. Así, los clientes que crea generan entradas reales en `audit_logs`, y el módulo de Auditoría no queda vacío en la primera corrida.

## Consultas útiles en psql

```bash
docker exec -it db psql -U inventario -d inventario_despachos -c "\dt"      # tablas
docker exec -it db psql -U inventario -d inventario_despachos -c "\d inventory_stock"  # estructura de una tabla
docker exec -it db psql -U inventario -d inventario_despachos -c "SELECT * FROM inventory_stock;"
```