# 08 — Reglas de negocio

## El ciclo del stock

Este es el flujo central del sistema:

```
┌────────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  Producción         │     │  Inventario       │     │  Despacho            │
│  (Excel / manual)   │ ──► │  inventory_stock  │ ──► │  (sale stock)        │
└────────────────────┘     └──────────────────┘     └──────────────────────┘
   entrada_produccion          +kilos                  salida_despacho -kilos
```

### 1. Entrada: producción suma stock

Cuando se crea una entrada de producción (manual o por importación), el sistema ejecuta **una sola transacción** (`server/src/routes/production.ts` → `createProductionEntry`):

1. El sistema valida que el `SKU` exista en el catálogo (`products`). Si no → error `400`.
2. Si viene `clientName`, el sistema busca el cliente por nombre. Si no existe, **lo crea**.
3. El sistema crea el registro en `production_entries` (con `status: "recibido"` y `source` según el origen).
4. `applyMovement(tx, { quantity: +kilos, movementType: "entrada_produccion", referenceType: "production_entry", ... })`:
   - Registra un `inventory_movement` (bitácora).
   - **Incrementa** `inventory_stock.current_quantity`.

El `measure` de la entrada hereda del producto si no se indica.

### 2. Salida: despacho resta stock

Cuando se marca un item como despachado (`PATCH /api/dispatches/:dispatchId/items/:itemId`), el sistema ejecuta **una sola transacción** (`server/src/routes/dispatches.ts`):

1. El sistema actualiza `quantity_dispatched` del item.
2. `applyMovement(tx, { quantity: -kilos, movementType: "salida_despacho", referenceType: "dispatch_item", ... })`:
   - Registra el movimiento de salida.
   - **Decrementa** `inventory_stock.current_quantity`.
3. El sistema recalcula los items pendientes del despacho:
   - Si **no quedan** pendientes → `status: "despachado"` y fija `dispatched_date`.
   - Si **quedan** → `status: "en_proceso"`.

### 3. El stock desnormalizado

`inventory_stock` guarda el **total actual** por producto (`current_quantity`). `applyMovement` lo mantiene con `upsert`:

- Si el producto no tiene fila → `create` con `current_quantity = quantity`.
- Si ya existe → `update` con `current_quantity: { increment: quantity }`.

La **bitácora** (`inventory_movements`) guarda cada movimiento individual (auditoría). El stock actual es el acumulado derivado.

> Nota: las reglas de **ajuste** y **devolución** están definidas en los enums (`MovementType`). No hay endpoints que las usen todavía.

## Alertas de stock mínimo

- Cada producto tiene un `min_stock`.
- `getLowStockAlerts()` devuelve solo los productos con `currentStock < minStock`.
- La UI (`InventoryDashboard`) muestra una alerta superior cuando hay al menos un producto bajo el stock mínimo. Marca el estado en la tabla.

## Estados de producción (`ProductionStatus`)

`pendiente` → `en_transito` → `recibido` → `rechazado`.

**Hoy**, las entradas se crean directamente como `recibido` (por alta manual o importación). Los estados intermedios (`pendiente`/`en_transito`) están definidos para la integración con WhatsApp (cuando el archivo llega sin confirmar). No se usan en el código actual.

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

Toda operación que toca **dos o más tablas** relacionadas al stock usa `prisma.$transaction`:

- Crear entrada de producción (entry + movimiento + stock).
- Marcar item despachado (item + movimiento + stock + estado del despacho).

Si alguna parte falla, **nada se aplica**. Las tablas nunca quedan inconsistentes.

## Notas de integridad

- Los clientes se crean automáticamente desde el nombre en una entrada de producción si no existen.
- `users`, `products`, `production_entries`, `dispatches` y `import_logs` guardan `created_by`/`created_at` para trazabilidad.
- `inventory_stock` es 1:1 con `products` (PK = `product_id`).
