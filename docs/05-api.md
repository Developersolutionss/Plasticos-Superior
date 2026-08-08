# 05 — API

Base URL en desarrollo: `http://localhost:4000`. Los endpoints están bajo `/api/*`. El frontend los consume como `/api/*` a través del proxy de Vite. Ver [03 — Arquitectura](03-architecture.md).

## Autenticación

Todos los endpoints exigen el header:

```
Authorization: Bearer <token>
```

excepto:
- `POST /api/auth/login` (crea el token).
- `POST /api/auth/forgot-password` y `POST /api/auth/reset-password`.
- `GET /webhook/whatsapp` y `POST /webhook/whatsapp` (handshake de Meta).

Si el token falta o es inválido → `401 { "error": "..." }`.

### Obtener un token

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","password":"password123"}'
```

Respuesta (sin 2FA):

```json
{
  "token": "<jwt>",
  "user": { "id": 1, "name": "Admin", "role": "super_admin", "email": "admin@empresa.com", "twoFactorEnabled": false }
}
```

### Permisos por rol

Además de `requireAuth`, varias rutas exigen un rol concreto con `requireRole` (devuelve `403` si el rol no corresponde). Reglas generales:

- **CRM/comercial** (crear/editar clientes, contactos, direcciones, interacciones, cotizaciones, pedidos, facturas, pagos): rol de ventas (`super_admin`, `admin`, `ventas_pedidos`).
- **Despachos** (crear y marcar items): almacén (`super_admin`, `admin`, `almacen_despachos`).
- **Producción** (alta manual/Excel): almacén o gestión de producción.
- **Órdenes de producción** (crear, cambiar estado): gestión de producción (`gerente_produccion`, `planeacion`). Registrar etapa de estación: operarios o gestión (un operario solo en **su** estación).
- **Lecturas** (GET de todos los módulos): cualquier usuario autenticado.

`GET /api/auth/me` no exige rol, pero sí token. `super_admin` y `admin` pasan siempre.

## Formato de errores

| Código | Cuándo | Body |
|---|---|---|
| 400 | Body inválido (zod), parámetro de URL inválido o regla de negocio fallida | `{ "error": ..., "details": {...} }` o `{ "error": "mensaje" }` |
| 401 | Token no provisto, inválido o expirado | `{ "error": "..." }` |
| 403 | Rol sin permiso, o estación no asignada al rol de operario | `{ "error": "..." }` |
| 404 | Recurso no encontrado | `{ "error": "..." }` |
| 423 | Login: cuenta bloqueada o se bloquea por intentos fallidos | `{ "error": "..." }` |

## Referencia de endpoints

### Auth

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password, totpToken? }` | Valida credenciales. Respuesta `{ token, user }`. Si el usuario tiene 2FA y no manda `totpToken` → `200 { requires2fa: true }`. 5 fallos seguidos bloquean la cuenta 15 min (`423`) |
| GET | `/api/auth/me` | — | Datos del usuario actual desde el token |
| POST | `/api/auth/forgot-password` | `{ email }` | Crea un token de reseteo de 1 h y envía el link por email (o lo imprime en consola sin `RESEND_API_KEY`). Respuesta idéntica exista o no el correo |
| POST | `/api/auth/reset-password` | `{ token, newPassword }` | Valida el token hasheado, actualiza la contraseña y marca el token usado (transaccional, un solo uso) |
| POST | `/api/auth/2fa/setup` | — | Genera el secret TOTP y devuelve el QR (`qrCodeDataUrl`) sin activarlo aún. Devuelve `400` si el 2FA ya está activado (hay que pasar por `/2fa/disable` primero) |
| POST | `/api/auth/2fa/verify` | `{ token }` | Confirma un código TOTP de 6 dígitos y activa el 2FA |
| POST | `/api/auth/2fa/disable` | `{ token }` | Desactiva el 2FA (valida el código vigente) |

```bash
# login con 2FA (primero responde requires2fa → enviar totpToken)
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"despacho@empresa.com","password":"password123","totpToken":"123456"}'

# recuperación de contraseña
curl -X POST http://localhost:4000/api/auth/forgot-password \
  -H "Content-Type: application/json" -d '{"email":"despacho@empresa.com"}'
```

### Clientes (CRM)

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/clients` | — | Lista clientes activos, ordenados por nombre (incluye `avatarUrl`, `viewCount`, `lastViewedAt`) |
| POST | `/api/clients` | `{ name, contactInfo?, creditLimit? }` | Crea un cliente (rol de ventas) |
| PATCH | `/api/clients/:id` | `{ name?, contactInfo?, creditLimit? }` | Edita datos del cliente |
| POST | `/api/clients/:id/avatar` | multipart `avatar` (JPG/PNG/WEBP, ≤2 MB) | Sube o reemplaza la foto de perfil; setea `avatarUrl` |
| POST | `/api/clients/:id/visit` | — | Registra una visita a la ficha (`viewCount++`, `lastViewedAt`) |
| PATCH | `/api/clients/:id/credit-limit` | `{ creditLimit }` | Edita el límite de crédito manual |
| DELETE | `/api/clients/:id` | — | Desactiva el cliente (`active: false`, soft delete: conserva facturas/cotizaciones/pedidos y deja de aparecer en listas) |
| GET | `/api/clients/:id/cartera` | — | Saldo pendiente calculado (total facturado no anulado − pagos) + detalle de facturas pendientes |
| GET | `/api/clients/contacts` | — | **Lista global** de contactos con la empresa relacionada (nombre y `avatarUrl`) — pantalla CRM "Contactos" |
| GET | `/api/clients/:id/contacts` | — | Contactos del cliente (principal primero) |
| POST | `/api/clients/:id/contacts` | `{ name, position?, phone?, email?, isPrimary? }` | Crea un contacto. Si `isPrimary: true`, desmarca los demás en una transacción |
| PATCH | `/api/clients/:id/contacts/:contactId` | `{ name, position?, phone?, email?, isPrimary? }` | Edita un contacto (misma validación que el alta). Si `isPrimary=true`, desmarca los demás en una transacción |
| DELETE | `/api/clients/:id/contacts/:contactId` | — | Borra un contacto; si era principal, asigna el más reciente restante |
| GET | `/api/clients/:id/addresses` | — | Lista direcciones del cliente |
| POST | `/api/clients/:id/addresses` | `{ label, addressLine, city?, region?, postalCode?, isPrimary?, notes? }` | Crea una dirección (principal exclusivo por transacción) |
| DELETE | `/api/clients/:id/addresses/:addressId` | — | Borra una dirección |
| GET | `/api/clients/:id/interactions` | — | Historial de interacciones |
| POST | `/api/clients/:id/interactions` | `{ type, description }` | Registra una interacción (`llamada` / `email` / `reunion` / `nota`) |

```bash
curl http://localhost:4000/api/clients -H "Authorization: Bearer <token>"
curl http://localhost:4000/api/clients/1/cartera -H "Authorization: Bearer <token>"

curl -X POST http://localhost:4000/api/clients/1/contacts \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"María","position":"Compras","phone":"3001234","email":"maria@acme.com","isPrimary":true}'
```

Reglas de validación: en los endpoints de **contactos**, el `:id` debe ser numérico (`>0`); si no → `400`, y el recurso debe existir → `404`. Los endpoints de direcciones, interacciones, cartera y límite de crédito no replican esa validación de `:id`. El email del contacto se valida con zod.

### Inventario

| Método | Ruta | Query/Param | Descripción |
|---|---|---|---|
| GET | `/api/inventory` | `?category=rollos_fuelle` (opcional) | Stock de todos los productos (o filtrado por categoría). Incluye `currentStock`, `minStock`, `belowMinimum` |
| GET | `/api/inventory/alerts` | — | Solo productos bajo el stock mínimo |
| GET | `/api/inventory/products` | — | Catálogo de productos |

### Producción

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| POST | `/api/production/entries` | `{ sku, labelCode?, operatorName, clientName?, measure?, kilos, driverName?, observations? }` | Alta manual (almacén o gestión de producción). Crea la entrada + movimiento de entrada en una transacción |
| POST | `/api/production/import/preview` | `multipart/form-data`: campo `file` (xlsx/xls/csv, máx 10 MB) | Parsea y devuelve preview (filas válidas/inválidas) sin persistir. Exige almacén o gestión de producción (igual que `entries` e `import/confirm`) |
| POST | `/api/production/import/confirm` | `{ filename, rows: [...] }` | Persiste solo las filas válidas. Registra en `import_logs`. Devuelve `{ processed, failed, errors }` |

**Formato esperado del Excel/CSV** (columnas): `SKU | Etiqueta | Operario | Cliente | Medida | Kilos | Conductor | Observaciones`.

```bash
curl -X POST http://localhost:4000/api/production/import/preview \
  -H "Authorization: Bearer <token>" -F "file=@/ruta/reporte.csv"
```

### Órdenes de producción (OP)

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/production-orders` | `?status=` (opcional) | Lista OPs con producto y etapas, por fecha desc |
| POST | `/api/production-orders` | `{ productId, quantityPlanned, measure?, notes? }` | Crea una OP con numeración `OP-00001` (gestión de producción) |
| PATCH | `/api/production-orders/:id/status` | `{ status }` | Cambia el estado (`pendiente` / `en_proceso` / `detenida` / `finalizada` / `cancelada`) |
| GET | `/api/production-orders/:id/stages` | — | Etapas registradas de la OP |
| POST | `/api/production-orders/:id/stages` | `{ station, machine, operatorName, startTime, endTime?, kilosProduced, mermaKg?, downtimeMinutes?, downtimeReason?, details?, notes? }` | Registra el paso por estación. Un operario solo puede usar **su** estación (`OPERARIO_STATIONS`). Si la estación es `precorte`, genera la entrada de inventario y finaliza la OP |

```bash
curl -X POST http://localhost:4000/api/production-orders/1/stages \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"station":"impresion","machine":"IMP-02","operatorName":"Juan","startTime":"2026-08-01T08:00:00Z","kilosProduced":120}'
```

### Despachos

| Método | Ruta | Cuerpo/Query | Descripción |
|---|---|---|---|
| GET | `/api/dispatches` | `?clientId=1&status=pendiente` | Lista despachos (cliente + items con producto), por fecha desc |
| POST | `/api/dispatches` | `{ clientId, items: [{ productId, quantityRequested, labelCode?, notes? }] }` | Crea un despacho con sus items (almacén) |
| PATCH | `/api/dispatches/:dispatchId/items/:itemId` | `{ quantityDispatched }` | Marca un item despachado (almacén). Descuenta stock y actualiza el estado del despacho en una transacción |

```bash
curl -X PATCH http://localhost:4000/api/dispatches/1/items/2 \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"quantityDispatched":25}'
```

### Cotizaciones

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/cotizaciones` | `?clientId=` (opcional) | Lista con cliente e items |
| POST | `/api/cotizaciones` | `{ clientId, validUntil?, notes?, items: [{ productId, quantity, unitPrice?, measure? }] }` | Crea cotización (`COT-00001`). Si un ítem no trae precio, toma el del catálogo |
| PATCH | `/api/cotizaciones/:id/status` | `{ status }` | Cambia estado (`borrador` / `enviada` / `aceptada` / `rechazada` / `expirada`) |
| POST | `/api/cotizaciones/:id/convertir-a-pedido` | — | Copia los ítems a un Pedido nuevo (v1). La cotización queda enlazada, sin borrar |

### Pedidos

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/pedidos` | `?clientId=&status=` | Lista con la última versión vigente |
| POST | `/api/pedidos` | `{ clientId, notes?, items: [{ productId, quantity, unitPrice?, measure? }] }` | Crea pedido + versión 1 (`PED-00001`) |
| GET | `/api/pedidos/:id/versions` | — | Todas las versiones del pedido (historial completo) |
| PATCH | `/api/pedidos/:id` | `{ status, notes?, items }` | **Crea una versión nueva completa** (v+1) en vez de sobrescribir. Actualiza `currentVersion` |
| POST | `/api/pedidos/:id/duplicar` | — | Crea un pedido nuevo copiando los ítems de la última versión |
| GET | `/api/pedidos/:id/attachments` | — | Lista adjuntos |
| POST | `/api/pedidos/:id/attachments` | `multipart/form-data`: campo `file` | Sube un adjunto (disco `server/uploads/pedidos/`, máx 20 MB) |
| GET | `/api/pedidos/:id/attachments/:attachmentId/download` | — | Descarga el archivo con su nombre original |

### Facturas y pagos

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| GET | `/api/facturas` | `?clientId=&status=` | Lista con cliente, ítems y pagos |
| POST | `/api/facturas` | `{ clientId, notes?, items }` | Crea factura suelta (`FAC-00001`) |
| POST | `/api/facturas/desde-pedido/:pedidoId` | — | Factura desde la **última versión** del pedido (copia sus ítems) |
| PATCH | `/api/facturas/:id/anular` | — | Marca la factura `anulada` (acción manual) |
| GET | `/api/facturas/:id/payments` | — | Lista abonos |
| POST | `/api/facturas/:id/payments` | `{ amount, method, paidAt?, notes? }` | Registra un abono. La factura recalcula sola su estado (`emitida` / `pagada_parcial` / `pagada`) |

```bash
curl -X POST http://localhost:4000/api/facturas/1/payments \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"amount":50000,"method":"transferencia"}'
```

### WhatsApp Business API (fase 2)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/webhook/whatsapp` | Handshake de verificación de Meta (`hub.mode`, `hub.verify_token`, `hub.challenge`) |
| POST | `/webhook/whatsapp` | Recibe eventos. Si llega un documento, lo descarga vía Graph API, lo parsea con `parseProductionFile` y lo registra en `import_logs` (`source = whatsapp_bot`). No crea entradas aún |

Configuración pendiente (documentada en `server/src/routes/whatsappWebhook.ts`):

1. Cuenta de WhatsApp Business API aprobada en Meta for Developers.
2. Webhook URL a `https://<tu-dominio>/webhook/whatsapp`.
3. `WHATSAPP_VERIFY_TOKEN` como Verify Token en Meta.
4. Suscríbase al campo `messages`.
5. Complete `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` en `server/.env`.

## Respuestas de ejemplo

### `GET /api/inventory`

```json
[
  {
    "id": 1,
    "sku": "BUL-001",
    "name": "Bulto 25kg Tipo A",
    "category": "bultos",
    "measure": "25kg",
    "unit": "unidad",
    "minStock": 50,
    "currentStock": 120,
    "belowMinimum": false
  }
]
```

### `GET /api/dispatches`

```json
[
  {
    "id": 1,
    "clientId": 1,
    "client": { "id": 1, "name": "Cliente ACME", "active": true },
    "status": "en_proceso",
    "requestedDate": "2026-07-31T00:00:00.000Z",
    "dispatchedDate": null,
    "items": [
      { "id": 2, "productId": 1, "product": { "id": 1, "sku": "BUL-001", "name": "Bulto 25kg Tipo A" }, "quantityRequested": "25", "quantityDispatched": null }
    ]
  }
]
```

> El shape completo depende del `include` de cada ruta. Los decimales de Prisma se serializan como string (p. ej. en `/api/dispatches`). `stockService` los convierte a `Number()` en `/api/inventory`.

## Convenciones de implementación

- Validación con **zod** (`safeParse`). Si falla → `400` con `parsed.error.flatten()`.
- Errores de negocio → `400` con `{ error: message }` (p. ej. SKU inexistente en producción).
- Recurso no encontrado → `404`; sin permiso de rol → `403`.
- Las mutaciones multi-tabla usan `prisma.$transaction(...)`. Ver [06 — Backend](06-backend.md) y [08 — Reglas de negocio](08-workflow.md).