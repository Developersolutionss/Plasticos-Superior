# 04 — Base de datos

## Stack de datos

- **PostgreSQL 16** en Docker (`docker-compose.yml`). Base `inventario_despachos`.
- **Prisma** como ORM. El archivo fuente de la verdad es `server/prisma/schema.prisma`.
- Migraciones versionadas en `server/prisma/migrations/`.

## El ciclo de vida de Prisma

```
1. Edite schema.prisma  →  modelos/tablas (no se escribe SQL a mano)
2. npm run prisma:migrate  →  genera una migración SQL + regenera Prisma Client
3. import { prisma } ...   →  client tipado con autocompletado
```

Conceptos esenciales:

- **Un modelo Prisma = una tabla. Un campo = una columna.**
- **`?`** = opcional → la columna es `NULL` si no se llena.
- **`@default(x)`** = valor por defecto que aplica la BD.
- **`@id`** = llave primaria. **`@map`/`@@map`** traducen camelCase → snake_case (convención del proyecto).
- **Decimales** solo para cantidades (`@db.Decimal(12, 2)`). Nada más usa decimal.

## Convenciones del proyecto

| Convención | Ejemplo |
|---|---|
| Tablas en snake_case plural | `@@map("production_entries")` |
| Columnas en snake_case | `@map("client_id")`, `@map("created_at")` |
| Relaciones declaradas en ambos lados | `contacts ClientContact[]` + `client Client @relation(...)` |
| FKs en `modelo_id` | `productId → @map("product_id")` |
| Timestamps con `@default(now())` | `createdAt DateTime @default(now()) @map("created_at")` |

## Diagrama de relaciones

```
users 1───N production_entries ──N──1 products
users 1───N inventory_movements ──N──1 products
users 1───N dispatches           ──N──1 clients
users 1───N import_logs
products 1───1 inventory_stock
products 1───N production_entries ──N──1 clients
products 1───N dispatch_items ──N──1 dispatches
production_entries 1───N inventory_movements
```

## Modelos (tablas)

### `users`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK, autoincrement |
| name | String | |
| email | String | `@unique` |
| passwordHash | String | `@map("password_hash")`, hash bcrypt |
| role | `UserRole` | enum: `produccion` / `despacho` / `admin` |
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
| minStock | Decimal | `@default(0)` `@map("min_stock")`, umbral de alerta |
| createdAt | DateTime | `@map("created_at")` |

### `clients`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| name | String | |
| contactInfo | Json? | `@map("contact_info")`. ⚠️ **columna legacy sin uso**: nadie la llena. El futuro módulo de contactos la reemplaza (ver [09 — Guía de contribución](09-contributing.md)) |
| active | Boolean | `@default(true)` — el listado filtra `active: true` |
| createdAt | DateTime | `@map("created_at")` |

### `production_entries`

Registra la producción de un producto.

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| productId | Int | FK → products |
| labelCode | String? | etiqueta |
| operatorName | String | operario (obligatorio) |
| clientId | Int? | FK → clients (nullable: se crea el cliente por nombre si no existe) |
| measure | String? | hereda del producto si no se indica |
| kilos | Decimal | cantidad producida |
| driverName | String? | conductor |
| status | `ProductionStatus` | enum: `pendiente` / `en_transito` / `recibido` / `rechazado` — **hoy se crea como `recibido`** |
| source | `ProductionSource` | enum: `manual` / `excel_import` / `whatsapp_bot` |
| observations | String? | |
| createdById | Int? | FK → users |
| createdAt | DateTime | `@map("created_at")` |

### `inventory_movements`

Bitácora de cada cambio de stock (auditoría de inventario).

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| productId | Int | FK → products |
| movementType | `MovementType` | enum: `entrada_produccion` / `salida_despacho` / `ajuste` / `devolucion` |
| quantity | Decimal | positivo = entrada, negativo = salida |
| referenceType | `ReferenceType` | enum: `production_entry` / `dispatch_item` / `manual_adjustment` |
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

### `dispatches`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| clientId | Int | FK → clients |
| status | `DispatchStatus` | enum: `pendiente` / `en_proceso` / `despachado` |
| requestedDate | DateTime | `@default(now())` |
| dispatchedDate | DateTime? | se fija cuando todos los items están despachados |
| createdById | Int? | FK → users |
| createdAt | DateTime | `@map("created_at")` |

### `dispatch_items`

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| dispatchId | Int | FK → dispatches |
| productId | Int | FK → products |
| quantityRequested | Decimal | solicitado |
| quantityDispatched | Decimal? | `NULL` hasta marcarlo despachado |
| labelCode | String? | |
| notes | String? | |

### `import_logs`

Registro de cada importación de producción (Excel manual o WhatsApp).

| Campo | Tipo | Notas |
|---|---|---|
| id | Int | PK |
| filename | String | |
| source | `ImportSource` | enum: `manual_upload` / `whatsapp_bot` |
| rowsProcessed | Int | `@default(0)` |
| rowsFailed | Int | `@default(0)` |
| uploadedById | Int? | FK → users |
| createdAt | DateTime | `@map("created_at")` |

## Enums (definidos en el schema)

| Enum | Valores |
|---|---|
| `UserRole` | `produccion`, `despacho`, `admin` |
| `ProductCategory` | `bultos`, `rollos_prec_lam`, `rollos_fuelle`, `mangueta`, `tiras`, `control_impresion` |
| `ProductUnit` | `kg`, `unidad` |
| `ProductionStatus` | `pendiente`, `en_transito`, `recibido`, `rechazado` |
| `ProductionSource` | `manual`, `excel_import`, `whatsapp_bot` |
| `MovementType` | `entrada_produccion`, `salida_despacho`, `ajuste`, `devolucion` |
| `ReferenceType` | `production_entry`, `dispatch_item`, `manual_adjustment` |
| `DispatchStatus` | `pendiente`, `en_proceso`, `despachado` |
| `ImportSource` | `manual_upload`, `whatsapp_bot` |

## Migraciones

`server/prisma/migrations/` guarda el historial SQL. Actualmente hay una sola: `20260722012128_init` (crea todas las tablas y enums).

Para aplicar nuevos cambios al schema:

```bash
npm run prisma:migrate    # crea una carpeta nueva con el SQL + regenera el client
```

> Una migración que solo hace `CREATE TABLE` no afecta los datos existentes. Antes de borrar columnas o modelos, revise el impacto con cuidado.

## Seed (`server/prisma/seed.ts`)

`npm run prisma:seed` siembra datos iniciales (idempotente):

- 3 usuarios de prueba (contraseña `password123`): admin, produccion, despacho.
- 6 productos (SKUs `BUL-001`, `ROL-PL-001`, `ROL-F-001`, `MAN-001`, `TIR-001`, `CTL-001`).
- 2 clientes: "Cliente ACME", "Distribuidora Norte".

## Consultas útiles en psql

```bash
docker exec -it db psql -U inventario -d inventario_despachos -c "\dt"      # tablas
docker exec -it db psql -U inventario -d inventario_despachos -c "\d inventory_stock"  # estructura de una tabla
docker exec -it db psql -U inventario -d inventario_despachos -c "SELECT * FROM inventory_stock;"
```
