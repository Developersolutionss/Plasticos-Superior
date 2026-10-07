# Notas pendientes (texto original sin editar)

Este archivo guarda las notas del backlog que siguen abiertas, con el texto original o muy cercano a él.
Sirve de referencia cuando la interpretación en [00 — Hoja de ruta](00-roadmap.md) o en otro documento
no alcance a cubrir el detalle, o quede ambigua. Lo que ya se hizo se quita de aquí y queda descrito en
[06 — Backend](06-backend.md), [07 — Frontend](07-frontend.md) y [08 — Reglas de negocio](08-workflow.md).

## Rollos hijos de un rollo madre (2026-09-22)

Nota original: "Implementar los rollos hijos de los rollos madres". El sistema ya guarda de qué rollo madre salió
cada rollo chico. Falta la vista inversa: dado un rollo madre, listar todos sus rollos hijos (ver el Backlog de
[00 — Hoja de ruta](00-roadmap.md)).

## Reunión con el cliente 2026-10-06

Requisitos nuevos de inventario, despachos y traslados. Orden de prioridad que se acordó: primero
inventario y despachos ("lo más grave"), después la devolución a la bodega principal.

**El proceso real, como lo explicó el cliente:**

1. Extrusión saca 3 o 4 rollos grandes (rollos madre, unos 200 kg).
2. Un camión los lleva de la bodega principal a la bodega de Sellado, Precorte o Impresión. Una persona
   los envía y otra los recibe.
3. En esa bodega se cortan en rollos chicos. Los rollos chicos se registran en el inventario en cuanto salen.
4. Otro camión devuelve los rollos chicos a la bodega principal, con su envío y su recepción.
5. El despacho al cliente sale siempre de la bodega principal.
6. El orden no es fijo: un rollo sellado puede pasar a Impresión, y un rollo chico puede volver a ser rollo
   madre. No se debe suponer una cadena fija.

**Por qué importa:** la mercancía se pierde en el trayecto entre bodegas. Si un rollo no aparece en la
bodega principal, debe estar en la otra. Si no está en ninguna, el registro dice qué usuario lo llevó.
No se pide seguimiento en tiempo real ni detalle de las subbodegas: basta con saber cuánto hay en cada una.

**1. Devolver rollos a la bodega principal.**

- Hoy el despacho a bodegas solo va de Extrusión o Impresión hacia otra estación. Falta el regreso a la
  bodega principal, con quién lo lleva y quién lo recibe.
- Decisión: es una opción explícita ("despachar a inventario principal"). No se deduce del número de
  escaneos del QR (un escaneo repetido por error no debe contar como un movimiento).
- Mientras el rollo esté fuera, debe poder verse dónde está y quién lo tiene.

**2. Distinguir rollos de stock y rollos de cliente.**

- Una OP hecha para un cliente (por ejemplo 1000 kg) no debe cargar su producción como stock general. Si lo
  hace, alguien ve "900 kg, sobra" y los despacha, y el cliente se queda sin su pedido.
- Idea propuesta: tratar el stock como un cliente más. El cliente quiere además una sección aparte de
  "Rollos para clientes" en Inventario, separada de las existencias genéricas.
- Una OP de stock se puede planificar por una cantidad y abrir directo.
- Al escanear un rollo de cliente la app debe decir para quién es, no debe poder ponerse a la venta y, al
  despacharlo, debe salir hacia ese cliente de forma automática.
- La OP ya guarda el cliente destino. Falta que el inventario lo muestre y lo respete.

**3. Rediseñar Despachos.**

- Hoy se escribe cliente, producto y cantidad, y la cantidad hay que repetirla aunque ya se planificó.
- Se pidió: elegir el cliente y ver sus rollos más los de stock; que la cantidad se llene sola con lo
  planificado; poder despachar menos (al cliente llegan rollos chicos, no un rollo de 1000 kg); marcar como
  despachado; y que todo quede en Trazabilidad.
- Si el cliente cancela un pedido, sus rollos deben poder pasar a stock y de ahí asignarse a otro cliente.

**Por investigar (el cliente lo vio en la demostración, no está claro si es un error):**

- Tras cerrar una OP de 1000 kg el stock quedó en 0. Hoy el stock entra cuando Calidad aprueba, así que
  puede ser el diseño actual. El cliente pide que todo lo que sale de una OP vaya al inventario, incluidos
  los rollos de Extrusión, y hoy Extrusión cierra sin mover stock. Hay que confirmar con el cliente.
- Rollos que el cliente tipeó desde cero no llegaron al inventario.
- Varios rollos hijos descontaron de "Extrusión 5", pero el inventario de bodegas parece tomar solo el
  último. Revisar el saldo del rollo madre.
- El inventario de bodegas mostraba 11 rollos en Precorte y no quedó claro a qué corresponde.

## Revisión de Trazabilidad / Inventario / Almacén / Exportaciones / Avisos (2026-09-26)

Pendiente a propósito (Gestión, 2026-09-26: "dejalo como está por ahora"):

- **Unidades en la entrada de Calidad.** Al aprobar una OP, Calidad suma al inventario los **kilos** de sus
  rollos aunque el producto se maneje por **unidad** (ej. "Bulto 25kg Tipo A", "Control Impresión Etiqueta A"),
  y el despacho automático al cliente pide esos kilos. Hoy no pasó con datos reales. Si resulta que esos
  productos sí se fabrican por OP, hay que decidir cómo convertir (kilos ÷ peso por unidad del producto, o que
  la OP registre unidades) — el punto a tocar es `POST /production-orders/:id/quality-check` (y su reversión en
  `POST /:id/reopen`), en `server/src/routes/productionOrders.ts`.

Decisión abierta del bloque de kilos (2026-09-29):

- Derivar a varias estaciones: la primera hija toma todo lo disponible y la segunda se rechaza hasta que
  Gestión baje la meta de la primera. Propuesta: que "Derivar a…" pregunte los kilos al derivar.

Pendientes del QA previo al despliegue (2026-10-02), no bloqueantes:

- "Aplicar sugerencia" de materia prima toma el % más frecuente de cada insumo por separado, así que la
  fórmula sugerida puede no sumar 100% (la OP no se libera hasta corregirla; el aviso es claro). Mejor:
  sugerir la fórmula completa de la OP más frecuente. Los presets manuales tampoco validan el 100%.
- Un conteo físico del rollo madre es un ajuste (delta), no un ancla: si después se borra una fila hija que
  había consumido de ese madre, el saldo sube por encima de lo contado. Decidir si se bloquea borrar filas
  hijas anteriores a un conteo.
- `GET /roll-transfers/inventory` trae todos los rollos de Extrusión/Impresión (agotados incluidos) y filtra
  en memoria: con miles de rollos conviene filtrar por saldo en SQL o paginar.
- El upsert de presets no limpia measure/quantityPlanned cuando llegan vacíos.

Quedaron fuera de esa ronda (no se decidió todavía):

- Ajuste manual de stock de producto terminado tras un conteo físico (la materia prima sí lo tiene).
- Exportaciones del área de producción (OPs, rollos, movimientos, materia prima, despachos a bodegas) y
  filtro por fecha en las existentes. Hoy se exporta inventario, pedidos, facturas y clientes.
- Preferencias y vencimiento de avisos (hoy le llegan a todos los usuarios del rol y no vencen), y avisos
  de OPs estancadas o rollos en tránsito hace mucho.
- Datos del catálogo contradictorios (ej. producto con "ALTA DENSIDAD" en el nombre y densidad BAJA).

## Token de posesión del rollo (2026-09-24)

El token (formato, generación, verificación, reemisión y límite de 50 escaneos por minuto por usuario)
está hecho y descrito en [06 — Backend](06-backend.md). Queda pendiente:

- Límite de intentos fallidos **por IP** en el endpoint que valida el token, como defensa adicional a
  los 80 bits. Hoy el límite es por usuario y es un freno de rendimiento, no un control de seguridad.
- Rotación de `ROLL_TOKEN_SECRET`: queda como limitación conocida (rotarlo invalida todo lo ya impreso).
  Si hace falta, versionar el secreto (`possessionTokenVersion` por rollo) con una ventana de transición
  que acepte el secreto viejo y el nuevo.
