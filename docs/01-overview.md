# 01 — Visión general

Este documento describe el sistema **actual implementado**: qué resuelve hoy, su stack, sus módulos y sus actores. La visión del sistema objetivo (ERP/MES completo) está en [00 — Hoja de ruta del producto](00-roadmap.md).

## Qué resuelve el sistema

El sistema actual reemplaza el flujo manual de Excel y WhatsApp. Este flujo conecta la Planta de Producción con la Planta de Despacho.

En el flujo manual, Producción llena un reporte. El reporte es un archivo Excel o CSV. Contiene los productos fabricados. Producción envía el reporte por WhatsApp al encargado de despacho. Despacho copia los datos al inventario manualmente. Después, Despacho prepara los envíos.

El sistema digitaliza este flujo:

- **Carga de producción**: manual o por importación del mismo Excel.
- **Producción por orden de trabajo**: cada OP pasa por las cuatro estaciones (extrusión, impresión, sellado, precorte). Tras el precorte, Calidad aprueba o rechaza el lote. La aprobación genera la entrada de inventario.
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
| Archivos Excel | `exceljs` (backend), `multer` (subida) | Importación de producción y exportaciones con estilo |
| Gráficos | Recharts (frontend) | Dashboard ejecutivo y de indicadores |
| Escaneo QR | `html5-qrcode` (frontend), `qrcode` (backend) | Lectura por cámara y generación de QR imprimibles |
| PDF | `pdfkit` (backend) | Cotizaciones y facturas descargables para mandar al cliente |
| WhatsApp | Webhook + Graph API de Meta (WhatsApp Business) | Recepción (fase 2, parcial) y envío saliente al completar un despacho (no-op sin credenciales) |

## Módulos

| Módulo | Estado | Descripción |
|---|---|---|
| Autenticación | ✅ Implementado | Login JWT con matriz de **11 roles**, bloqueo por intentos fallidos (5), 2FA/TOTP opcional y recuperación de contraseña |
| CRM de clientes | ✅ Implementado | Clientes con avatar y ranking "Frecuentes" en vivo, contactos, direcciones, historial de interacciones, límite de crédito y cartera |
| Comercial | ✅ Implementado | Cotizaciones (con estado, PDF descargable), pedidos **versionados** con adjuntos, facturación con vencimiento/alerta de vencidas, abonos y PDF descargable |
| Planeación | ✅ Implementado | Cola de ítems de pedidos aprobados/en producción sin OP. Genera la OP de cada ítem |
| Órdenes de producción | ✅ Implementado | OP con numeración consecutiva y paso por las 4 estaciones |
| Estaciones de planta | ✅ Implementado | Registro de etapa con kilos, merma y tiempos. El precorte deja la OP `pendiente_calidad`; la entrada de inventario la genera Calidad al aprobar |
| Calidad | ✅ Implementado | Cola de OPs `pendiente_calidad`. Aprueba el lote (genera la entrada y finaliza la OP) o lo rechaza (la OP queda `detenida` sin tocar stock) |
| Trazabilidad | ✅ Implementado | Historial completo de una OP: pasos por estación, resultado de Calidad y pedido/cliente de origen |
| Inventario | ✅ Implementado | Stock por producto, stock mínimo, alertas, categorías. Movimientos como bitácora |
| Producción | ✅ Implementado | Alta manual + importación Excel/CSV con preview y confirmación |
| Despachos | ✅ Implementado | Crear despacho y marcar ítems como despachados (descuenta stock). Escaneo de producto por cámara. Al completarse, intenta notificar por WhatsApp al cliente |
| Almacén / WMS | ✅ Implementado | Ubicaciones de bodega con stock por ubicación. Complementa (no reemplaza) el stock total de Inventario: la suma por ubicación puede quedar por debajo del stock total ("sin ubicar"). QR imprimible por ubicación, con página pública de consulta sin login |
| Productos | ✅ Implementado | CRUD del catálogo (crear, editar, desactivar/reactivar) e impresión de etiquetas QR por producto |
| Usuarios y permisos | ✅ Implementado | CRUD de usuarios: crear, editar, cambiar rol, desactivar (bloquea el login) y reactivar. Un admin no puede autodesactivarse |
| Dashboard | ✅ Implementado | Dashboard ejecutivo (ventas de 6 meses, cartera pendiente, facturas con saldo, top clientes) y dashboard de indicadores (tasa de aprobación de calidad, tiempo promedio de producción, top productos despachados) |
| Exportaciones | ✅ Implementado | Descarga en Excel con estilo de marca: inventario, pedidos, facturas y clientes |
| Notificaciones | ✅ Implementado | Notificaciones in-app por rol. Hoy solo dos disparadores: OP lista para calidad y OP rechazada en calidad |
| Auditoría | ✅ Implementado | Bitácora forense de create/update/delete en tablas críticas (Client, Dispatch, ProductionEntry, InventoryMovement) con diff antes/después, usuario, IP y user-agent |
| WhatsApp | 🔶 Fase 2 | Webhook de recepción implementado. Envío saliente (aviso de despacho completado) implementado pero en modo no-op: pendiente cuenta Meta aprobada y credenciales |

## Actores (roles)

La matriz completa tiene **11 roles** (`server/src/middleware/auth.ts` los agrupa en `ROLES`):

| Rol | Qué puede hacer |
|---|---|
| `super_admin` / `admin` | Todo |
| `gerente_produccion` | Crear OPs, cambiar su estado, cargar producción, registrar etapas de cualquier estación |
| `planeacion` | Gestiona la cola de Planeación: ve los ítems de pedidos sin OP y genera sus OPs. También puede crear/cambiar OPs y registrar etapas |
| `operario_extrusion` | Registrar etapas de **Extrusión** |
| `operario_impresion` | Registrar etapas de **Impresión** |
| `operario_sellado_precorte` | Registrar etapas de **Sellado y Precorte** |
| `ventas_pedidos` | CRM, cotizaciones, pedidos, facturas y pagos |
| `almacen_despachos` | Carga de producción (Excel/manual) y despachos |
| `calidad` | Revisa la cola de OPs en `pendiente_calidad`: aprueba el lote o lo rechaza |
| `auditor` | Consulta la bitácora de auditoría y la trazabilidad de las OPs |

`almacen_despachos` también gestiona Almacén/WMS (ubicaciones y asignación de stock). Solo `super_admin`/`admin` (grupo `ROLES.ADMIN`) acceden al dashboard, las exportaciones y el CRUD de usuarios. Todos los roles ven sus propias notificaciones.

Los grupos reutilizables (`ROLES.VENTAS`, `ROLES.ALMACEN`, `ROLES.PRODUCCION_GESTION`, `ROLES.OPERARIOS`, `ROLES.CALIDAD`, `ROLES.AUDITORIA`, `ROLES.ADMIN`) restringen las rutas con `requireRole`. `super_admin` y `admin` siempre tienen acceso. Ver [06 — Backend](06-backend.md).

El **frontend replica este control**: el menú lateral y las rutas de la SPA se filtran por rol (`filterNavSections` + `RequireRole`). Un rol solo ve y accede a sus módulos. Ver [07 — Frontend](07-frontend.md).

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