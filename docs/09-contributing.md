# 09 — Guía de contribución

Esta guía describe cómo agregar una funcionalidad nueva al sistema. Sirve para cualquier módulo: una tabla nueva, un endpoint nuevo o una página nueva. Siga los pasos en orden. Respete las convenciones del proyecto.

Antes de comenzar, revise la arquitectura en [03 — Arquitectura y comunicación](03-architecture.md) y la estructura de carpetas en [06 — Backend](06-backend.md) y [07 — Frontend](07-frontend.md).

## Vista general del proceso

1. Defina el modelo de datos en Prisma.
2. Genere la migración.
3. Cree el router en el backend.
4. Monte el router en `index.ts`.
5. Agregue el método al helper `api` del frontend.
6. Cree la página y la ruta.
7. Verifique el cambio.
8. Actualice esta documentación.

## Paso 1: Defina el modelo en Prisma

Edite `server/prisma/schema.prisma`. Siga estas convenciones:

| Convención | Ejemplo |
|---|---|
| Nombre del modelo en singular | `model ClientContact` |
| Tabla en snake_case plural | `@@map("client_contacts")` |
| Columnas en snake_case | `@map("client_id")`, `@map("created_at")`, `@map("is_primary")` |
| Llave primaria | `id Int @id @default(autoincrement())` |
| Timestamp de creación | `createdAt DateTime @default(now()) @map("created_at")` |
| Relaciones en ambos lados | `contacts ClientContact[]` en `Client` y `client Client @relation(...)` en `ClientContact` |
| FKs en `modelo_id` | `clientId Int @map("client_id")` |
| Cantidades como Decimal | `@db.Decimal(12, 2)` |
| Estados como enum | declarar el enum a nivel superior del schema, junto a los demás enums |

Ejemplo del modelo `ClientContact` (implementado en el proyecto):

```prisma
model ClientContact {
  id        Int      @id @default(autoincrement())
  clientId  Int      @map("client_id")
  client    Client   @relation(fields: [clientId], references: [id])
  name      String
  position  String?
  phone     String?
  email     String?
  isPrimary Boolean  @default(false) @map("is_primary")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("client_contacts")
}
```

Agregue la relación en el modelo padre:

```prisma
model Client {
  // campos existentes...
  contacts ClientContact[]
}
```

## Paso 2: Genere la migración

Ejecute desde la raíz:

```bash
npm run prisma:migrate
```

Prisma crea una carpeta nueva en `server/prisma/migrations/` y regenera el Client. Si el schema tiene errores, la migración falla antes de tocar la base de datos.

## Paso 3: Cree el router en el backend

Use el patrón router → zod → prisma. Todos los routers del proyecto siguen este molde. Los endpoints de contactos viven dentro de `server/src/routes/clients.ts` con rutas anidadas (`/:id/contacts`):

```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

const createContactSchema = z.object({
  name: z.string().min(1),
  position: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  isPrimary: z.boolean().optional().default(false),
});

// GET /api/clients/:id/contacts
clientsRouter.get("/:id/contacts", async (req, res) => {
  const clientId = Number(req.params.id);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: "ID de cliente inválido" });
  }
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });
  const contacts = await prisma.clientContact.findMany({ where: { clientId } });
  res.json(contacts);
});

// POST /api/clients/:id/contacts
clientsRouter.post("/:id/contacts", async (req, res) => {
  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const clientId = Number(req.params.id);
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const contact = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary) {
      await tx.clientContact.updateMany({
        where: { clientId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return tx.clientContact.create({ data: { clientId, ...parsed.data } });
  });

  res.status(201).json(contact);
});
```

Reglas:

- Use `requireAuth` con `router.use(requireAuth)` para proteger todo el archivo. El login y el webhook de WhatsApp son las únicas excepciones.
- Para rutas restringidas, aplique un middleware de rol: `const requireVentas = requireRole(...ROLES.VENTAS)` y póngalo entre el path y el handler. Use los grupos de `ROLES` (VENTAS, ALMACEN, PRODUCCION_GESTION, OPERARIOS). Devuelve `403` si el rol no corresponde. Ver [06 — Backend](06-backend.md).
- Valide el body con un schema zod y `safeParse`. Si falla → `400`.
- Valide los parámetros de la URL con `Number.isInteger`. Si no son números → `400`.
- Verifique que el recurso padre exista. Si no → `404`. En el DELETE, filtre el contacto por `{ id, clientId }` para no borrar contactos de otros clientes.
- Si una mutación toca varias tablas, envuélvala en `prisma.$transaction(...)`. Ver la lógica de stock en [06 — Backend](06-backend.md) y [08 — Reglas de negocio](08-workflow.md).
- Para registrar quién hizo la acción, use `req.user!.userId` como `createdById`.

## Paso 4: Monte el router en `index.ts`

Si el recurso depende de otro (por ejemplo, contactos de un cliente), agregue las rutas al router del recurso padre. El módulo de contactos vive dentro de `server/src/routes/clients.ts` como `GET/POST/DELETE /:id/contacts`. No requiere cambio en `server/src/index.ts`.

Si crea un módulo nuevo de nivel superior, monte su router en `server/src/index.ts`:

```ts
import { contactsRouter } from "./routes/contacts";
// ...
app.use("/api/contacts", contactsRouter);
```

Use la regla: los recursos dependientes se anidan en el router del padre. Los recursos independientes tienen router propio montado en `index.ts`. El prefijo `/api` agrupa los endpoints del sistema.

## Paso 5: Agregue el método al helper `api`

Edite `client/src/api/client.ts`. El helper `request<T>` agrega el token y parsea la respuesta. No haga `fetch` directo en las páginas.

```ts
getContacts: (clientId: number) => request<any[]>(`/clients/${clientId}/contacts`),
createContact: (clientId: number, data: Record<string, unknown>) =>
  request<any>(`/clients/${clientId}/contacts`, { method: "POST", body: JSON.stringify(data) }),
```

> Los helpers de contactos, direcciones e interacciones ya existen en `api`: `getClientContacts`, `createClientContact`, `updateClientContact`, `deleteClientContact`, `getClientAddresses`, `getClientInteractions`, `createClientInteraction`. `Clients.tsx` y `Contactos.tsx` los usan.

## Paso 6: Cree la página y la ruta

Cree el archivo en `client/src/pages/`. Use TanStack Query para las lecturas:

```tsx
const { data: contacts, isLoading } = useQuery({
  queryKey: ["contacts", clientId],
  queryFn: () => api.getContacts(clientId),
});
```

Tras una mutación, invalide las claves afectadas:

```tsx
const queryClient = useQueryClient();
queryClient.invalidateQueries({ queryKey: ["contacts", clientId] });
```

Registre la ruta en `client/src/App.tsx` dentro de `<Layout />`:

```tsx
<Route path="contactos" element={<RequireRole roles={VENTAS}><Contacts /></RequireRole>} />
```

Proteja la ruta con `RequireRole` y el grupo de roles correspondiente (los grupos viven en `client/src/components/navConfig.ts`). Agregue la entrada al menú en `navConfig.ts` con su campo `roles`; si no, el ítem no aparece para el rol.

Si la lectura debe funcionar offline (PWA), amplíe el `runtimeCaching` de `vite.config.ts`. Ver [07 — Frontend](07-frontend.md).

## Paso 7: Verifique el cambio

```bash
npm run build                 # compila server (tsc) y client (vite)
npm run test                  # suites de API (node:test) y frontend (vitest)
npm run dev                   # prueba manual en http://localhost:4000 y http://localhost:5173
```

Obtenga un token y pruebe los endpoints:

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","password":"password123"}'
```

Guarde el `token` de la respuesta. Use el header `Authorization: Bearer <token>` en las peticiones siguientes. Ver [05 — API](05-api.md).

## Paso 8: Actualice esta documentación

Documente el cambio en los documentos correspondientes:

| Documento | Qué actualizar |
|---|---|
| [04 — Base de datos](04-database.md) | Tabla nueva en el esquema y el diagrama de relaciones |
| [05 — API](05-api.md) | Endpoints nuevos en la referencia |
| [06 — Backend](06-backend.md) | Router nuevo en la estructura de carpetas y el mapa de montaje |
| [07 — Frontend](07-frontend.md) | Método nuevo en `api`, página y ruta |
| [08 — Reglas de negocio](08-workflow.md) | Solo si el cambio altera el ciclo del stock u otra regla |
| [00 — Hoja de ruta](00-roadmap.md) | Actualice el estado del módulo correspondiente |

## Lista de verificación

- [ ] El modelo usa `@map`/`@@map` (snake_case).
- [ ] Las relaciones están en ambos lados.
- [ ] La migración se generó con `npm run prisma:migrate`.
- [ ] El router valida con zod y devuelve `400`/`404` correctos.
- [ ] Las mutaciones multi-tabla usan `prisma.$transaction`.
- [ ] El router está montado en `index.ts`.
- [ ] El frontend usa el helper `api` (no `fetch` directo).
- [ ] `npm run build` compila sin errores.
- [ ] La documentación está actualizada.
