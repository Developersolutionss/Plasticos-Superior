# 01 — Visión general

Este documento describe el sistema **actual implementado**: qué resuelve hoy, su stack, sus módulos y sus actores. La visión del sistema objetivo (ERP/MES completo) está en [00 — Hoja de ruta del producto](00-roadmap.md).

## Qué resuelve el sistema

El sistema actual reemplaza el flujo manual de Excel y WhatsApp. Este flujo conecta la Planta de Producción con la Planta de Despacho.

En el flujo manual, Producción llena un reporte. El reporte es un archivo Excel o CSV. Contiene los productos fabricados. Producción envía el reporte por WhatsApp al encargado de despacho. Despacho copia los datos al inventario manualmente. Después, Despacho prepara los envíos.

El sistema digitaliza este flujo:

- **Carga de producción**: manual o por importación del mismo Excel.
- **Inventario actualizado**: con alertas de stock mínimo.
- **Despachos registrados**: descuentan el inventario automáticamente.

## Stack tecnológico

| Capa | Tecnología | Rol |
|---|---|---|
| Backend | Node.js + Express + TypeScript | API REST |
| ORM | Prisma | Acceso a datos y migraciones |
| Base de datos | PostgreSQL 16 (Docker) | Persistencia |
| Frontend | React + Vite + TypeScript | SPA |
| UI | Tailwind CSS | Estilos |
| Estado de servidor | TanStack Query | Caché y sincronización de datos |
| Autenticación | JWT (`jsonwebtoken`) + `bcryptjs` | Login |
| Validación | Zod | Schemas de entrada |
| PWA | `vite-plugin-pwa` (Workbox) | Instalable. Caché offline del inventario |
| Archivos Excel | `exceljs` (backend), `multer` (subida) | Importación de producción |
| WhatsApp | Webhook de WhatsApp Business API (Meta Graph API) | Fase 2 (parcial) |

## Módulos

El estado real frente al plan completo de 20 módulos está en [00 — Hoja de ruta del producto](00-roadmap.md).

| Módulo | Estado | Descripción |
|---|---|---|
| Autenticación | ✅ Implementado | Login JWT. Tres roles: `admin`, `produccion`, `despacho` |
| Inventario | ✅ Implementado | Stock por producto. Stock mínimo. Alertas. Categorías |
| Producción | ✅ Implementado | Alta manual + importación Excel/CSV con preview y confirmación |
| Despachos | ✅ Implementado (parcial) | Crear despacho y marcar items como despachados (descuenta stock). Sin UI de creación aún |
| Clientes | 🟡 Mínimo | Listar/crear clientes (usado en despachos). Sin módulo de CRM |
| WhatsApp | 🔶 Fase 2 | Webhook implementado. Pendiente cuenta Meta aprobada y credenciales |
| CRM | ❌ Pendiente | Módulo de clientes/contactos futuro |

## Actores (roles)

| Rol | Qué puede hacer |
|---|---|
| `admin` | Todo |
| `produccion` | Cargar producción (manual/Excel) |
| `despacho` | Ver inventario. Crear y marcar despachos |

Todos los roles pasan por autenticación. Todos los routers usan `requireAuth` excepto el login y el webhook de WhatsApp.

## Repositorio y monorepo

El proyecto es un **monorepo npm con workspaces**. `server` y `client` se instalan y gestionan desde la raíz (`npm install` instala ambos).

Ver [02 — Puesta en marcha](02-setup.md).

```
/
├── package.json          → workspaces + scripts orquestadores
├── docker-compose.yml    → PostgreSQL 16 local
├── server/               → API REST (Express + Prisma)
├── client/               → SPA/PWA (React + Vite)
└── docs/                 → esta documentación
```
