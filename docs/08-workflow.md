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

## El proceso físico de planta

Así se mueve el material en la planta del cliente (reunión del 2026-10-06). El sistema cubre los pasos 1 a 3. El paso 5 está cubierto en parte y los pasos 4 y 6 no están cubiertos todavía.

1. Extrusión saca 3 o 4 rollos grandes (rollos madre, unos 200 kg).
2. Un camión lleva los rollos madre de la **bodega principal** a la bodega de Sellado, Precorte o Impresión. Una persona los envía y otra los recibe (Despacho a bodegas).
3. En esa bodega se cortan en rollos chicos, que se registran en cuanto salen.
4. **Cubierto (2026-10-09):** otro camión devuelve los rollos chicos a la bodega principal, con su envío y su recepción (Despacho a bodegas, destino "Bodega principal"). Ver [Devolución a la bodega principal](#devolución-a-la-bodega-principal).
5. **Cubierto:** el despacho al cliente sale de la bodega principal, escaneando los rollos exactos. El módulo Despachos avisa, rollo por rollo, si todavía está en otra bodega o en camino (aviso, no bloqueo).
6. **No cubierto:** el orden no es fijo. Un rollo sellado puede pasar a Impresión, y un rollo chico puede volver a ser rollo madre. Hoy un rollo terminado solo se despacha a la bodega principal.

El control existe porque la mercancía se pierde en el trayecto entre bodegas. Si un rollo no aparece en la bodega principal, tiene que estar en la otra. El registro dice qué usuario lo llevó. No se pide seguimiento en tiempo real ni detalle de las subbodegas: basta con saber cuánto hay en cada una.

```
 1. Extrusión saca los rollos madre
          │
          ▼
 ┌──────────────────┐   2. camión con los rollos madre    ┌─────────────────────────────┐
 │ BODEGA PRINCIPAL │ ───────────────────────────────────►│ BODEGA DE PLANTA            │
 │ (Inventario)     │      [Despacho a bodegas]           │ Impresión, Sellado o Precorte│
 │                  │                                     │                             │
 │                  │ ◄───────────────────────────────────│ 3. cortan los rollos chicos │
 └──────────────────┘   4. camión con los rollos chicos   └─────────────────────────────┘
          │                  [Despacho a bodegas]
          │ 5. camión grande al cliente [Despachos]
          ▼
 ┌──────────────────┐
 │ NEGOCIO DEL      │
 │ CLIENTE          │
 └──────────────────┘
```

Las diferencias con el sistema actual están en [00 — Hoja de ruta](00-roadmap.md) (Backlog) y en [notas-pendientes-raw.md](notas-pendientes-raw.md).

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

1. Actualiza `quantity_dispatched` del ítem. Si el despacho no es la reserva de un cliente, verifica que no se lleve stock reservado (ver [Reservas para clientes](#reservas-para-clientes)).
2. `applyMovement(tx, { quantity: -kilos, movementType: "salida_despacho", referenceType: "dispatch_item" })`:
   - Registra el movimiento de salida.
   - **Decrementa** `inventory_stock.current_quantity`.
3. Recalcula los ítems pendientes del despacho:
   - Si **no quedan** pendientes → `status: "despachado"` y fija `dispatched_date`.
   - Si **quedan** → `status: "en_proceso"`.
4. **Fuera** de la transacción, si ese `PATCH` fue el que recién dejó el despacho `despachado` (no si ya lo estaba), intenta avisarle al cliente por WhatsApp (`sendWhatsAppMessage`, al contacto principal o al primero con teléfono). Sin credenciales de Meta configuradas, o si el cliente no tiene teléfono, no pasa nada — no rompe el flujo de despacho. Un reintento sobre el mismo ítem ya despachado no reenvía el aviso.

### Reservas para clientes

Pedido del cliente en la reunión del 2026-10-06: lo fabricado para un cliente no debe poder despacharse a otro (alguien veía "900 kg, sobra" y se los llevaba).

- Lo que produce una OP con cliente entra al inventario igual que siempre (al aprobar Calidad) y queda **reservado** para ese cliente. No hay tabla aparte: la reserva es el despacho que Calidad genera solo para ese cliente (`Dispatch.productionOrderId`), mientras siga `pendiente` o `en_proceso`, por sus ítems que todavía no salieron (`services/reservations.ts`).
- **Disponible** = stock − reservado. Existencias muestra las tres cifras; "Rollos para clientes" lista cada reserva con su cliente, su OP y sus rollos.
- Un despacho que no es la reserva de un cliente (uno armado a mano, u otra reserva) solo puede llevarse lo disponible: si pide más, `PATCH /api/dispatches/:id/items/:itemId` responde 400 y dice para quién está reservado. Si pide más que el stock total, el mensaje es el de stock insuficiente de siempre. La fila de `inventory_stock` del producto se bloquea (`FOR UPDATE`) para que dos despachos simultáneos no lean el mismo disponible.
- El despacho del propio cliente se lleva su reserva sin exigir estante (lo recién producido entra "sin ubicar"); puede elegir uno si ya se ubicó.
- **Sale con sus rollos:** para despachar la reserva se escanea cada rollo/bulto que sale (código + token del QR, como en las bodegas), y se guardan en `dispatch_item_rolls` atados al ítem. Solo se pueden escanear los de la OP del despacho; en un producto por kg la cantidad despachada tiene que ser la suma de sus kilos. Un rollo sale una sola vez: si el despacho se cancela, el rollo queda libre.
- **Despacho parcial:** se puede despachar menos de lo pedido (al cliente llegan rollos chicos). El ítem queda con lo que salió y el resto se convierte en un ítem pendiente nuevo del mismo despacho, que sigue reservado; el despacho pasa a `en_proceso` hasta que salga todo.
- **Despacho a mano:** los rollos son opcionales; si se escanean, tienen que ser de stock libre (OPs aprobadas en Calidad sin cliente) o de una OP de ese mismo cliente, nunca de otro cliente.
- **Trazabilidad:** cada rollo muestra "Despachado al cliente X (despacho #N) con K kg", quién lo escaneó y cuándo.
- Si el cliente cancela, se cancela su despacho: la reserva desaparece y esos kilos quedan libres para otro cliente.
- El cliente de la OP también se ve en Despacho a bodegas al escanear un rollo ("Para Cliente X" o "Para stock") y en cada rollo de Inventario de bodegas.

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
- `POST /api/production-orders/:id/close` cierra la OP (requiere ≥1 rollo): Extrusión siempre queda `finalizada` directo (su material sigue en las OPs derivadas, sin mover stock; el cliente pidió que lo que sale de una OP aparezca en el inventario, y esta regla está por confirmar). **Impresión, Sellado y Precorte** pueden ser procesos finales — quedan `pendiente_calidad` sin mover stock todavía. Cerrar una OP e derivarla son decisiones independientes: Impresión puede cerrarse (ir a Calidad) aunque también tenga OPs derivadas a Sellado o Precorte.
- Al cerrar una OP de **Extrusión**, el sistema descuenta del stock de materia prima el kg cargado en cada insumo de `specs.materiaPrima` (ver [Materia prima](#materia-prima) más abajo).
- Estados de OP: `borrador` → `pendiente` → `en_proceso` → (`finalizada` | `pendiente_calidad` → `finalizada`) (o `detenida` / `cancelada`, control manual por `PATCH /status`).
- Cuando el cierre deja la OP `pendiente_calidad`, el sistema notifica a `ROLES.CALIDAD` (`notifyRoles`, ver más abajo).
- `GET /:id/report.pdf` emite el **reporte consolidado** de la OP con el layout del formato en papel (rollos, kilos totales, insumos, operarios por turno, adjuntos).

#### Numeración de rollos por estación

Cada rollo lleva un código de QR con el prefijo de su proceso: `EXT-1`, `IMP-1`, `SELL-1`, `PRE-1`. Cada estación numera **su propia secuencia**, empezando en 1 (`ProductionRoll.station` + `stationSequence`). Antes todos los rollos compartían un único autoincrement de toda la tabla: sacar un rollo de Extrusión después de uno de Precorte podía saltar de `EXT-70` a `PRE-71` en vez de arrancar en 1, porque las cuatro estaciones se veían intercaladas en un mismo conteo. Etiquetas físicas viejas con el formato anterior (`RL-<id>`) se siguen resolviendo al escanear, para no romper rollos que sigan circulando en planta.

#### Balance de kilos entre estaciones (2026-09-29)

- **Toda OP derivada exige escanear el rollo de origen** en cada fila (Impresión incluida — antes era opcional y el rollo de Extrusión nunca quedaba consumido).
- **Sellado y Precorte:** del rollo madre sale el peso del rollo chico **más su desperdicio** (la merma también es material de ese rollo). En Precorte, el segundo par ETIQUETA R / PESO R lleva solo el peso que faltó; la merma se toma al final y no cuenta como producido.
- **Impresión (consume el insumo entero):** peso + desperdicio tiene que cuadrar con lo que entró, con tolerancia de 2% del insumo o 0,5 kg (lo mayor — la tinta suma algo de peso). Si faltan kilos, se cargan como desperdicio.
- **Materia prima de Extrusión:** no se puede liberar ni cerrar la OP si la fórmula (`specs.materiaPrima`) no suma 100%. Al cerrar se descuenta el **% de cada insumo sobre lo producido real** (peso + desperdicio de los rollos), no el kg calculado sobre la meta.
- **Reparto entre OPs hermanas:** la suma de las metas de las derivadas de un padre no puede superar lo que el padre produjo (o su meta, si todavía no produjo nada). Al derivar, la meta por defecto es lo que queda sin asignar; con todo asignado, derivar otra (o subir la meta de una hija) se rechaza hasta que Gestión baje alguna. Una hija única sigue sola a su padre cuando este carga más rollos; con varias, el reparto lo decide Gestión.

#### Ubicación física del rollo (despacho a bodegas)

Un rollo solo se consume en la estación donde está físicamente: en la bodega del último despacho recibido, o en su estación de origen si nunca se movió (`services/rollLocation.ts`). Para usar un rollo de Extrusión en Impresión, Sellado o Precorte primero hay que despacharlo a esa bodega y que allá lo reciban (pantalla Despacho a bodegas, `/api/roll-transfers`); un rollo en camino tampoco se puede consumir. Al despachar queda el saldo con que salió; al recibir se puede pesar y, si llega con más de 0,5 kg de diferencia, se avisa a Gestión.

#### Inventario de bodegas y ajustes de saldo (2026-10-02)

- **Saldo de un rollo** = su peso original − lo que le sacaron sus rollos hijos (`roll_consumptions`) + la suma de sus ajustes (`roll_adjustments`). El peso original nunca se modifica (es el dato de producción).
- **Peso al recibir** (decisión de Gestión, 2026-10-02): si la bodega destino pesa el rollo al recibirlo, ese peso pasa a ser su saldo (ajuste `recepcion`, enlazado al despacho). Si difiere más de 0,5 kg de lo que salió, además se avisa a Gestión. Si difiere más de 5 kg o del 10 % (lo mayor), se toma como error de tipeo: el peso queda registrado pero el saldo no cambia, y se avisa a Gestión para que lo verifique con un conteo.
- **Ajuste por conteo físico** (solo Gestión, con motivo obligatorio): el saldo pasa a lo pesado/contado; 0 significa que el rollo ya no está. No se puede ajustar un rollo en camino ni producto terminado. Queda en Trazabilidad y en Auditoría.
- **Inventario de bodegas** (pantalla del mismo nombre): rollos con saldo en cada bodega, totales, rollos en camino y antigüedad; un rollo que lleva 7 días o más en una bodega se marca como parado. Solo cuenta rollos que alimentan a otra estación (salidos de Extrusión o Impresión): lo de Sellado/Precorte se trata como producto terminado y va por Calidad e Inventario. En la planta, esos rollos chicos esperan en la bodega de su estación hasta que un camión los devuelva a la bodega principal, y eso todavía no se registra. Un operario abre directo en la bodega de su estación.

#### Devolución a la bodega principal

Pedido del cliente (reunión 2026-10-06): lo que sale de Sellado, Precorte o Impresión vuelve en camión a la bodega principal, y de ahí salen los despachos a clientes. Es una opción explícita en Despacho a bodegas (destino **Bodega principal**), no se deduce del número de escaneos del QR.

- **Salida:** el operario de la estación escanea el rollo (código + token) y elige "Bodega principal" — para un rollo terminado es el único destino, así que viene elegido —, y registra quién lo lleva (`entrega`) o se lleva él (`retiro`). Desde **Extrusión** no se devuelve (ahí nace el rollo madre).
- **Recepción:** solo **Almacén o Gestión** reciben en la bodega principal (un operario de planta no). Escanean el mismo QR y pueden registrar el peso de la balanza: en un rollo terminado se guarda y, si difiere de lo despachado en más de 0,5 kg, se avisa a Gestión, pero no se corrige ningún saldo (un rollo terminado no se consume: su peso es lo que produjo y es el que va al despacho del cliente).
- **Dónde está cada rollo:** Inventario de bodegas muestra la **Bodega principal** junto a las demás. Lo terminado nace en la bodega de su estación con "Falta devolverlo a la bodega principal" (y la tarjeta de la estación cuenta cuántos), en camino dice de dónde a dónde, quién lo lleva y para qué cliente, y en la principal queda sin marca de "parado". Un rollo que sale hacia un cliente (despacho no cancelado) deja de aparecer; si el despacho se cancela, vuelve.
- **Control de pérdidas:** si un rollo no aparece en la principal tiene que estar en la otra bodega o en camino, y el registro dice qué usuario lo llevó y cuál lo recibió.
- **Despacho al cliente:** el modal de Despachos dice, por rollo, "en la bodega principal" o "está en: Sellado (todavía no volvió a la principal)". Es solo un aviso: no se bloquea despachar un rollo que sigue en otra bodega (así los rollos que ya existían antes de esta función no quedan trabados).
- Tabla: `roll_transfers.from_station`/`to_station` usan el tipo `RollWarehouse` (las 4 estaciones + `principal`); las estaciones de las OPs siguen siendo `ProductionStation`.

#### Autocompletado en bodegas (2026-10-02)

Lo que se puede deducir se precarga; todo queda editable. Lo que no se precarga nunca: el escaneo del QR (es la prueba de que el rollo está en la mano) y el peso al recibir (el punto es pesarlo de nuevo).

- **Destino del despacho**, en este orden (`client/src/lib/rollTransferSuggest.ts`): la bodega del operario que escanea, si es un destino posible; si no, la única estación con OP derivada abierta esperando material de esa OP; con varias, la que coincide con "Material para"; sin ninguna, "Material para" si es destino posible o el único destino. Si hay duda (varias OP abiertas y "Material para" no coincide con ninguna), no se elige nada (decisión de Gestión). Los destinos con OP abierta se marcan "Tiene OP abierta esperándolo".
- **Modo**: "Me lo llevo yo" si el destino precargado es la bodega del operario que escanea; "Se lo entrego a alguien" en cualquier otro caso.
- **Transportista**: el último que registró esa cuenta en modo entrega.
- **Historial**: un operario lo ve filtrado de entrada a lo que llega a su bodega (Extrusión no recibe, ve todo).
- **Recepción**: el foco queda en el peso de la balanza (vacío).
- **Inventario de bodegas**: botón para escanear un rollo y ubicarlo (filtra a su bodega o dice que está en camino o que no está en ninguna); a Gestión le abre el conteo con el saldo y el motivo "Pesaje de inventario" ya puestos. Cada rollo muestra "Pendiente de despachar a…" si una OP derivada abierta lo espera en otra estación, y un despacho con 24 h o más sin recibirse se marca en rojo ("nadie confirmó que llegó").
- **Hoja de la OP derivada**: lista los rollos de la OP padre que ya están en la bodega de esa estación con su saldo, y los que vienen en camino, para que el operario sepa cuál buscar. Igual hay que escanear el que se monta.

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

- **Destino** (estantería o cliente): el `clientId` de la OP es explícito y editable mientras la OP siga `borrador` o abierta (`PATCH /:id`) — una OP sin cliente entra a inventario general ("a estantería"); una OP con cliente asignado, además de sumar a inventario, genera su despacho automáticamente al aprobarse (ver "Control de calidad" abajo). La producción de una OP con cliente se suma al stock del producto pero queda **reservada** para ese cliente mientras su despacho siga abierto (ver [Reservas para clientes](#reservas-para-clientes)).
- `POST /:id/reopen` reabre una OP cerrada por error (desde `finalizada`, `pendiente_calidad` o `detenida`) y la deja `en_proceso` otra vez, editable y lista para cargar o borrar rollos. Revierte cualquier efecto de inventario que ya se hubiera aplicado, para que ningún kilo quede "fantasma" en el stock:
  - si tenía un control de calidad **aprobado**, revierte la entrada de producto terminado y borra el control (al volver a cerrar, pasa por Calidad de nuevo);
  - si tenía un control **rechazado**, solo borra el control;
  - si es una OP de Extrusión, revierte la materia prima que se había descontado al cerrarla.
  - **No se puede reabrir** si Calidad ya generó un despacho para esa OP y ese despacho sigue vivo (no cancelado) — primero hay que cancelarlo (`POST /dispatches/:id/cancel`), para no descontar o duplicar el stock.
  - **Tampoco se puede** si al revertir la entrada de producto terminado, ese stock ya no está completo sin ubicar: si está ubicado en un estante, el error pide sacarlo de ahí en Almacén primero; si falta por otro motivo, avisa que probablemente se despachó por otro lado. Son dos causas distintas de la misma clase de error (`applyMovement`, `services/stockService.ts`), y cada una lleva su propia indicación.

### Inventario, almacén y avisos (revisión 2026-09-26)

- La entrada de producto terminado al aprobar Calidad (y su reversión al reabrir la OP) se registra con `referenceType: "production_order"` y `referenceId` = id de la OP — antes quedaba como "ajuste manual" sin forma de saber de qué OP salió. Movimientos muestra el origen de cada movimiento con link.
- Una salida de stock **sin ubicación** solo puede sacar lo que está sin ubicar (total menos lo asignado a estantes); si no alcanza, se rechaza pidiendo elegir el estante (`applyMovement`, `services/stockService.ts`). Vale para cualquier camino: despacho, reapertura de OP aprobada, anulación de despacho.
- Los errores de stock insuficiente nombran el producto o la materia prima (y la ubicación, si aplica).
- Avisos de **stock bajo el mínimo**: al cruzar el mínimo (no en cada salida posterior), a Almacén y Gestión para producto terminado (`stock_bajo_minimo`) y a Gestión/Planeación para materia prima (`materia_prima_bajo_minimo`). Se guardan dentro de la misma transacción del movimiento.
- Un aviso que falla **después** de guardar una operación ya no la convierte en error para el usuario (se registra en el log del servidor).
- Trazabilidad: `GET /api/production-orders/trace/by-code/:code` resuelve el QR de un rollo, una etiqueta de bulto o un número de OP a su OP/rollo, con la misma regla de visibilidad que `GET /:id` — un operario puro tampoco confirma por esta vía que una OP en `borrador` existe (`404`).

### Control de calidad

`POST /api/production-orders/:id/quality-check` decide el destino del lote:

- **Aprobado**: se genera la entrada de inventario (`applyMovement` con la suma de kg de los rollos) y la OP pasa a `finalizada`. Si la OP tiene **cliente asignado** (destino "a cliente", no "a estantería"), el sistema además crea un `Dispatch` automático en `pendiente` para ese cliente, con el producto y la cantidad ya cargados — Almacén solo confirma la salida física en vez de armar el despacho desde cero. El sistema notifica a `ROLES.ALMACEN` cuando esto pasa. Ese despacho es la reserva: mientras siga abierto, esos kilos no cuentan como disponibles para otro cliente (ver [Reservas para clientes](#reservas-para-clientes)).
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
