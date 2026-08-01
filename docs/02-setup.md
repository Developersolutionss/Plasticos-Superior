# 02 — Puesta en marcha

## Requisitos

- Node.js 20+
- Docker (para levantar PostgreSQL local)
- npm (incluido con Node.js)

## Instalación y puesta en marcha en desarrollo

Ejecute estos pasos desde la raíz del repositorio:

### Paso 1: Inicie la base de datos

Ejecute este comando para iniciar PostgreSQL 16 en Docker:

```bash
docker compose up -d
```

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
npm run prisma:seed      # siembra usuarios, productos y clientes
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

## Scripts

### Raíz (orquesta los workspaces)

| Script | Qué hace |
|---|---|
| `npm run dev` | Inicia backend y frontend juntos (dev con recarga) |
| `npm run dev:server` | Inicia solo el backend (`tsx watch src/index.ts`) |
| `npm run dev:client` | Inicia solo el frontend (`vite`) |
| `npm run build` | Compila server (`tsc`) y client (`vite build`) |
| `npm run prisma:migrate` | `prisma migrate dev` (en server) |
| `npm run prisma:seed` | `tsx prisma/seed.ts` (en server) |

### Server (`server/package.json`)

| Script | Qué hace |
|---|---|
| `npm run dev` | `tsx watch src/index.ts` — dev con recarga |
| `npm run build` | `tsc -p tsconfig.json` → `dist/` |
| `npm run start` | `node dist/index.js` — producción |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run prisma:generate` | Regenera Prisma Client |
| `npm run prisma:seed` | Ejecuta el seed |

## Build y producción

```bash
npm run build          # compila server y client
cd server && npm run start   # inicia la API desde dist/
```

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

## Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `prisma migrate dev` no conecta | PostgreSQL no está iniciado o `DATABASE_URL` es incorrecto | `docker compose up -d` y revise `server/.env` |
| Errores 401 en la API | Token no enviado o `JWT_SECRET` distinto | Haga login primero. Use `Authorization: Bearer <token>` |
| Prisma Client desactualizado | Cambió el schema y no regeneró | `npm run prisma:generate` (o `migrate dev`, que regenera) |
