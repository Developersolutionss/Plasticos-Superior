# 08 — Reglas de negocio

## El flujo completo

El sistema conecta el negocio de punta a punta:

```
Cotización ───► Pedido (v1) ──► [aprobado] ──► [Planeación] ──► Órdenes de Producción ──► Estaciones ──► Precorte ──► [Calidad aprueba] ──► Inventario
                                                                                                                      │
                                                                                                                      └──► [Calidad rechaza] ──► OP detenida (sin stock)
                                                                                                                      │
                                                                                                                      ▼
                                                                                                  Inventario ─── Despacho (resta stock) ─── Factura ─── Pagos (cartera)
```

## El ciclo del stock

Este es el flujo central de inventario:

```
┌────────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  Producción        │     │  Inventario      │     │  Despacho            │
│  (Excel / manual)  │ ──► │  inventory_stock │ ──► │  (sale stock)        │
└────────────────────┘     └──────────────────┘     └──────────────────────┘
   entrada_produccion          +kilos                  salida_despacho -kilos
```

### 1. Entrada: producción suma stock

**Por carga directa** (`POST /api/production/entries` o importación) — una sola transacción (`createProductionEntry`):

1. Valida que el `SKU` exista en el catálogo. Si no → `400`.
2. Si viene `clientName`, busca el cliente por nombre. Si no existe, **lo crea**.
3. Crea el registro en `production_entries` (con `status: "recibido"` y `source` según el origen).
4. `applyMovement(tx, { quantity: +kilos, movementType: "entrada_produccion", referenceType: "production_entry" })`:
   - Registra un `inventory_movement` (bitácora).
   - **Incrementa** `inventory_stock.current_quantity`.

El `measure` de la entrada hereda del producto si no se indica.

### 2. Salida: despacho resta stock

Cuando se marca un ítem como despachado (`PATCH /api/dispatches/:dispatchId/items/:itemId`) — una sola transacción:

1. Actualiza `quantity_dispatched` del ítem.
2. `applyMovement(tx, { quantity: -kilos, movementType: "salida_despacho", referenceType: "dispatch_item" })`:
   - Registra el movimiento de salida.
   - **Decrementa** `inventory_stock.current_quantity`.
3. Recalcula los ítems pendientes del despacho:
   - Si **no quedan** pendientes → `status: "despachado"` y fija `dispatched_date`.
   - Si **quedan** → `status: "en_proceso"`.

### 3. Producción por Órdenes de Trabajo (OP)

La OP es la unidad de trabajo. Cada OP pasa por las **cuatro estaciones** en orden:

```
Extrusión → Impresión → Sellado → Precorte
```

- `POST /api/production-orders` crea la OP (`OP-00001`) con `status: pendiente`.
- `POST /api/production-orders/:id/stages` registra el paso por una estación:
  - Crea el `production_stage_log` (máquina, operario, kilos, merma, tiempos, `details` JSON).
  - Si la OP está `pendiente`, pasa a `en_proceso`.
  - **Cuando la estación es `precorte`** (la última), la OP queda `pendiente_calidad`. Todavía **no** genera inventario: recién se mueve el stock cuando Calidad aprueba el lote.
- Un operario solo puede registrar **su** estación (definido por `OPERARIO_STATIONS`). Gestión de producción puede registrar cualquier estación.
- Estados de OP: `pendiente` → `en_proceso` → `pendiente_calidad` → `finalizada` (o `detenida` / `cancelada`, control evolutivo por `PATCH /status`).
- Cuando la etapa de `precorte` deja la OP `pendiente_calidad`, el sistema notifica a `ROLES.CALIDAD` (`notifyRoles`, ver más abajo).

### Control de calidad

`POST /api/production-orders/:id/quality-check` decide el destino del lote:

- **Aprobado**: se genera la entrada de inventario (`applyMovement` con el kilaje del precorte) y la OP pasa a `finalizada`.
- **Rechazado**: la OP queda `detenida` sin mover stock (Producción decide qué hacer). El sistema notifica a `ROLES.PRODUCCION_GESTION`.
- La OP debe estar `pendiente_calidad` y no tener aún un control registrado (una sola revisión por OP, `quality_checks.production_order_id` es único).

### Trazabilidad

`GET /api/production-orders/:id` reúne en una sola vista de solo lectura: los pasos por estación, el resultado del control de calidad y el pedido/cliente de origen (si la OP vino de Planeación). Disponible para gerencia de producción, Calidad y Auditoría.

### 4. El stock desnormalizado

`inventory_stock` guarda el **total actual** por producto (`current_quantity`). `applyMovement` lo mantiene con `upsert`:

- Si el producto no tiene fila → `create` con `current_quantity = quantity`.
- Si ya existe → `update` con `current_quantity: { increment: quantity }`.

La **bitácora** (`inventory_movements`) guarda cada movimiento individual (auditoría). El stock actual es el acumulado derivado.

> Nota: las reglas de **ajuste** y **devolución** están definidas en los enums (`MovementType`). No hay endpoints que las usen todavía.

## Almacén / WMS: stock por ubicación

`stock_locations` es **complementaria** a `inventory_stock`, no la reemplaza: registra cuánto de un producto hay en cada `warehouse_location` (estante, rack, zona), administrado a mano por Almacén.

- La suma de las filas de un producto en `stock_locations` puede quedar **por debajo** de su stock total en `inventory_stock` — la diferencia es "sin ubicar" (`GET /api/warehouse/stock` la expone como `unassigned`, que puede quedar negativo si se asignó de más). El endpoint no bloquea esa diferencia: es una herramienta operativa, no la fuente de verdad del stock.
- `POST /api/warehouse/assign` mueve/asigna cantidad hacia una ubicación (y descuenta de otra si se indica `fromLocationId`), en una transacción. `400` si la ubicación de origen no tiene suficiente.
- Cada ubicación tiene un **QR imprimible** (`GET /api/warehouse/locations/:id/qr`) que codifica su `publicToken`. Escanearlo abre `GET /api/public/locations/:token` — **sin login** — con el stock de esa ubicación en vivo (refetch cada 5 s en el frontend). El token, no el `code` corto de la ubicación, es la credencial: solo quien escaneó el QR físico puede consultarla.

## Notificaciones in-app

`notifyRoles(roles, { type, message, link? })` (`services/notify.ts`) crea una notificación para cada usuario activo con alguno de los roles dados. No hay un bus de eventos central: cada router que necesita avisar llama a esta función explícitamente. Hoy los únicos disparadores del sistema son los dos de Calidad, arriba: OP lista para revisión (a `ROLES.CALIDAD`) y lote rechazado (a `ROLES.PRODUCCION_GESTION`). Cualquier módulo nuevo que necesite notificar debe llamar a `notifyRoles` desde su propio router — no hay disparo automático por cambio de estado en general.

## Auditoría forense

Además de la bitácora de movimientos, hay una **auditoría forense** (`audit_logs`) que registra automáticamente cada `create`/`update`/`delete` sobre las tablas críticas:

- Tablas auditadas: `Client`, `Dispatch`, `ProductionEntry`, `InventoryMovement`.
- Cada entrada guarda la tabla, el id del registro, la acción, el estado **antes/después** (JSON) y quién lo hizo (usuario, IP, user-agent).
- La escribe una extensión de Prisma (`withAudit`) que envuelve el cliente compartido. Ningún router la crea a mano.
- Se consulta con `GET /api/audit-log` (rol auditoría), paginado y filtrable por tabla.

## Planeación: pedido a órdenes de producción

El módulo de Planeación convierte los ítems de un pedido aprobado en órdenes de producción.

1. Un pedido con estado `aprobado` o `en_produccion` tiene los ítems de su versión vigente.
2. La **cola de Planeación** (`GET /api/production-orders/pending-planning`) devuelve los ítems que aún no tienen una OP.
3. `POST /api/production-orders/from-pedido-item/:id` genera la OP de un ítem. Usa `quantityPlanned = item.quantity` y `measure` del ítem (o del producto).
4. La OP queda enlazada con `pedidoVersionItemId`. Un ítem solo tiene una OP (`@unique`): si ya la tiene, el endpoint responde `400`.

Reglas:

- Acceso a la cola y a la generación: gestión de producción (`gerente_produccion`, `planeacion`).
- La cola no es una tabla. Se deriva de los pedidos en cada consulta.
- La OP nueva usa numeración `OP-XXXXX` con reintento (ver "Consistencia / transacciones" más abajo: hasta 8 intentos con backoff y jitter).

## Ranking "Frecuentes" (CRM)

Cada cliente y cada contacto guarda su propio contador:

- `viewCount` — veces que se abrió la ficha.
- `cycleInteractions` — interacciones del ciclo actual (semana).
- `lastViewedAt` — última visita.

Reglas:

- Cada apertura suma 1. Al llegar al umbral `HOT_THRESHOLD` (5), el perfil sube a máximo actual + 1 y el contador del ciclo vuelve a 0.
- Un cliente o contacto nuevo **nace "hot"**: empieza arriba del ranking.
- La frecuencia del cliente y la del contacto son **independientes**.
- La **purga semanal** (`frecuentesReset.ts`) re-escala los valores por ranking (n-1 … 0) para que no crezcan sin límite. No reordena posiciones. Corre al arrancar y luego cada hora.

## Comercial: cotización → pedido → factura → pago

1. **Cotización**: `COT-00001`, con estado (`borrador → enviada → aceptada…`). Si un ítem no trae precio, toma el del catálogo.
2. **Conversión**: `POST /cotizaciones/:id/convertir-a-pedido` copia los ítems a un **Pedido nuevo** (v1). La cotización queda enlazada (no se borra).
3. **Pedido versionado**: cada edición relevante (`PATCH /pedidos/:id`) crea una **versión nueva completa** (v2, v3…) en vez de sobrescribir. El pedido guarda `current_version` y su estado aparte, para listarlo sin buscar la última versión.
4. **Factura**: puede nacer de un **pedido** (`/desde-pedido/:id`, copia la última versión) o **suelta** (cliente + ítems directo). Numeración `FAC-00001`.
5. **Pagos**: se registran como abonos (`POST /facturas/:id/payments`). El estado de la factura se **recalcula solo** con cada abono:
   - pagado ≤ 0 → `emitida`
   - 0 < pagado < total → `pagada_parcial`
   - pagado ≥ total → `pagada`
   - `anulada` es una acción manual (`PATCH /facturas/:id/anular`).
6. **Cartera** (`GET /clients/:id/cartera`): saldo pendiente = total facturado (no anulado) − pagos recibidos. El `creditLimit` es un tope manual editable.

## Alertas de stock mínimo

- Cada producto tiene un `min_stock`.
- `getLowStockAlerts()` devuelve solo los productos con `currentStock < minStock`.
- La UI (`InventoryDashboard`) muestra una alerta superior cuando hay al menos un producto bajo el mínimo. Marca el estado en la tabla.

## Estados de producción (`ProductionStatus`)

`pendiente` → `en_transito` → `recibido` → `rechazado`.

**Hoy**, las entradas en `production_entries` se crean directamente como `recibido` (por alta manual o importación). La OP terminada no crea una fila en `production_entries`. En su lugar, cuando Calidad aprueba el lote, el sistema genera un movimiento de inventario de tipo `entrada_produccion` — con `referenceType: "manual_adjustment"`, referenciando el control de calidad — y actualiza `inventory_stock`. Los estados intermedios (`pendiente`/`en_transito`) están definidos para la integración con WhatsApp, para cuando el archivo llega sin confirmar. No se usan en el código actual.

## Estados de despacho (`DispatchStatus`)

| Estado | Cuándo |
|---|---|
| `pendiente` | Recién creado (ningún ítem despachado) |
| `en_proceso` | Al menos un ítem despachado. Quedan pendientes |
| `despachado` | Todos los ítems despachados |

Transición automática en el `PATCH` de ítems. También fija `dispatched_date` al pasar a `despachado`.

## Origen de las entradas (`ProductionSource`)

- `manual` → alta individual (`POST /api/production/entries`).
- `excel_import` → confirmación de una importación (`POST /api/production/import/confirm`).
- `whatsapp_bot` → reservado para el webhook de WhatsApp (fase 2). Hoy solo registra en `import_logs`. No crea entradas.

## Reglas de la importación de Excel/CSV

- Columnas esperadas: `SKU | Etiqueta | Operario | Cliente | Medida | Kilos | Conductor | Observaciones`.
- Validación por fila: `SKU` obligatorio, `Operario` obligatorio, `Kilos` numérico > 0. Las filas vacías se ignoran.
- **Flujo en dos pasos:**
  1. `preview`: parsea el archivo. Devuelve filas válidas/inválidas **sin persistir** (control humano antes de escribir).
  2. `confirm`: persiste solo las filas válidas (las inválidas se omiten). Registra el resultado en `import_logs`.

## Consistencia / transacciones

Toda operación que toca **dos o más tablas** usa `prisma.$transaction`. El sistema no escribe a medias. Si alguna parte falla, **nada se aplica**. Las tablas nunca quedan inconsistentes.

Operaciones transaccionales actuales:

- Alta de producción (entrada + movimiento + stock).
- Registrar etapa de estación (etapa + estado de la OP). Si la estación es precorte, la OP pasa a `pendiente_calidad` (sin mover stock).
- Control de calidad (quality_check +, si aprueba, entrada + stock + estado `finalizada` de la OP; si rechaza, estado `detenida`).
- Marcar ítem despachado (ítem + movimiento + stock + estado del despacho).
- Crear contacto/dirección principal (desmarcar el anterior + crear el nuevo).
- Borrar un contacto principal (asignar el siguiente + borrar).
- Numeración consecutiva (`OP-`, `COT-`, `PED-`, `FAC-`): hasta **8 reintentos** con backoff creciente y jitter (`delayMs = 10 * intento + Math.random() * 30`) si dos requests calculan el mismo número.
- Generar una OP desde la cola de Planeación (crea la OP y enlaza el ítem).
- Asignar stock de Almacén a una ubicación (descuenta el origen + suma el destino).
- Purga semanal de Frecuentes (re-escalar `viewCount` + reset de `cycleInteractions` + actualizar `app_meta`).
- Reset de contraseña (password + token usado).
- Registrar un pago (payment + `recalculateStatus`).

## Notas de integridad

- Los clientes se crean automáticamente desde el nombre en una entrada de producción si no existen.
- `users`, `products`, `production_entries`, `dispatches`, `quality_checks`, `audit_logs` e `import_logs` guardan `created_by`/`created_at` para trazabilidad.
- `inventory_stock` es 1:1 con `products` (PK = `product_id`).
- `client_contacts`, `client_addresses` y `client_interactions` cuelgan de `clients`.
- La unicidad del contacto o dirección principal la garantiza la API (transacción), no un índice en la BD.
- Los tokens de reset de contraseña se guardan **hasheados** y son de un solo uso (1 hora de validez).
