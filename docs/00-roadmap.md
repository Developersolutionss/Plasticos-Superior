# 00 — Hoja de ruta del producto

Este documento define la visión del sistema objetivo: un **ERP/MES para Plásticos Superior S.A.S.** Describe hacia dónde evoluciona el sistema. Para el estado actual del código, ver [01 — Visión general](01-overview.md).

## Qué es el sistema objetivo

Un sistema de gestión de producción industrial a la medida. La planta trabaja cuatro procesos sobre rollos plásticos:

- Extrusión.
- Impresión.
- Sellado.
- Precorte.

El sistema objetivo digitaliza el flujo completo del negocio:

1. Entra un pedido.
2. El pedido pasa por planeación.
3. Cada estación fabrica el pedido.
4. El sistema controla la calidad.
5. Cada rollo se etiqueta e imprime con etiqueta térmica.
6. El rollo sale despachado y facturado.

El sistema actual implementa solo una parte de este flujo: producción, inventario y despacho. Ver [01 — Visión general](01-overview.md).

## Objetivos

La planta debe dejar de depender de papel y hojas de cálculo. El sistema debe proveer:

- **Trazabilidad completa de cada rollo**: de dónde salió, en qué máquina, qué operario, cuánto desperdicio generó.
- **Control en tiempo real** de la producción y el desperdicio por máquina y por turno.
- **Identificación física de cada rollo** con etiqueta térmica + código de barras/QR, escaneable con pistola en cada estación.
- **Dashboard ejecutivo** con los indicadores clave del negocio.

## Nota sobre el estado actual

El plan original asigna la autenticación a la Fase 1. La autenticación **ya está implementada** (JWT, tres roles). El avance real respecto al plan se detalla en la tabla de módulos.

## Los 20 módulos en 4 fases

El proyecto se construye en 20 módulos, repartidos en 4 fases a lo largo de 6 meses.

### Fase 1 (semanas 1-8)

| # | Módulo | Estado |
|---|---|---|
| 1 | Autenticación | ✅ Implementado |
| 2 | Auditoría | 🟡 Parcial (solo bitácora de inventario) |
| 3 | CRM de clientes | 🟡 Mínimo (listar/crear) |
| 4 | Pedidos | ❌ Pendiente |

### Fase 2 (semanas 9-16)

| # | Módulo | Estado |
|---|---|---|
| 5 | Planeación | ❌ Pendiente |
| 6 | Órdenes de producción | ❌ Pendiente |
| 7 | Extrusión | ❌ Pendiente |
| 8 | Impresión | ❌ Pendiente |
| 9 | Sellado | ❌ Pendiente |
| 10 | Precorte | ❌ Pendiente |
| 11 | Trazabilidad básica | ❌ Pendiente |

### Fase 3 (semanas 17-20)

| # | Módulo | Estado |
|---|---|---|
| 12 | Calidad | ❌ Pendiente |
| 13 | Inventario | ✅ Implementado |
| 14 | Almacén / WMS | ❌ Pendiente |
| 15 | Dashboard | 🟡 Parcial (solo dashboard de stock) |
| 16 | Exportaciones | ❌ Pendiente |

### Fase 4 (semanas 21-24)

| # | Módulo | Estado |
|---|---|---|
| 17 | Etiquetas térmicas | ❌ Pendiente |
| 18 | Escaneo QR / código de barras | ❌ Pendiente |
| 19 | Notificaciones | ❌ Pendiente |
| 20 | Pruebas finales y despliegue | ❌ Pendiente |

## Resumen de avance

| Estado | Cantidad |
|---|---|
| ✅ Implementado | 2 |
| 🟡 Parcial | 3 |
| ❌ Pendiente | 15 |

## Stack

El stack tecnológico completo (backend, base de datos, frontend, PWA) está detallado en [01 — Visión general](01-overview.md).

## Módulos ya documentados

La documentación técnica actual cubre parte de este plan:

| Documento | Cubre |
|---|---|
| [01 — Visión general](01-overview.md) | Estado actual de los módulos |
| [08 — Reglas de negocio](08-workflow.md) | Ciclo del stock de inventario |
| [09 — Guía de contribución](09-contributing.md) | Cómo agregar módulos nuevos (modelo + migración + endpoint + página) |
