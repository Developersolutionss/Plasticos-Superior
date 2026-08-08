# 08 — Reglas de negocio

## El flujo completo

El sistema conecta el negocio de punta a punta:

```
Cotización ───► Pedido (v1) ──► [aprobado] ──► [Planeación] ──► Órdenes de Producción ──► Estaciones (precorte genera stock)
                                                                                            │
                                                                                            ▼
                                                                        Inventario ─── Despacho (resta stock) ─── Factura ─── Pagos (cartera)
```

## El ciclo del stock

Este es el flujo central de inventario:

```
┌────────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  Producción         │     │  Inventario       │     │  Despacho            │
│  (Excel / manual)   │ ──► │  inventory_stock  │ ──► │  (sale stock)        │
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

Cuando se marca un item como despachado (`PATCH /api/dispatches/:dispatchId/items/:itemId`) — una sola transacción:

1. Actualiza `quantity_dispatched` del item.
2. `applyMovement(tx, { quantity: -kilos, movementType: "salida_despacho", referenceType: "dispatch_item" })`:
   - Registra el movimiento de salida.
   - **Decrementa** `inventory_stock.current_quantity`.
3. Recalcula los items pendientes del despacho:
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
  - **Cuando la estación es `precorte`** (la última), además:
    1. Genera una **entrada de inventario** con `applyMovement` (producto terminado del OP).
    2. Marca la OP como `finalizada`.
- Un operario solo puede registrar **su** estación (definido por `OPERARIO_STATIONS`). Gestión de producción puede registrar cualquier estación.
- Estados de OP: `pendiente` → `en_proceso` → `finalizada` (o `detenida` / `cancelada`, control evolutivo por `PATCH /status`).

### 4. El stock desnormalizado

`inventory_stock` guarda el **total actual** por producto (`current_quantity`). `applyMovement` lo mantiene con `upsert`:

- Si el producto no tiene fila → `create` con `current_quantity = quantity`.
- Si ya existe → `update` con `current_quantity: { increment: quantity }`.

La **bitácora** (`inventory_movements`) guarda cada movimiento individual (auditoría). El stock actual es el acumulado derivado.

> Nota: las reglas de **ajuste** y **devolución** están definidas en los enums (`MovementType`). No hay endpoints que las usen todavía.

## Planeación: pedido a órdenes de producción

El módulo de Planeación convierte los items de un pedido aprobado en órdenes de producción.

1. Un pedido con estado `aprobado` o `en_produccion` tiene los items de su versión vigente.
2. La **cola de Planeación** (`GET /api/production-orders/pending-planning`) devuelve los items que aún no tienen una OP.
3. `POST /api/production-orders/from-pedido-item/:id` genera la OP de un item. Usa `quantityPlanned = item.quantity` y `measure` del item (o del producto).
4. La OP queda enlazada con `pedidoVersionItemId`. Un item solo tiene una OP (`@unique`): si ya la tiene, el endpoint responde `400`.

Reglas:

- Acceso a la cola y a la generación: gestión de producción (`gerente_produccion`, `planeacion`).
- La cola no es una tabla. Se deriva de los pedidos en cada consulta.
- La OP nueva usa numeración `OP-XXXXX` con reintento.

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

**Hoy**, las entradas en `production_entries` se crean directamente como `recibido` (por alta manual o importación). El **precorte** no crea una fila en `production_entries`: genera un movimiento de inventario de tipo `entrada_produccion` (con `referenceType: "manual_adjustment"` referenciando la etapa) y actualiza `inventory_stock`. Los estados intermedios (`pendiente`/`en_transito`) están definidos para la integración con WhatsApp (cuando el archivo llega sin confirmar). No se usan en el código actual.

## Estados de despacho (`DispatchStatus`)

| Estado | Cuándo |
|---|---|
| `pendiente` | Recién creado (ningún item despachado) |
| `en_proceso` | Al menos un item despachado. Quedan pendientes |
| `despachado` | Todos los items despachados |

Transición automática en el `PATCH` de items. También fija `dispatched_date` al pasar a `despachado`.

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
- Registrar etapa de estación con precorte (etapa + entrada + stock + estado de la OP).
- Marcar item despachado (item + movimiento + stock + estado del despacho).
- Crear contacto/dirección principal (desmarcar el anterior + crear el nuevo).
- Borrar un contacto principal (asignar el siguiente + borrar).
- Numeración consecutiva (`OP-`, `COT-`, `PED-`, `FAC-`).
- Generar una OP desde la cola de Planeación (crea la OP y enlaza el item).
- Purga semanal de Frecuentes (re-escalar `viewCount` + reset de `cycleInteractions` + actualizar `app_meta`).
- Reset de contraseña (password + token usado).
- Registrar un pago (payment + `recalculateStatus`).

## Notas de integridad

- Los clientes se crean automáticamente desde el nombre en una entrada de producción si no existen.
- `users`, `products`, `production_entries`, `dispatches` e `import_logs` guardan `created_by`/`created_at` para trazabilidad.
- `inventory_stock` es 1:1 con `products` (PK = `product_id`).
- `client_contacts`, `client_addresses` y `client_interactions` cuelgan de `clients`.
- La unicidad del contacto o dirección principal la garantiza la API (transacción), no un índice en la BD.
- Los tokens de reset de contraseña se guardan **hasheados** y son de un solo uso (1 hora de validez).