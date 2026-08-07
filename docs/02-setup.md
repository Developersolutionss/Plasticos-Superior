# 02 — Puesta en marcha

## Requisitos

- Node.js 20+
- Docker **con el plugin Compose** (para levantar PostgreSQL local)
- npm (incluido con Node.js)

Verifique que el plugin Compose está disponible antes de continuar:

```bash
docker compose version
```

Si falla con `docker: unknown command: docker compose`, el plugin no está instalado. Vea [Levantar la base de datos sin Compose](#levantar-la-base-de-datos-sin-compose).

## Instalación y puesta en marcha en desarrollo

Ejecute estos pasos desde la raíz del repositorio:

### Levantar la base de datos sin Compose

El comando `docker compose` necesita el plugin Compose. Si no está instalado, tiene dos opciones:

**Opción A — Instalar el plugin.** En distribuciones basadas en Debian/Ubuntu:

```bash
sudo apt-get update
sudo apt-get install docker-compose-plugin
docker compose version
```

En otras plataformas, reinstale Docker (Docker Desktop incluye el plugin) o descargue el binario `docker-compose` del proyecto Compose. Si usa la herramienta independiente, sustituya `docker compose` por `docker-compose`.

**Opción B — Contenedor equivalente con `docker run`.** Arranca el mismo PostgreSQL 16 con las mismas credenciales, puerto y volumen que `docker-compose.yml`:

```bash
docker volume create db_data
docker run -d --name db --restart unless-stopped \
  -p 5432:5432 \
  -e POSTGRES_USER=inventario \
  -e POSTGRES_PASSWORD=inventario \
  -e POSTGRES_DB=inventario_despachos \
  -v db_data:/var/lib/postgresql/data \
  postgres:16-alpine
```

> ⚠️ Use una de las dos opciones, no ambas a la vez: correr el contenedor `db` con `docker run` y después `docker compose up -d` genera conflicto por el puerto `5432`.

### Paso 1: Inicie la base de datos

Ejecute este comando para iniciar PostgreSQL 16 en Docker:

```bash
docker compose up -d
```

Si `docker compose` no está disponible, arranque la base de datos con [una de las opciones de la sección anterior](#levantar-la-base-de-datos-sin-compose).

### Paso 2: Instale las dependencias

```bash
npm install
```

Este comando instala los workspaces `server` y `client`.

### Paso 3: Configure las variables de entorno

```bash
cp server/.env.example server/.env
```

### Paso 4: Cree el esquema y los datos de ejemplo

```bash
npm run prisma:migrate   # aplica migraciones y regenera Prisma Client
npm run prisma:seed      # siembra usuarios, productos, clientes y contactos
```

### Paso 5: Inicie el backend y el frontend

```bash
npm run dev
```

Resultado esperado:
- API: `http://localhost:4000` (health check: `GET /health` → `{ "ok": true }`)
- Frontend: `http://localhost:5173`

## Variables de entorno (`server/.env`)

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL | `postgresql://inventario:inventario@localhost:5432/inventario_despachos?schema=public` |
| `JWT_SECRET` | Secreto para firmar los tokens | `change-me-in-production` ⚠️ cámbielo |
| `PORT` | Puerto del backend | `4000` |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificación del webhook de WhatsApp | `change-me` |
| `WHATSAPP_ACCESS_TOKEN` | Token de acceso a Meta Graph API (fase 2) | vacío |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número de WhatsApp (fase 2) | vacío |

## Usuarios de prueba (seed)

Todos con contraseña `password123`:

| Email | Rol |
|---|---|
| `admin@empresa.com` | admin |
| `produccion@empresa.com` | produccion |
| `despacho@empresa.com` | despacho |

Productos sembrados (catálogo): `BUL-001`, `ROL-PL-001`, `ROL-F-001`, `MAN-001`, `TIR-001`, `CTL-001`.
Clientes sembrados: "Cliente ACME", "Distribuidora Norte".
Contactos sembrados para Cliente ACME: María López (principal) y Carlos Pérez.

## Scripts

### Raíz (orquesta los workspaces)

| Script | Qué hace |
|---|---|
| `npm run dev` | Inicia backend y frontend juntos (dev con recarga) |
| `npm run dev:server` | Inicia solo el backend (`tsx watch src/index.ts`) |
| `npm run dev:client` | Inicia solo el frontend (`vite`) |
| `npm run build` | Compila server (`tsc`) y client (`vite build`) |
| `npm run prisma:migrate` | `prisma migrate dev` + regenera Prisma Client (en server) |
| `npm run prisma:seed` | `prisma db seed` (en server) |

### Server (`server/package.json`)

| Script | Qué hace |
|---|---|
| `npm run dev` | `tsx watch src/index.ts` — dev con recarga |
| `npm run build` | `tsc -p tsconfig.json` → `dist/` |
| `npm run start` | `node dist/index.js` — producción |
| `npm run prisma:migrate` | `prisma migrate dev` + `prisma generate` |
| `npm run prisma:generate` | Regenera Prisma Client (`prisma generate`) |
| `npm run prisma:seed` | Ejecuta el seed (`prisma db seed`) |

## Build y producción

```bash
npm run build          # compila server y client
cd server && npm run start   # inicia la API desde dist/
```

> ⚠️ El comando `npm run build` regenera Prisma Client y requiere el archivo `server/.env`. Si el archivo no existe, el build falla con `Cannot resolve environment variable: DATABASE_URL`. En un clon nuevo, cree el archivo antes de compilar:

> ```bash
> cp server/.env.example server/.env
> ```

> Nota: el servidor (`server/src/index.ts`) **solo expone la API** (no sirve el build del frontend). En producción, sirva el cliente compilado (`client/dist`) con un servidor estático (nginx, CDN, etc.). Ese servidor debe **reenviar `/api/*` a la API**. Esto replica el papel del proxy de desarrollo. Ver [03 — Arquitectura](03-architecture.md).

## Base de datos local (Docker)

Definida en `docker-compose.yml`:

```yaml
db:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: inventario
    POSTGRES_PASSWORD: inventario
    POSTGRES_DB: inventario_despachos
  ports:
    - "5432:5432"
  volumes:
    - db_data:/var/lib/postgresql/data
```

Comandos útiles:

```bash
docker compose up -d    # iniciar
docker compose down     # detener (conserva datos)
docker compose down -v  # detener y borrar el volumen (datos desde cero)
docker exec -it db psql -U inventario -d inventario_despachos -c "\dt"   # listar tablas
```

Si no dispone del plugin Compose, use el contenedor equivalente de [Levantar la base de datos sin Compose](#levantar-la-base-de-datos-sin-compose):

```bash
docker stop db && docker rm db   # detener y eliminar el contenedor (conserva el volumen db_data)
docker volume rm db_data         # borrar también los datos (opcional)
```

## Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `docker: unknown command: docker compose` | El plugin Compose no está instalado | Instale el plugin (`sudo apt-get install docker-compose-plugin`) o use el `docker run` de respaldo. Ver [Levantar la base de datos sin Compose](#levantar-la-base-de-datos-sin-compose) |
| `prisma migrate dev` no conecta | PostgreSQL no está iniciado o `DATABASE_URL` es incorrecto | Inicie la base de datos (`docker compose up -d` o el fallback de `docker run`) y revise `server/.env` |
| Vite no arranca con error de `esbuild` (binario no encontrado) tras `npm install` | El script de instalación de `esbuild` fue bloqueado por `allowScripts` en `package.json` | Habilite los scripts con `npm install-scripts approve esbuild` (o agregue `"esbuild": true` a `allowScripts` en `package.json` y vuelva a instalar) |
| Errores 401 en la API | Token no enviado o `JWT_SECRET` distinto | Haga login primero. Use `Authorization: Bearer <token>` |
| `npm run build` falla con `Cannot resolve environment variable: DATABASE_URL` | `server/.env` no existe. Prisma 7 resuelve `DATABASE_URL` al generar el cliente | Copie el archivo de ejemplo y repita el build: `cp server/.env.example server/.env && npm run build` |
| Prisma Client desactualizado | Cambió el schema y no regeneró | `npm run prisma:generate` (o `migrate dev`, que regenera) |
