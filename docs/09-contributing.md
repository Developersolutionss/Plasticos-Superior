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
| Nombre del modelo en singular | `model Contact` |
| Tabla en snake_case plural | `@@map("contacts")` |
| Columnas en snake_case | `@map("client_id")`, `@map("created_at")` |
| Llave primaria | `id Int @id @default(autoincrement())` |
| Timestamp de creación | `createdAt DateTime @default(now()) @map("created_at")` |
| Relaciones en ambos lados | `contacts Contact[]` en `Client` y `client Client @relation(...)` en `Contact` |
| FKs en `modelo_id` | `clientId Int @map("client_id")` |
| Cantidades como Decimal | `@db.Decimal(12, 2)` |
| Estados como enum | declarar el enum a nivel superior del schema, junto a los demás enums |

Ejemplo de un modelo nuevo:

```prisma
model Contact {
  id        Int      @id @default(autoincrement())
  clientId  Int      @map("client_id")
  client    Client   @relation(fields: [clientId], references: [id])
  name      String
  phone     String?
  email     String?
  role      String?
  createdAt DateTime @default(now()) @map("created_at")

  @@map("contacts")
}
```

Agregue la relación en el modelo padre:

```prisma
model Client {
  // campos existentes...
  contacts Contact[]
}
```

## Paso 2: Genere la migración

Ejecute desde la raíz:

```bash
npm run prisma:migrate
```

Prisma crea una carpeta nueva en `server/prisma/migrations/` y regenera el Client. Si el schema tiene errores, la migración falla antes de tocar la base de datos.

## Paso 3: Cree el router en el backend

Cree el archivo en `server/src/routes/`. Use el patrón router → zod → prisma. Todos los routers del proyecto siguen este molde:

```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

const createContactSchema = z.object({
  clientId: z.number().int().positive(),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  role: z.string().optional(),
});

contactsRouter.get("/", async (req, res) => {
  const contacts = await prisma.contact.findMany({
    where: { clientId: Number(req.params.clientId) },
    orderBy: { name: "asc" },
  });
  res.json(contacts);
});

contactsRouter.post("/", async (req, res) => {
  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const contact = await prisma.contact.create({ data: parsed.data });
  res.status(201).json(contact);
});
```

Reglas:

- Use `requireAuth` con `router.use(requireAuth)` para proteger todo el archivo. El login y el webhook de WhatsApp son las únicas excepciones.
- Valide el body con un schema zod y `safeParse`. Si falla → `400`.
- Si el recurso no existe → `404`.
- Si una mutación toca varias tablas, envuélvala en `prisma.$transaction(...)`. Ver la lógica de stock en [06 — Backend](06-backend.md) y [08 — Reglas de negocio](08-workflow.md).
- Para registrar quién hizo la acción, use `req.user!.userId` como `createdById`.

## Paso 4: Monte el router en `index.ts`

Edite `server/src/index.ts`:

```ts
import { contactsRouter } from "./routes/contacts";
// ...
app.use("/api/clients/:clientId/contacts", contactsRouter);
```

Si el recurso depende de otro, considere anidar la ruta (por ejemplo `/:clientId/contacts`). Hoy ningún router del proyecto usa rutas anidadas: las existentes son planas (`/api/clients`, `/api/inventory`). Elija el estilo que mejor exprese la relación y mantenga el mismo criterio en todo el módulo. El prefijo `/api` agrupa los endpoints del sistema.

## Paso 5: Agregue el método al helper `api`

Edite `client/src/api/client.ts`. El helper `request<T>` agrega el token y parsea la respuesta. No haga `fetch` directo en las páginas.

```ts
getContacts: (clientId: number) => request<any[]>(`/clients/${clientId}/contacts`),
createContact: (clientId: number, data: Record<string, unknown>) =>
  request<any>(`/clients/${clientId}/contacts`, { method: "POST", body: JSON.stringify(data) }),
```

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
<Route path="contactos" element={<Contacts />} />
```

Si la lectura debe funcionar offline (PWA), amplíe el `runtimeCaching` de `vite.config.ts`. Ver [07 — Frontend](07-frontend.md).

## Paso 7: Verifique el cambio

```bash
npm run build                 # compila server (tsc) y client (vite)
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
