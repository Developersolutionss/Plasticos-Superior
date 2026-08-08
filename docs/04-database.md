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
clients 1───N client_contacts / client_addresses / client_interactions / cotizaciones
clients 1───N dispatches / production_entries / facturas / pedidos
products 1───1 inventory_stock
products 1───N production_entries / dispatch_items / inventory_movements
production_orders 1───N production_stage_logs
cotizaciones 1───N cotizacion_items · 1───0..N pedidos
pedidos 1───N pedido_versions 1───N pedido_version_items
pedidos 1───N pedido_attachments · 1───0..N facturas
facturas 1───N factura_items / payments
users 1───N password_reset_tokens
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
| createdAt | DateTime | `@default(now())` `@map("created_at")` |

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
| createdAt | DateTime | `@map("created_at")` |

### `clients`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| name | String | (sin `@unique`: dos clientes pueden coincidir en nombre) |
| contactInfo | Json? | ⚠️ **columna antigua, sin uso**. Los datos reales viven en `client_contacts`, `client_addresses` e `client_interactions` |
| creditLimit | Decimal? | Límite de crédito **manual** (módulo "Cartera"), editable con `PATCH /credit-limit` |
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

### `production_orders`

**Orden de Producción (OP)**: la unidad de trabajo que se mueve por las estaciones.

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| orderNumber | String | `@unique`, formato `OP-00001` (numeración consecutiva en transacción) |
| productId | Int | FK → products |
| quantityPlanned | Decimal | `@map("quantity_planned")` |
| measure | String? | hereda del producto si no se indica |
| status | `ProductionOrderStatus` | `pendiente` / `en_proceso` / `detenida` / `finalizada` / `cancelada` |
| notes | String? | |
| createdById | Int? | |
| createdAt | DateTime | `@map("created_at")` |

### `production_stage_logs`

Registro del paso de una OP por una estación. Los detalles específicos de cada estación van en `details` (JSON), para no tener 4 tablas casi idénticas.

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| productionOrderId | Int | FK → production_orders |
| station | `ProductionStation` | `extrusion` / `impresion` / `sellado` / `precorte` |
| machine | String | |
| operatorName | String | `@map("operator_name")` |
| startTime | DateTime | `@map("start_time")` |
| endTime | DateTime? | `@map("end_time")` |
| kilosProduced | Decimal | `@map("kilos_produced")` |
| mermaKg | Decimal | `@default(0)` `@map("merma_kg")` |
| downtimeMinutes | Int | `@default(0)` `@map("downtime_minutes")` |
| downtimeReason | String? | `@map("downtime_reason")` |
| details | Json? | materia prima, tintas, tipo de sellado, etc. |
| notes / createdById | String? / Int? | |
| createdAt | DateTime | `@map("created_at")` |

### `dispatches`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| clientId | Int | FK → clients |
| status | `DispatchStatus` | `pendiente` / `en_proceso` / `despachado` |
| requestedDate | DateTime | `@default(now())` `@map("requested_date")` |
| dispatchedDate | DateTime? | se fija cuando todos los items están despachados |
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

El pedido **versionado**: la identidad vive en `pedidos`; el contenido real de cada edición vive en una `PedidoVersion` nueva completa (v1, v2, v3…), para navegar el historial sin sobrescribirlo.

| Modelo | Campos clave |
|---|---|
| `pedidos` | `orderNumber` (`PED-00001` @unique), `clientId`, `cotizacionId?`, `status`, `currentVersion Int @default(1)`, `createdById` |
| `pedido_versions` | `pedidoId`, `versionNumber`, `status`, `notes`. `@@unique([pedidoId, versionNumber])` |
| `pedido_version_items` | `pedidoVersionId`, `productId`, `quantity`, `unitPrice`, `measure` |
| `pedido_attachments` | `pedidoId`, `storedName`, `originalName`, `mimeType`, `sizeBytes`, `uploadedById`. Los archivos viven en disco (`server/uploads/pedidos/`) |

### `facturas` + `factura_items` + `payments`

| Modelo | Campos clave |
|---|---|
| `facturas` | `invoiceNumber` (`FAC-00001`, `@unique`), `clientId`, `pedidoId?`, `status` (`emitida` / `pagada_parcial` / `pagada` / `anulada`), `notes`, `createdById` |
| `factura_items` | `facturaId`, `productId`, `quantity`, `unitPrice`, `measure` |
| `payments` | `facturaId`, `amount`, `method` (`efectivo` / `transferencia` / `cheque` / `tarjeta` / `otro`), `paidAt`, `notes`, `createdById` |

El estado de la factura se **recalcula solo** con cada abono (`emitida` → `pagada_parcial` → `pagada`). `anulada` es una acción manual.

### `password_reset_tokens`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| userId | Int | FK → users |
| tokenHash | String | `@unique` `@map("token_hash")` — se guarda hasheado (sha256) |
| expiresAt | DateTime | `@map("expires_at")` — 1 hora de validez |
| usedAt | DateTime? | `@map("used_at")` — usa el token una sola vez |
| createdAt | DateTime | `@map("created_at")` |

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
| `ProductionOrderStatus` | `pendiente`, `en_proceso`, `detenida`, `finalizada`, `cancelada` |
| `ProductionStation` | `extrusion`, `impresion`, `sellado`, `precorte` |
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

Para aplicar cambios nuevos:

```bash
npm run prisma:migrate    # crea una carpeta nueva con el SQL + regenera el client
```

> Una migración que solo hace `CREATE TABLE` no afecta los datos existentes. Antes de borrar columnas o modelos, revise el impacto con cuidado.

## Seed (`server/prisma/seed.ts`)

`npm run prisma:seed` siembra datos iniciales (idempotente):

- **11 usuarios** de prueba (contraseña `password123`): uno por rol (ver tabla en [02 — Puesta en marcha](02-setup.md)).
- **6 productos** (SKUs `BUL-001`, `ROL-PL-001`, `ROL-F-001`, `MAN-001`, `TIR-001`, `CTL-001`) con precio de catálogo.
- **2 clientes**: "Cliente ACME" (con límite de crédito `5.000.000`, bodega principal y 2 contactos) y "Distribuidora Norte".

## Consultas útiles en psql

```bash
docker exec -it db psql -U inventario -d inventario_despachos -c "\dt"      # tablas
docker exec -it db psql -U inventario -d inventario_despachos -c "\d inventory_stock"  # estructura de una tabla
docker exec -it db psql -U inventario -d inventario_despachos -c "SELECT * FROM inventory_stock;"
```