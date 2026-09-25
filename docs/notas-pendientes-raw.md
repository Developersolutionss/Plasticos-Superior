# Notas pendientes (texto original sin editar)

Este archivo guarda tal cual las notas que llegaron para el backlog, antes de traducirlas a una
descripción técnica. Sirve de referencia cuando la interpretación en [00 — Hoja de ruta](00-roadmap.md)
o en otro documento no alcance a cubrir el detalle original, o quede ambigua.

## Recibidas 2026-09-22

Mejoras de UI sobre `OrdenProduccionDetalle.tsx` (ver [07 — Frontend](07-frontend.md)) — **hechas**:

- "aumentar visualizacion de Registro de rollos / avance en movil" → tarjetas de celular con ícono de candado en los campos automáticos vs. input real en los editables.
- "añadir una forma de corregir errores en Registro de rollos / avance" → carga en lote: "+ Añadir rollo" deja cada fila editable/borrable en una lista "por confirmar" hasta que se manda todo el lote con "Confirmar N rollos".

Funcionalidad todavía no implementada (backlog, ver [00 — Hoja de ruta](00-roadmap.md)):

- "3 bodegas (sellado, pre-corte, impresion), debe haber un registro de que operario y camionero
  lo recibe y registra" → **hecho**: Despacho a bodegas (`DespachoBodegas.tsx`, `/api/roll-transfers`).
- "flujo automatico por medio de qr a hora de transportar QRs" → **hecho**: se usa el mismo QR del rollo
  (código + token) para la salida y para la recepción.
- "vista de visualizacion de informacion de cualquier rollo, para mejor trasabilidad"
- "Implementar los rollos hijos de los rollos madres"

## Recibidas 2026-09-24

Seguridad de la trazabilidad: código secuencial vs. validación de posesión física del rollo
(backlog, ver [00 — Hoja de ruta](00-roadmap.md)):

> No termina de convencer el sistema secuencial de registro y trazabilidad (ej. `EXT-9`): con la
> información necesaria, cualquiera podría estimar cuáles son los próximos códigos disponibles y
> registrarlos — por ejemplo, para inflar artificialmente métricas de eficiencia, entregas o
> disponibilidad. El cliente prefiere mantener los códigos secuenciales porque le resultan más
> simples de leer y manejar que un string aleatorio.
>
> Propuesta: conservar el código secuencial como identificador legible para las personas, pero
> agregar en el QR un segundo código — el "token" — que no se pueda inferir a partir de la
> secuencia, y que sirva para verificar que quien opera sobre el rollo tiene el producto físico en
> mano (transporte, tratado, transformación). El token debe seguir siendo legible y tipeable a mano
> por una persona, aunque no tan simple como el secuencial.

Requisito derivado (versión ya redactada como pedido técnico, incluida acá tal cual llegó):

Cada rollo tendría dos identificadores en su QR: el código secuencial visible de hoy (`EXT-9`,
legible y fácil de comunicar) y un código de validación no predecible (el "token"), generado con un
mecanismo criptográficamente seguro y validado en el servidor. El token demuestra posesión física
del rollo — conocer o adivinar el siguiente código secuencial (ej. `EXT-10`) no alcanzaría para
registrar, transportar o transformar ese rollo sin también tener su token.

Falta definir: qué operaciones exigen el token (todas las de trazabilidad, o solo algunas), y qué
debe pasar si el token es inválido, ya fue usado, o pertenece a un rollo ya procesado. Criterio de
aceptación: dado un código secuencial válido pero sin el token correspondiente, el sistema no debe
permitir registrar ni ejecutar sobre ese rollo ninguna operación que requiera demostrar posesión
física.

**Propuesta concreta acordada** (formato de código, generación, verificación y alcance):

Formato visible por rollo: `EXT-9-K7M9XT4P2R6HW3JC` — el código secuencial de siempre (`EXT-9`, sin
padding, igual que hoy) seguido de un `token_visible` de 16 caracteres en alfabeto Crockford
Base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, sin `0/O` ni `1/I/L` para no confundirse al tipear a
mano), dando ~80 bits de entropía. No se usa cero-padding en la parte secuencial para no repetir la
ambigüedad de forma que ya causó el bug de `ba5489a` (etiquetas de bulto `EXT-000NN` vs. rollos
`EXT-N`).

Generación (servidor, al crear el rollo):

```
random        = 80 bits criptográficamente aleatorios (crypto.randomBytes)
token_visible = encode_crockford32(random)                      // se imprime en el QR/etiqueta
token_hash    = HMAC-SHA256(SERVER_SECRET, sequential_code + ":" + token_visible)
```

Se guarda en la base **solo** `token_hash` (columna nueva en `ProductionRoll`, ej.
`possessionTokenHash`). El `random`/`token_visible` no se persiste en ningún lado más que la
etiqueta física impresa — así una fuga de la base no alcanza para fabricar un QR válido (mismo
principio que guardar un hash de contraseña en vez de la contraseña).

Verificación (al escanear, solo para operaciones que exigen posesión física):

```
roll      = buscar por sequential_code
esperado  = HMAC-SHA256(SERVER_SECRET, sequential_code + ":" + token_visible_escaneado)
ok        = crypto.timingSafeEqual(esperado, roll.possessionTokenHash)
```

Alcance — no todo exige el token:

- **Solo lectura** (buscar por código, listar, Trazabilidad): sigue funcionando con el código
  secuencial solo, sin cambios.
- **Exige token**: escanear un rollo madre para consumirlo (`applyScannedSourceRoll` /
  `allocateFromSourceRolls` en el flujo de `OrdenProduccionDetalle.tsx`) — ahí se escanea el QR
  completo (código + token), no solo el código.

Pendiente de implementar además:

- Límite de intentos fallidos por IP/usuario en el endpoint que valida el token (defensa adicional
  a los 80 bits).
- Endpoint de reemisión (solo Gestión/Calidad) para etiquetas dañadas o perdidas: genera un
  `random`/`token_hash` nuevo e invalida el anterior.
- Rotación de `SERVER_SECRET` queda como limitación conocida por ahora (rotarlo invalida todo lo ya
  impreso); si hace falta a futuro, versionar el secreto (`possessionTokenVersion` por rollo) con
  una ventana de transición que acepte el secreto viejo y el nuevo.