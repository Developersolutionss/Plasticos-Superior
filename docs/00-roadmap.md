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

## Objetivos

La planta debe dejar de depender de papel y hojas de cálculo. El sistema debe proveer:

- **Trazabilidad completa de cada rollo**: de dónde salió, en qué máquina, qué operario, cuánto desperdicio generó.
- **Control en tiempo real** de la producción y el desperdicio por máquina y por turno.
- **Identificación física de cada rollo** con etiqueta térmica + código de barras/QR, escaneable con pistola en cada estación.
- **Dashboard ejecutivo** con los indicadores clave del negocio.

## Módulos y su estado real

El avance real frente al plan se detalla a continuación.

### Fase 1 (semanas 1-8) — Base comercial y de acceso

| # | Módulo | Estado |
|---|---|---|
| 1 | Autenticación | ✅ Implementado (matriz de 11 roles, bloqueo por intentos, 2FA/TOTP, recuperación de contraseña) |
| 2 | Auditoría | 🟡 Parcial (bitácora de movimientos de inventario + registro de importaciones) |
| 3 | CRM de clientes | ✅ Implementado (clientes, contactos, direcciones, interacciones, cartera y límite de crédito; listado con búsqueda y filtros, pantalla de contactos, avatar por cliente, tracking de visitas "Frecuentes" con reset semanal por ranking) |
| 4 | Pedidos | ✅ Implementado (pedidos versionados v1..vn, adjuntos, duplicar) |
| — | Cotizaciones | ✅ Implementado (cotizaciones con estado y conversión a pedido) |
| — | Facturación y pagos | ✅ Implementado (facturas desde pedido o sueltas, anulación, abonos, cartera) |

### Fase 2 (semanas 9-16) — Producción

| # | Módulo | Estado |
|---|---|---|
| 5 | Planeación | ❌ Pendiente |
| 6 | Órdenes de producción | ✅ Implementado (OP-00001, estado y paso por estación) |
| 7 | Extrusión | ✅ Implementado (registro de etapa en `production_stage_logs`) |
| 8 | Impresión | ✅ Implementado (registro de etapa) |
| 9 | Sellado | ✅ Implementado (registro de etapa) |
| 10 | Precorte | ✅ Implementado (registro de etapa + genera entrada de inventario al finalizar) |
| 11 | Trazabilidad básica | ❌ Pendiente |

### Fase 3 (semanas 17-20)

| # | Módulo | Estado |
|---|---|---|
| 12 | Calidad | ❌ Pendiente |
| 13 | Inventario | ✅ Implementado (stock por producto, categorías, alertas de mínimo) |
| 14 | Despachos | ✅ Implementado (crear despacho y marcar items → descuenta stock) |
| 15 | Almacén / WMS | ❌ Pendiente |
| 16 | Dashboard | 🟡 Parcial (dashboard de stock con alertas) |
| 17 | Exportaciones | ❌ Pendiente |

### Fase 4 (semanas 21-24)

| # | Módulo | Estado |
|---|---|---|
| 18 | Etiquetas térmicas | ❌ Pendiente |
| 19 | Escaneo QR / código de barras | ❌ Pendiente |
| 20 | Notificaciones | ❌ Pendiente |
| 21 | Pruebas finales y despliegue | ❌ Pendiente |

## Resumen de avance

| Estado | Cantidad |
|---|---|
| ✅ Implementado | 12 |
| 🟡 Parcial | 2 |
| ❌ Pendiente | 9 |

## Stack

El stack tecnológico completo (backend, base de datos, frontend, PWA) está detallado en [01 — Visión general](01-overview.md).

## Módulos ya documentados

La documentación técnica actual cubre parte de este plan:

| Documento | Cubre |
|---|---|
| [01 — Visión general](01-overview.md) | Estado actual de los módulos |
| [08 — Reglas de negocio](08-workflow.md) | Ciclo del stock, producción por estaciones, facturación y pagos |
| [09 — Guía de contribución](09-contributing.md) | Cómo agregar módulos nuevos (modelo + migración + endpoint + página) |