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
npm run test:server:aislado   # suite de API contra una base aparte (no ensucia la de desarrollo)
npm run test:e2e              # flujos web con navegador real y cámara emulada
npm run dev                   # prueba manual en http://localhost:4000 y http://localhost:5173
```

La suite de API crea datos reales: OPs `OP-TEST-*`, movimientos de inventario, notificaciones y clientes de prueba. No borra todos. `npm run test` los escribe en la base de `server/.env`. Si la base es la de desarrollo, esos datos quedan mezclados con los demos y alteran el stock.

Use `npm run test:server:aislado` para evitarlo. El comando hace cuatro pasos:

1. Recrea la base `<nombre>_test` desde cero (por ejemplo, `inventario_despachos_test`).
2. Aplica las migraciones en esa base.
3. Siembra los datos de ejemplo.
4. Corre la suite de API contra esa base.

El comando solo borra una base cuyo nombre termina en `_test`. Nunca toca la base de desarrollo. Para usar otro nombre, defina `TEST_DATABASE_NAME` (debe terminar en `_test`).

### Pruebas de flujos web (E2E)

`npm run test:e2e` abre un navegador real (Chromium) y recorre la aplicación completa como lo hacen las personas de planta. Cubre flujos con varios usuarios, con cámara y con dos tamaños de pantalla. Las pruebas viven en `testing/e2e/`.

El comando hace seis pasos:

1. Recrea la base `<nombre>_e2e` desde cero.
2. Aplica las migraciones y siembra los datos de ejemplo.
3. Compila el front para producción.
4. Levanta su propio API (puerto 4100) y su propio front (puerto 5273).
5. Corre los flujos en dos proyectos: `escritorio` (1280×800) y `movil` (Pixel 7 emulado, pantalla táctil de 412 px).
6. Escribe el informe en `testing/e2e/informe/`.

El comando nunca toca la base de desarrollo. Playwright se niega a correr si la base no termina en `_e2e`. Para usar otro nombre, defina `E2E_DATABASE_NAME` (debe terminar en `_e2e`).

Los argumentos extra pasan a Playwright:

```bash
npm run test:e2e -- --headed                 # ver el navegador mientras corre
npm run test:e2e -- -g "reemitir"            # un solo flujo, por parte de su nombre
npm run test:e2e -- --project=movil          # solo el diseño de celular
npm run test:e2e -- --repeat-each=3          # repetir cada flujo (detecta pruebas inestables)
npx playwright show-report testing/e2e/informe
```

**Qué cubre cada archivo**

| Archivo | Flujo |
|---|---|
| `camara.spec.ts` | La cámara emulada entrega un QR real al escáner de la app |
| `etiqueta-qr.spec.ts` | La etiqueta que imprime la app la lee la cámara y el servidor la acepta. Sin token o con token falso se rechaza. Reemitir invalida la etiqueta anterior. Corre en escritorio y en celular |
| `escaneo.spec.ts` | El botón único de la hoja de Sellado lee rollos madre y etiquetas de bulto. Cubre permiso de cámara negado, escritura a mano del código, liberación de la cámara y lectura única |
| `bodegas.spec.ts` | Un rollo viaja de Extrusión a Sellado: retiro, recepción con peso, inventario y conteo de Gestión. Cubre el peso mal tipeado y los permisos |
| `produccion-completa.spec.ts` | Desde la OP creada en pantalla hasta el lote aprobado en Calidad, con cuatro usuarios |
| `trazabilidad.spec.ts` | Búsqueda por QR de un rollo madre y de un rollo hijo, y por número de OP |
| `permisos.spec.ts` | Inicio de sesión, bloqueo de cuenta, y menú, URL y API por rol |
| `registro-rollos.movil.spec.ts` | Registro de rollos y despacho a bodegas con el diseño de celular |

**La cámara emulada**

La cámara reemplaza `navigator.mediaDevices.getUserMedia` por un video que sale de un `<canvas>`. El escáner real de la app (`html5-qrcode`) lee esos cuadros y decodifica el QR igual que con una cámara de verdad. Cada sesión (`sesion(rol)`) trae su propia cámara. Se controla desde `camara`:

| Método | Efecto |
|---|---|
| `mostrarTexto(texto)` | La cámara ve el QR de ese texto |
| `mostrarImagen(dataUrl)` | La cámara ve esa imagen tal cual |
| `vaciar()` | La cámara deja de ver un QR |
| `denegarPermiso()` | El navegador rechaza el permiso de cámara |
| `estado()` | Cuenta las pistas de video pedidas, abiertas y cerradas (`activas`) |

Siga estas reglas al usarla:

- Abra el escáner primero y muestre el QR después. Al cerrarse el escáner, el QR se retira solo.
- Para probar una etiqueta, use la imagen que imprime la app (`imagenDeLaEtiquetaImpresa`). No arme el QR a mano: así la prueba verifica lo que de verdad se imprime.

**Preparar datos y escribir un flujo**

1. Pida una sesión con `sesion("produccion", "/ruta")`. Cada llamada abre un navegador aparte con ese usuario del seed.
2. Prepare el escenario de partida por API con `testing/e2e/support/api.ts` (`crearOpExtrusionLiberada`, `cargarRollo`, `moverRolloA`, `derivarOp`). Verifique siempre lo que prueba por la pantalla.
3. Use `RegistroDeRollos` (`support/registroRollos.ts`) para el formulario de rollos: funciona igual en la tabla de escritorio y en las tarjetas de celular.
4. Si un texto existe en los dos diseños, filtre con `.filter({ visible: true })`.

Toda prueba falla si el navegador lanza un error sin atrapar o si el servidor responde 5xx. Cerrar el escáner justo mientras arranca la cámara lanza dos errores de `html5-qrcode`. Una prueba que lo provoca a propósito debe llamar a `toleraCierreRapidoDelEscaner(info)`.

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
