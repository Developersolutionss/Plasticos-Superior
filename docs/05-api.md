# 05 — API

Base URL en desarrollo: `http://localhost:4000`. Los endpoints están bajo `/api/*`. El frontend los consume como `/api/*` a través del proxy de Vite. Ver [03 — Arquitectura](03-architecture.md).

## Autenticación

Todos los endpoints exigen el header:

```
Authorization: Bearer <token>
```

excepto:
- `POST /api/auth/login` (crea el token).
- `GET /webhook/whatsapp` y `POST /webhook/whatsapp` (handshake de Meta).

Si el token falta o es inválido → `401 { "error": "..." }`.

### Obtener un token

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","password":"password123"}'
```

Respuesta:

```json
{
  "token": "<jwt>",
  "user": { "id": 1, "name": "Admin", "role": "admin", "email": "admin@empresa.com" }
}
```

## Formato de errores

| Código | Cuándo | Body |
|---|---|---|
| 400 | Body inválido (zod), parámetro de URL inválido o regla de negocio fallida | `{ "error": ..., "details": {...} }` o `{ "error": "mensaje" }` |
| 401 | Token no provisto, inválido o expirado | `{ "error": "..." }` |
| 404 | Recurso no encontrado | `{ "error": "..." }` |

## Referencia de endpoints

### Auth

| Método | Ruta | Body | Descripción |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | Valida las credenciales. Devuelve `{ token, user }` |

### Clientes

| Método | Ruta | Body | Descripción |
|---|---|---|---|
| GET | `/api/clients` | — | Lista clientes activos, ordenados por nombre |
| POST | `/api/clients` | `{ name, contactInfo? }` | Crea un cliente |

```bash
curl http://localhost:4000/api/clients -H "Authorization: Bearer <token>"

curl -X POST http://localhost:4000/api/clients \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"Nuevo Cliente"}'
```

### Contactos de cliente

| Método | Ruta | Body | Descripción |
|---|---|---|---|
| GET | `/api/clients/:id/contacts` | — | Lista los contactos del cliente, ordenados por principal primero y luego por nombre. `404` si el cliente no existe. `[]` si no tiene contactos |
| POST | `/api/clients/:id/contacts` | `{ name, position?, phone?, email?, isPrimary? }` | Crea un contacto. Si `isPrimary: true`, desmarca los demás del cliente dentro de una transacción. `400` si el body es inválido (email no válido) |
| DELETE | `/api/clients/:id/contacts/:contactId` | — | Borra un contacto. Si era el principal, asigna el más reciente restante dentro de una transacción. `404` si no existe |

Reglas:
- Valide el `id` de la URL: si no es un número → `400`.
- `404` si el cliente no existe (GET/POST) o si el contacto no pertenece al cliente de la URL (DELETE).

```bash
curl http://localhost:4000/api/clients/1/contacts -H "Authorization: Bearer <token>"

curl -X POST http://localhost:4000/api/clients/1/contacts \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"María","position":"Compras","phone":"3001234","email":"maria@acme.com","isPrimary":true}'

curl -X DELETE http://localhost:4000/api/clients/1/contacts/5 -H "Authorization: Bearer <token>"
```

### Inventario

| Método | Ruta | Query/Param | Descripción |
|---|---|---|---|
| GET | `/api/inventory` | `?category=rollos_fuelle` (opcional) | Stock de todos los productos (o filtrado por categoría). Incluye `currentStock`, `minStock`, `belowMinimum` |
| GET | `/api/inventory/alerts` | — | Solo productos bajo el stock mínimo |
| GET | `/api/inventory/products` | — | Catálogo de productos (de la tabla `products`) |

```bash
curl "http://localhost:4000/api/inventory" -H "Authorization: Bearer <token>"
curl "http://localhost:4000/api/inventory/alerts" -H "Authorization: Bearer <token>"
curl "http://localhost:4000/api/inventory/products" -H "Authorization: Bearer <token>"
```

### Producción

| Método | Ruta | Body | Descripción |
|---|---|---|---|
| POST | `/api/production/entries` | `{ sku, labelCode?, operatorName, clientName?, measure?, kilos, driverName?, observations? }` | Alta manual de una entrada de producción. Crea la entrada y el movimiento de entrada de stock en una transacción |
| POST | `/api/production/import/preview` | `multipart/form-data`: campo `file` (xlsx/xls/csv) | Parsea el archivo. Devuelve el preview (filas válidas/ inválidas) sin persistir |
| POST | `/api/production/import/confirm` | `{ filename, rows: [...] }` | Persiste solo las filas válidas del preview. Registra en `import_logs`. Devuelve `{ processed, failed, errors }` |

**Formato esperado del Excel/CSV** (columnas): `SKU | Etiqueta | Operario | Cliente | Medida | Kilos | Conductor | Observaciones`.

```bash
curl -X POST http://localhost:4000/api/production/import/preview \
  -H "Authorization: Bearer <token>" \
  -F "file=@/ruta/reporte.csv"

curl -X POST http://localhost:4000/api/production/import/confirm \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"filename":"reporte.csv","rows":[{"sku":"BUL-001","operatorName":"Juan","kilos":120}]}'
```

### Despachos

| Método | Ruta | Body/Query | Descripción |
|---|---|---|---|
| GET | `/api/dispatches` | `?clientId=1&status=pendiente` (opcionales) | Lista despachos con cliente e items (incluye producto). Ordenados por fecha de solicitud desc |
| POST | `/api/dispatches` | `{ clientId, items: [{ productId, quantityRequested, labelCode?, notes? }] }` | Crea un despacho con sus items |
| PATCH | `/api/dispatches/:dispatchId/items/:itemId` | `{ quantityDispatched }` | Marca un item como despachado. Descuenta stock. Actualiza el estado del despacho en una transacción |

```bash
curl "http://localhost:4000/api/dispatches?status=pendiente" -H "Authorization: Bearer <token>"

curl -X POST http://localhost:4000/api/dispatches \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"clientId":1,"items":[{"productId":1,"quantityRequested":25}]}'

curl -X PATCH http://localhost:4000/api/dispatches/1/items/2 \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"quantityDispatched":25}'
```

### WhatsApp Business API (fase 2)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/webhook/whatsapp` | Handshake de verificación de Meta (`hub.mode`, `hub.verify_token`, `hub.challenge`) |
| POST | `/webhook/whatsapp` | Recibe eventos. Si es un documento, lo descarga vía Graph API. Lo parsea con `parseProductionFile`. Lo registra en `import_logs` con `source = "whatsapp_bot"` |

Configuración pendiente (documentada en `server/src/routes/whatsappWebhook.ts`):
1. Cuenta de WhatsApp Business API aprobada en Meta for Developers.
2. Configure la Webhook URL a `https://<tu-dominio>/webhook/whatsapp`.
3. `WHATSAPP_VERIFY_TOKEN` como Verify Token en el panel de Meta.
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
    "client": { "id": 1, "name": "Cliente ACME", "contactInfo": null, "active": true, "createdAt": "2026-07-31T00:00:00.000Z" },
    "status": "en_proceso",
    "requestedDate": "2026-07-31T00:00:00.000Z",
    "dispatchedDate": null,
    "createdById": 1,
    "createdAt": "2026-07-31T00:00:00.000Z",
    "items": [
      {
        "id": 2,
        "dispatchId": 1,
        "productId": 1,
        "product": { "id": 1, "sku": "BUL-001", "name": "Bulto 25kg Tipo A", "category": "bultos", "measure": "25kg", "unit": "unidad", "minStock": "50", "createdAt": "2026-07-31T00:00:00.000Z" },
        "quantityRequested": "25",
        "quantityDispatched": "25",
        "labelCode": null,
        "notes": null
      }
    ]
  }
]
```

> El shape completo depende del `include` de la ruta (`client`, `items.product`). Los valores numéricos se serializan como string en `/api/dispatches` (decimales crudos de Prisma). En `/api/inventory`, `stockService` los convierte a número (`Number()`).

## Convenciones de implementación

- Validación con **zod**: cada handler usa un schema y `safeParse`. Si falla → `400` con `parsed.error.flatten()`.
- Errores de negocio → `400` con `{ error: message }` (p. ej. SKU inexistente en producción).
- Recurso no encontrado → `404`.
- Mutaciones que tocan varias tablas usan `prisma.$transaction(...)` para mantener consistencia (ver [06 — Backend](06-backend.md) y [08 — Reglas de negocio](08-workflow.md)).
