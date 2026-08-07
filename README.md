# Inventario y Despachos

Sistema web (PWA) para reemplazar el flujo manual de Excel/WhatsApp entre Planta de Producción y Planta de Despacho.

## Stack

- Backend: Node.js + Express + TypeScript + Prisma (PostgreSQL)
- Frontend: React + Vite + TypeScript + Tailwind CSS + TanStack Query, empaquetado como **PWA** (instalable, con caché offline del dashboard de inventario vía `vite-plugin-pwa`)
- Base de datos local: PostgreSQL vía Docker Compose

## Requisitos

- Node.js 20+
- Docker con el plugin Compose (verificar con `docker compose version`)

## Puesta en marcha

```bash
# 1. Levantar la base de datos
docker compose up -d
# Si `docker compose` no existe, ver alternativas en docs/02-setup.md

# 2. Instalar dependencias (workspaces: server + client)
npm install

# 3. Configurar variables de entorno del backend
cp server/.env.example server/.env

# 4. Crear el esquema y datos de ejemplo
npm run prisma:migrate
npm run prisma:seed

# 5. Levantar backend (puerto 4000) y frontend (puerto 5173)
npm run dev
```

Usuarios de prueba (creados por el seed), contraseña `password123` para todos — uno por cada rol de la matriz completa (Módulo 1):

| Email | Rol |
|---|---|
| `admin@empresa.com` | `super_admin` |
| `administrador@empresa.com` | `admin` |
| `produccion@empresa.com` | `gerente_produccion` |
| `planeacion@empresa.com` | `planeacion` |
| `ventas@empresa.com` | `ventas_pedidos` |
| `despacho@empresa.com` | `almacen_despachos` |
| `operario.extrusion@empresa.com` | `operario_extrusion` |
| `operario.impresion@empresa.com` | `operario_impresion` |
| `operario.sellado@empresa.com` | `operario_sellado_precorte` |
| `calidad@empresa.com` | `calidad` |
| `auditor@empresa.com` | `auditor` |

### Seguridad de acceso (Módulo 1)

- **Bloqueo por intentos fallidos:** 5 intentos con contraseña incorrecta bloquean la cuenta 15 minutos.
- **Recuperación de contraseña:** `/forgot-password` en el frontend. Sin `RESEND_API_KEY` configurada en `server/.env`, el link de reseteo se imprime en la consola del backend en vez de enviarse por email — útil para probar el flujo en local sin depender de un proveedor real.
- **2FA opcional (TOTP):** cada usuario lo activa desde "Configuración → Autenticación" (`/configuracion/autenticacion`), escaneando un QR con Google Authenticator/Authy.

## Flujo de prueba end-to-end

1. Iniciar sesión como `despacho@empresa.com`.
2. Ir a "Carga de Producción", subir un Excel/CSV con columnas
   `SKU | Etiqueta | Operario | Cliente | Medida | Kilos | Conductor | Observaciones`
   (los SKU deben existir en el catálogo sembrado: `BUL-001`, `ROL-PL-001`, `ROL-F-001`, `MAN-001`, `TIR-001`, `CTL-001`).
3. Revisar el preview y confirmar la importación.
4. Ir a "Inventario" y verificar que el stock subió y las alertas de mínimo se actualizan.
5. Crear un despacho (vía API o próxima UI de creación) para un cliente y marcar items como despachados en "Despachos" — el stock se descuenta automáticamente.

## Integración WhatsApp Business API (fase 2)

El endpoint `/webhook/whatsapp` ya está implementado (handshake de verificación + recepción de documentos). Falta:

1. Cuenta de WhatsApp Business API aprobada en Meta for Developers.
2. Configurar el Webhook URL y `WHATSAPP_VERIFY_TOKEN` en el panel de Meta.
3. Completar `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` en `server/.env`.

Ver comentarios en [`server/src/routes/whatsappWebhook.ts`](server/src/routes/whatsappWebhook.ts) para el detalle.

## Estructura

```
/server   → API REST (Express + Prisma)
/client   → SPA/PWA (React + Vite)
/docs     → documentación técnica del proyecto
docker-compose.yml → PostgreSQL local
```

## Documentación

La documentación completa del proyecto (arquitectura, base de datos, API, backend, frontend, reglas de negocio y guía de contribución) está en [`/docs`](docs/README.md).
