# 01 — Visión general

Este documento describe el sistema **actual implementado**: qué resuelve hoy, su stack, sus módulos y sus actores. La visión del sistema objetivo (ERP/MES completo) está en [00 — Hoja de ruta del producto](00-roadmap.md).

## Qué resuelve el sistema

El sistema actual reemplaza el flujo manual de Excel y WhatsApp. Este flujo conecta la Planta de Producción con la Planta de Despacho.

En el flujo manual, Producción llena un reporte. El reporte es un archivo Excel o CSV. Contiene los productos fabricados. Producción envía el reporte por WhatsApp al encargado de despacho. Despacho copia los datos al inventario manualmente. Después, Despacho prepara los envíos.

El sistema digitaliza este flujo:

- **Carga de producción**: manual o por importación del mismo Excel.
- **Producción por orden de trabajo**: cada OP pasa por las cuatro estaciones (extrusión, impresión, sellado, precorte) y al finalizar genera inventario.
- **Inventario actualizado**: con alertas de stock mínimo.
- **Despachos registrados**: descuentan el inventario automáticamente.
- **Comercial**: cotizaciones, pedidos versionados y facturación con pagos (cartera).

## Stack tecnológico

| Capa | Tecnología | Rol |
|---|---|---|
| Backend | Node.js + Express 5 + TypeScript | API REST |
| ORM | Prisma 7 (`@prisma/adapter-pg`) | Acceso a datos y migraciones |
| Base de datos | PostgreSQL 16 (Docker) | Persistencia |
| Frontend | React 19 + Vite + TypeScript | SPA |
| UI | Tailwind CSS 4 + lucide-react | Estilos e íconos SVG |
| Estado de servidor | TanStack Query | Caché y sincronización de datos |
| Autenticación | JWT (`jsonwebtoken`) + `bcryptjs` | Login |
| 2FA | `otplib` + `qrcode` (TOTP) | Segundo factor opcional |
| Validación | Zod | Schemas de entrada |
| Email | Resend (con respaldo a `console.log`) | Recuperación de contraseña |
| PWA | `vite-plugin-pwa` (Workbox) | Instalable. Caché offline del inventario |
| Archivos Excel | `exceljs` (backend), `multer` (subida) | Importación de producción |
| WhatsApp | Webhook de WhatsApp Business API (Meta Graph API) | Fase 2 (parcial) |

## Módulos

| Módulo | Estado | Descripción |
|---|---|---|
| Autenticación | ✅ Implementado | Login JWT con matriz de **11 roles**, bloqueo por intentos fallidos (5), 2FA/TOTP opcional y recuperación de contraseña |
| CRM de clientes | ✅ Implementado | Clientes, contactos, direcciones, historial de interacciones, límite de crédito y cartera |
| Comercial | ✅ Implementado | Cotizaciones (con estado), pedidos **versionados** con adjuntos, facturación y abonos |
| Órdenes de producción | ✅ Implementado | OP con numeración consecutiva y paso por las 4 estaciones |
| Estaciones de planta | ✅ Implementado | Registro de etapa con kilos, merma y tiempos. El precorte genera la entrada de inventario |
| Inventario | ✅ Implementado | Stock por producto, stock mínimo, alertas, categorías. Movimientos como bitácora |
| Producción | ✅ Implementado | Alta manual + importación Excel/CSV con preview y confirmación |
| Despachos | ✅ Implementado | Crear despacho y marcar items como despachados (descuenta stock) |
| Auditoría | 🟡 Parcial | Bitácora de movimientos de inventario + registro de importaciones |
| WhatsApp | 🔶 Fase 2 | Webhook implementado. Pendiente cuenta Meta aprobada y credenciales |

## Actores (roles)

La matriz completa tiene **11 roles** (`server/src/middleware/auth.ts` los agrupa en `ROLES`):

| Rol | Qué puede hacer |
|---|---|
| `super_admin` / `admin` | Todo |
| `gerente_produccion` | Crear OPs, cambiar su estado, cargar producción, registrar etapas de cualquier estación |
| `planeacion` | Igual que gerente de producción (gestión) |
| `operario_extrusion` | Registrar etapas de **Extrusión** |
| `operario_impresion` | Registrar etapas de **Impresión** |
| `operario_sellado_precorte` | Registrar etapas de **Sellado y Precorte** |
| `ventas_pedidos` | CRM, cotizaciones, pedidos, facturas y pagos |
| `almacen_despachos` | Carga de producción (Excel/manual) y despachos |
| `calidad` | Reservado (sin endpoints específicos hoy) |
| `auditor` | Reservado (sin endpoints específicos hoy) |

Los grupos reutilizables (`ROLES.VENTAS`, `ROLES.ALMACEN`, `ROLES.PRODUCCION_GESTION`, `ROLES.OPERARIOS`) restringen las rutas con `requireRole`. `super_admin` y `admin` siempre tienen acceso. Ver [06 — Backend](06-backend.md).

## Repositorio y monorepo

El proyecto es un **monorepo npm con workspaces**. La raíz instala y gestiona `server` y `client` (`npm install` instala ambos).

Ver [02 — Puesta en marcha](02-setup.md).

```
/
├── package.json          → workspaces + scripts orquestadores
├── docker-compose.yml    → PostgreSQL 16 local
├── server/               → API REST (Express + Prisma)
├── client/               → SPA/PWA (React + Vite)
├── testing/              → suites de pruebas (API y frontend)
└── docs/                 → esta documentación
```