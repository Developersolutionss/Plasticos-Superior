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
4. **Fuera** de la transacción, si ese `PATCH` fue el que recién dejó el despacho `despachado` (no si ya lo estaba), intenta avisarle al cliente por WhatsApp (`sendWhatsAppMessage`, al contacto principal o al primero con teléfono). Sin credenciales de Meta configuradas, o si el cliente no tiene teléfono, no pasa nada — no rompe el flujo de despacho. Un reintento sobre el mismo ítem ya despachado no reenvía el aviso.

### 3. Producción por Órdenes de Trabajo (OP)

La OP es la unidad de trabajo. Cada OP pasa por hasta **cuatro estaciones**, en este orden:

```
Extrusión → Impresión → Sellado → Precorte
```

**La OP nace en blanco.** `POST /api/production-orders` la crea sin `station` (proceso `null`) y en `status: borrador`. En `borrador`, Gestión carga materia prima, medidas, cliente y referencia — la OP todavía no es visible ni operable para los operarios de planta. Dos pasos la llevan a planta:

1. `POST /:id/derive` con `station: "extrusion"` asigna el primer proceso. Este primer `derive` no crea una fila nueva: solo completa el `station` de la misma OP (todavía en blanco no hubo ningún trabajo real que separar en una fila aparte).
2. `POST /:id/release` la libera a planta: pasa de `borrador` a `pendiente` y a partir de ahí aparece en la cola de su estación (`EstacionProduccion.tsx`). No hay vuelta atrás por acá — para corregir algo después de cerrada la OP se usa `POST /:id/reopen` (ver más abajo).

**Un solo número para toda la cadena.** `orderNumber` (`OP-00001`) ya no es único por fila: identifica la cadena de derivación completa, no cada etapa. Extrusión, y todo lo que se derive de ella, comparten el mismo número — cada etapa sigue siendo su propia fila en `production_orders`, con sus propios `specs` y rollos, pero el número solo sube al crear una OP nueva (nunca al derivar).

- **Extrusión es el proceso base**: de ella se derivan (`POST /:id/derive`) las OPs de Impresión, Sellado o Precorte; de Impresión se derivan Sellado o Precorte. La cadena queda en `parentOrderId`. Una OP solo puede derivar **una vez** a cada estación destino.
- La OP hija hereda producto, cliente, medida y specs heredables del padre (`inheritSpecs` — color, ancho, fuelles, calibre, tipo de material, etc.), salvo que el body los pise. Editar esos campos en una OP ya derivada **propaga el cambio en cascada** a sus OPs hijas y nietas — el padre manda sobre esos datos puntuales.
- La meta (`quantityPlanned`) de una OP hija por defecto es lo que el padre **produjo de verdad** (suma real de sus rollos), no lo que el padre tenía planificado — evita que la hija quede esperando kilos que nunca se van a cargar. Si el padre sigue produciendo después de derivar, esa meta se sincroniza sola mientras la hija no tenga rollos propios.
- `POST /api/production-orders/:id/rolls` agrega una fila al **registro acumulativo de rollos** (fecha, turno, operario, máquina, etiqueta, peso, desperdicio, pruebas en `details`). Si la OP está `pendiente`, pasa a `en_proceso`. La meta se completa con **peso + desperdicio**; un rollo que se pase de la meta se rechaza.
- Un operario solo carga rollos en OPs de **su** estación (`OPERARIO_STATIONS`). Gestión de producción puede cargar en cualquiera.
- `POST /api/production-orders/:id/close` cierra la OP (requiere ≥1 rollo): Extrusión siempre queda `finalizada` directo (su material sigue en las OPs derivadas, sin mover stock). **Impresión, Sellado y Precorte** pueden ser procesos finales — quedan `pendiente_calidad` sin mover stock todavía. Cerrar una OP e derivarla son decisiones independientes: Impresión puede cerrarse (ir a Calidad) aunque también tenga OPs derivadas a Sellado o Precorte.
- Al cerrar una OP de **Extrusión**, el sistema descuenta del stock de materia prima el kg cargado en cada insumo de `specs.materiaPrima` (ver [Materia prima](#materia-prima) más abajo).
- Estados de OP: `borrador` → `pendiente` → `en_proceso` → (`finalizada` | `pendiente_calidad` → `finalizada`) (o `detenida` / `cancelada`, control manual por `PATCH /status`).
- Cuando el cierre deja la OP `pendiente_calidad`, el sistema notifica a `ROLES.CALIDAD` (`notifyRoles`, ver más abajo).
- `GET /:id/report.pdf` emite el **reporte consolidado** de la OP con el layout del formato en papel (rollos, kilos totales, insumos, operarios por turno, adjuntos).

#### Numeración de rollos por estación

Cada rollo lleva un código de QR con el prefijo de su proceso: `EXT-1`, `IMP-1`, `SELL-1`, `PRE-1`. Cada estación numera **su propia secuencia**, empezando en 1 (`ProductionRoll.station` + `stationSequence`). Antes todos los rollos compartían un único autoincrement de toda la tabla: sacar un rollo de Extrusión después de uno de Precorte podía saltar de `EXT-70` a `PRE-71` en vez de arrancar en 1, porque las cuatro estaciones se veían intercaladas en un mismo conteo. Etiquetas físicas viejas con el formato anterior (`RL-<id>`) se siguen resolviendo al escanear, para no romper rollos que sigan circulando en planta.

#### Rollo madre con saldo vivo (Sellado y Precorte)

En Sellado y Precorte, un rollo grande de Extrusión (o Impresión) se monta en la máquina y de él salen varios rollos chicos — no se consume entero de una vez. Cada rollo chico descuenta kilos del saldo del rollo madre, hasta agotarlo:

- La tabla `roll_consumptions` guarda cuántos kilos le sacó cada rollo chico a cada rollo madre. El saldo disponible de un rollo madre es su `weightKg` menos la suma de lo ya consumido.
- Al cargar un rollo, el operario escanea uno o más rollos madre en orden (`sourceRollIds`). El reparto agota el primero antes de tocar el siguiente: si quedaban 10 kg del madre A y se cargan 15, salen 10 de A y 5 de B.
- Si los rollos madre escaneados no alcanzan para cubrir el peso de la fila, el sistema rechaza la carga y pide escanear el siguiente rollo madre.
- **Precorte** tiene dos pares ETIQUETA R / PESO R en el papel, justo para este caso: cuando un rollo chico se pasa del saldo del madre, el excedente sale del siguiente rollo madre y se registra en el segundo par (`details.etiquetaR2`/`details.pesoR2`). Ese segundo peso es material real: cuenta en la meta de la OP y en el kilaje que se manda a inventario al aprobar Calidad, igual que el peso base.
- En el resto de las estaciones (Extrusión, Impresión), escanear un rollo insumo lo sigue consumiendo entero, como siempre — solo Sellado y Precorte reparten por saldo.
- `sourceRollId` en `production_rolls` sigue guardando el rollo madre **principal** (el primero escaneado) como atajo para trazabilidad rápida; el reparto real en kilos vive en `roll_consumptions`.

#### Reglas de plantilla por estación

Cada estación (`services/opTemplates.ts`, con espejo en el frontend) define qué campos aplican:

- **Caras** (tratado/impresión) solo acepta `1` o `2` — es una opción fija, no texto libre.
- **Campos de lista** (Color, Densidad, Forma/Tipo, Fuelles, Caras, Unidad, Material para, etc.): el servidor solo guarda una de las opciones de la plantilla de esa estación (`normalizeSpecOptions` en `services/opTemplates.ts`). Normaliza lo que es claramente la misma opción (mayúsculas, tildes, espacios, y sinónimos confirmados por Gestión: `trasparente`/`TRANSP`/`Natural` → `Transparente`, caras `ambas` → `2` y `0`/`no` → vacío (sin tratado), fuelles como cantidad `0` → `NO` y mayor a 0 → `SI`) y rechaza con 400 cualquier otro valor, nombrando el campo y las opciones válidas. Al derivar, lo heredado se lleva a la opción exacta de la hija; un valor viejo fuera de lista no se copia. La hoja muestra en rojo, como "(no válido)", un valor guardado de antes que no está en la lista. Para corregir los datos ya guardados: `npx tsx scripts/normalize-spec-options.ts` (modo prueba) y `--apply` para guardar; lo que no corresponde a ninguna opción se lista para corregirlo a mano.
- **Medidas finales** en Precorte solo lleva Unidad, Ancho y Largo. Sellado (y el resto que usa la sección completa) agrega además Lateral, Fuelle fondo, Pestaña, Fondo y Solapa volada — esos cinco campos se sacaron de Precorte a pedido del cliente.
- **Color y Densidad** de Precorte se precargan con el valor cargado en la OP de Extrusión de la misma cadena (`specDefaultKey` en la plantilla) — el operario los ve completos y solo los corrige si hace falta, en vez de tipearlos de cero.
- **Etiquetas de bulto (Sellado):** existen primero en el mundo físico. Gestión genera un lote de etiquetas pre-impresas (`bulto_labels`, código único, estado `disponible`/`usada`) y Laura las reparte a mano a cada operario. El operario escanea la que usó (`bultoLabelCode` al cargar el rollo) en vez de tipear el número de "E. BULTO" — una etiqueta ya usada no se puede volver a escanear.
- **Umbral de alerta configurable** (`alertThresholdKg`): a cuántos kg (peso + desperdicio) avisarle a Gestión que la OP está por completarse. Si Gestión no lo configura a mano, el sistema usa el default de siempre (90 % de `quantityPlanned`). El aviso se dispara una sola vez, justo al cruzar el umbral.

#### Destino de la OP y reapertura

- **Destino** (estantería o cliente): el `clientId` de la OP es explícito y editable mientras la OP siga `borrador` o abierta (`PATCH /:id`) — una OP sin cliente entra a inventario general ("a estantería"); una OP con cliente asignado, además de sumar a inventario, genera su despacho automáticamente al aprobarse (ver "Control de calidad" abajo).
- `POST /:id/reopen` reabre una OP cerrada por error (desde `finalizada`, `pendiente_calidad` o `detenida`) y la deja `en_proceso` otra vez, editable y lista para cargar o borrar rollos. Revierte cualquier efecto de inventario que ya se hubiera aplicado, para que ningún kilo quede "fantasma" en el stock:
  - si tenía un control de calidad **aprobado**, revierte la entrada de producto terminado y borra el control (al volver a cerrar, pasa por Calidad de nuevo);
  - si tenía un control **rechazado**, solo borra el control;
  - si es una OP de Extrusión, revierte la materia prima que se había descontado al cerrarla.
  - **No se puede reabrir** si Calidad ya generó un despacho para esa OP y ese despacho sigue vivo (no cancelado) — primero hay que cancelarlo (`POST /dispatches/:id/cancel`), para no descontar o duplicar el stock.

### Control de calidad

`POST /api/production-orders/:id/quality-check` decide el destino del lote:

- **Aprobado**: se genera la entrada de inventario (`applyMovement` con la suma de kg de los rollos) y la OP pasa a `finalizada`. Si la OP tiene **cliente asignado** (destino "a cliente", no "a estantería"), el sistema además crea un `Dispatch` automático en `pendiente` para ese cliente, con el producto y la cantidad ya cargados — Almacén solo confirma la salida física en vez de armar el despacho desde cero. El sistema notifica a `ROLES.ALMACEN` cuando esto pasa.
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
4. **Factura**: puede nacer de un **pedido** (`/desde-pedido/:id`, copia la última versión) o **suelta** (cliente + ítems directo). Numeración `FAC-00001`. Ambos caminos aceptan un `dueDate` opcional (fecha de vencimiento).
5. **Pagos**: se registran como abonos (`POST /facturas/:id/payments`). El estado de la factura se **recalcula solo** con cada abono:
   - pagado ≤ 0 → `emitida`
   - 0 < pagado < total → `pagada_parcial`
   - pagado ≥ total → `pagada`
   - `anulada` es una acción manual (`PATCH /facturas/:id/anular`).
6. **Cartera** (`GET /clients/:id/cartera`): saldo pendiente = total facturado (no anulado) − pagos recibidos. El `creditLimit` es un tope manual editable. Cada factura pendiente se marca **`vencida`** si `dueDate` ya pasó y todavía tiene saldo — no es un campo guardado, se calcula en cada consulta (también en `GET /dashboard/resumen`, que suma esos saldos en `carteraVencida`).
7. **PDF**: `GET /cotizaciones/:id/pdf` y `GET /facturas/:id/pdf` generan un PDF descargable (`services/pdfDocument.ts`, con `pdfkit`) listo para mandarle al cliente — mismos datos que se ven en pantalla, sin necesidad de capturas.

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
| `cancelada` | Cancelado a mano (`POST /:id/cancel`) — estado final, no vuelve atrás |

Transición automática en el `PATCH` de ítems. También fija `dispatched_date` al pasar a `despachado`.

**Cancelar un despacho** (`POST /api/dispatches/:id/cancel`, rol almacén) revierte los movimientos de stock de cualquier ítem que ya tuviera `quantityDispatched` cargado (movimiento `devolucion`, misma ubicación de origen si se había asignado una). El histórico de `quantityDispatched` de cada ítem **no se borra** — queda como registro de qué se llegó a despachar antes de cancelar; solo cambia el estado del despacho. Un despacho `cancelada` no acepta más ítems marcados ni una segunda cancelación.

Un despacho puede nacer manualmente (`POST /api/dispatches`) o automáticamente cuando Calidad aprueba una OP con cliente asignado (`productionOrderId` queda enlazado — ver [Control de calidad](#control-de-calidad)). Ese vínculo es lo que bloquea reabrir la OP mientras el despacho siga vivo.

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
- Registrar un rollo (rollo + reparto entre rollos madre en `roll_consumptions`, si aplica + estado de la OP). Si la OP llega a su meta, sigue `en_proceso` hasta que Gestión la cierra a mano.
- Cerrar una OP (estado + descuento de materia prima si es Extrusión).
- Reabrir una OP (`/reopen`): estado `en_proceso` + reversión de la entrada de inventario (si tenía calidad aprobada) o de la materia prima descontada (si es Extrusión) + borrado del control de calidad.
- Control de calidad (quality_check +, si aprueba, entrada + stock + estado `finalizada` de la OP + despacho automático si hay cliente asignado; si rechaza, estado `detenida`).
- Cancelar un despacho (`/cancel`): estado `cancelada` + reversión de stock de cada ítem que ya tuviera `quantityDispatched`.
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
