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
| 2 | Auditoría | ✅ Implementado (bitácora forense de create/update/delete en tablas críticas con diff antes/después, usuario, IP y user-agent) |
| 3 | CRM de clientes | ✅ Implementado (clientes con avatar y ranking "Frecuentes" en vivo, contactos y direcciones, historial de interacciones, cartera y límite de crédito; pantalla global de contactos; búsqueda y filtros por frecuencia) |
| 4 | Pedidos | ✅ Implementado (pedidos versionados v1..vn, adjuntos, duplicar) |
| — | Cotizaciones | ✅ Implementado (cotizaciones con estado y conversión a pedido) |
| — | Facturación y pagos | ✅ Implementado (facturas desde pedido o sueltas, anulación, abonos, cartera) |

### Fase 2 (semanas 9-16) — Producción

| # | Módulo | Estado |
|---|---|---|
| 5 | Planeación | ✅ Implementado (cola de ítems de pedidos aprobados/en producción sin OP y generación de OP desde cada ítem) |
| 6 | Órdenes de producción | ✅ Implementado (OP-00001, estado y paso por estación) |
| 7 | Extrusión | ✅ Implementado (registro de etapa en `production_stage_logs`) |
| 8 | Impresión | ✅ Implementado (registro de etapa) |
| 9 | Sellado | ✅ Implementado (registro de etapa) |
| 10 | Precorte | ✅ Implementado (registro de etapa; deja la OP `pendiente_calidad` — la entrada de inventario la genera Calidad al aprobar) |
| 11 | Trazabilidad básica | ✅ Implementado (historial completo de la OP: pasos por estación, resultado de Calidad y pedido/cliente de origen) |

### Fase 3 (semanas 17-20)

| # | Módulo | Estado |
|---|---|---|
| 12 | Calidad | ✅ Implementado (control de calidad por lote: aprueba y genera la entrada de inventario, o rechaza y deja la OP `detenida`) |
| 13 | Inventario | ✅ Implementado (stock por producto, categorías, alertas de mínimo) |
| 14 | Despachos | ✅ Implementado (crear despacho y marcar ítems → descuenta stock) |
| 15 | Almacén / WMS | ✅ Implementado (ubicaciones de bodega, stock por ubicación complementario a `InventoryStock`, asignación de cantidades, QR imprimible por ubicación con acceso público sin login) |
| 16 | Dashboard | ✅ Implementado (dashboard ejecutivo: ventas 6 meses, comparativa mensual, cartera pendiente, top clientes; dashboard de indicadores: tasa de aprobación de calidad, tiempo promedio de producción, top productos despachados) |
| 17 | Exportaciones | ✅ Implementado (Excel con estilo de marca para inventario, pedidos, facturas y clientes) |

### Fase 4 (semanas 21-24)

| # | Módulo | Estado |
|---|---|---|
| 18 | Etiquetas térmicas | ✅ Implementado (impresión de etiquetas con QR desde el navegador, en Productos; no es integración con hardware de impresora térmica específico) |
| 19 | Escaneo QR / código de barras | ✅ Implementado (escaneo por cámara del navegador: producto en Despachos y Almacén, OP en la estación de producción, ubicación de bodega en Almacén) |
| 20 | Notificaciones | ✅ Implementado (notificaciones in-app; hoy solo dos disparadores: OP lista para calidad y OP rechazada en calidad) |
| 21 | Pruebas finales y despliegue | ❌ Pendiente |

## Resumen de avance

| Estado | Cantidad |
|---|---|
| ✅ Implementado | 20 |
| 🟡 Parcial | 0 |
| ❌ Pendiente | 1 |

## Stack

El stack tecnológico completo (backend, base de datos, frontend, PWA) está detallado en [01 — Visión general](01-overview.md).

## Módulos ya documentados

La documentación técnica actual cubre parte de este plan:

| Documento | Cubre |
|---|---|
| [01 — Visión general](01-overview.md) | Estado actual de los módulos |
| [08 — Reglas de negocio](08-workflow.md) | Ciclo del stock, producción por estaciones, facturación y pagos |
| [09 — Guía de contribución](09-contributing.md) | Cómo agregar módulos nuevos (modelo + migración + endpoint + página) |