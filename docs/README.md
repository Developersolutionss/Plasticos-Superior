# Documentación del Proyecto — Inventario y Despachos

Esta es la documentación técnica del sistema de control de inventario, producción y despachos de Plásticos Superior SAS.

## Índice

| Doc | Contenido | Audiencia |
|---|---|---|
| [00 — Hoja de ruta del producto](00-roadmap.md) | Visión del sistema objetivo (ERP/MES). Módulos en 4 fases. Estado real vs planificado. | Todos |
| [01 — Visión general](01-overview.md) | Qué resuelve el sistema. Stack tecnológico. Módulos, actores y matriz de 11 roles. | Todos |
| [02 — Puesta en marcha](02-setup.md) | Requisitos. Instalación. Desarrollo. Migración. Seed. Build de producción. | Devs nuevos |
| [03 — Arquitectura y comunicación](03-architecture.md) | Cómo se comunican las partes. Proxy de Vite. JWT. Flujo de una petición. PWA. | Devs |
| [04 — Base de datos](04-database.md) | Esquema Prisma. Modelos. Relaciones. Enums. Convenciones. Migraciones. | Devs |
| [05 — API](05-api.md) | Endpoints. Autenticación. Permisos por rol. Formato de errores. Ejemplos con `curl`. | Devs / QA |
| [06 — Backend](06-backend.md) | Estructura del servidor. Patrón router→zod→prisma. Servicios. Transacciones. | Devs |
| [07 — Frontend](07-frontend.md) | Estructura del cliente. Páginas. Helper de API. TanStack Query. Menú e íconos. Roles. | Devs |
| [08 — Reglas de negocio](08-workflow.md) | Ciclo del stock. Producción → OP/estaciones → inventario → despacho. Facturación y pagos. | Devs / Producto |
| [09 — Guía de contribución](09-contributing.md) | Cómo agregar un modelo, un endpoint y una página. Pasos detallados. | Devs |

## Cómo leer esta documentación

Siga esta secuencia según su objetivo:

- **Primera vez en el proyecto**: lea 01 y 02.
- **Necesita entender el código**: lea 03 → 04 → 05 → 06 → 07.
- **Quiere aportar código**: lea todo lo anterior. Termine con 09.

## Referencias rápidas

- Backend (dev): `http://localhost:4000` · Health check: `GET /health`
- Frontend (dev): `http://localhost:5173`
- Base de datos: PostgreSQL 16 en Docker (`localhost:5432`, contenedor `db`)
- Usuarios de prueba (seed): uno por rol de la matriz completa — `admin@empresa.com` (`super_admin`), `produccion@empresa.com`, `despacho@empresa.com`, `ventas@empresa.com`, … — contraseña `password123`. Tabla completa en [02 — Puesta en marcha](02-setup.md)
