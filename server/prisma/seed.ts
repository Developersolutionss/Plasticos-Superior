import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
// Usa el mismo cliente auditado que la app (../src/prisma.ts) en vez de uno
// propio, para que los Client que crea este seed generen entradas reales de
// auditoría — así el módulo de Auditoría no queda vacío en la primera corrida.
import { prisma } from "../src/prisma";
import { applyMovement, incrementLocationStock } from "../src/services/stockService";
import { applyRawMaterialMovement } from "../src/services/rawMaterialStockService";

/** `station`/`stationSequence` son NOT NULL en ProductionRoll (numeración
 * propia por estación, ver migración roll_per_station_numbering) -- el seed
 * los arma a mano igual que el endpoint real (máximo ya usado + 1), para no
 * pisar una fila real si el seed corre sobre una base que ya tiene datos. */
async function nextSeedStationSequence(station: string): Promise<number> {
  const max = await prisma.productionRoll.aggregate({ where: { station: station as any }, _max: { stationSequence: true } });
  return (max._max.stationSequence ?? 0) + 1;
}

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  // Un usuario de ejemplo por rol de la matriz completa (Módulo 1), para
  // poder probar permisos de cada uno. Los 3 primeros son los históricos
  // (ya migrados de admin/produccion/despacho por la migración de roles).
  await prisma.user.createMany({
    data: [
      { name: "Admin", email: "admin@empresa.com", passwordHash, role: "super_admin" },
      { name: "Gerente de Producción", email: "produccion@empresa.com", passwordHash, role: "gerente_produccion" },
      { name: "Encargado Despacho", email: "despacho@empresa.com", passwordHash, role: "almacen_despachos" },
      { name: "Administrador", email: "administrador@empresa.com", passwordHash, role: "admin" },
      { name: "Planeación", email: "planeacion@empresa.com", passwordHash, role: "planeacion" },
      { name: "Ventas", email: "ventas@empresa.com", passwordHash, role: "ventas_pedidos" },
      { name: "Operario Extrusión", email: "operario.extrusion@empresa.com", passwordHash, role: "operario_extrusion" },
      { name: "Operario Impresión", email: "operario.impresion@empresa.com", passwordHash, role: "operario_impresion" },
      { name: "Operario Sellado", email: "operario.sellado@empresa.com", passwordHash, role: "operario_sellado" },
      { name: "Operario Precorte", email: "operario.precorte@empresa.com", passwordHash, role: "operario_precorte" },
      { name: "Calidad", email: "calidad@empresa.com", passwordHash, role: "calidad" },
      { name: "Auditor", email: "auditor@empresa.com", passwordHash, role: "auditor" },
    ],
    skipDuplicates: true,
  });

  const products = [
    {
      sku: "BUL-001",
      name: "Bulto 25kg Tipo A",
      category: "bultos",
      measure: "25kg",
      measureUnit: "Cms.",
      talla: "L",
      color: "Negro",
      densidad: "ALTA",
      calibre: "0.45",
      unit: "unidad",
      minStock: 50,
      unitPrice: 12000,
    },
    {
      sku: "ROL-PL-001",
      name: "Rollo Precintado/Laminado 20x30",
      category: "rollos_prec_lam",
      measure: "20x30",
      measureUnit: "Cms.",
      color: "Transparente",
      densidad: "BAJA",
      medidaRef: "Ref-20x30",
      unit: "kg",
      minStock: 100,
      unitPrice: 8500,
    },
    { sku: "ROL-F-001", name: "Rollo Fuelle 15x40", category: "rollos_fuelle", measure: "15x40", unit: "kg", minStock: 80, unitPrice: 9200 },
    { sku: "MAN-001", name: "Mangueta Estándar", category: "mangueta", measure: "30cm", unit: "kg", minStock: 60, unitPrice: 7000 },
    { sku: "TIR-001", name: "Tiras 5cm", category: "tiras", measure: "5cm", unit: "kg", minStock: 40, unitPrice: 5000 },
    { sku: "CTL-001", name: "Control Impresión Etiqueta A", category: "control_impresion", measure: "10x10", unit: "unidad", minStock: 200, unitPrice: 300 },
  ] as const;

  for (const product of products) {
    const { sku, unitPrice, ...attrs } = product;
    await prisma.product.upsert({
      where: { sku },
      update: { unitPrice, active: true, ...attrs },
      create: product as any,
    });
  }

  // `Client.name` no tiene unique constraint a nivel de base de datos (dos
  // clientes reales podrían coincidir en nombre), así que acá NO se puede
  // usar createMany+skipDuplicates para evitar duplicados — hay que buscar
  // primero. Si corrés el seed varias veces, esto no vuelve a crearlos.
  for (const name of ["Cliente ACME", "Distribuidora Norte"]) {
    const existing = await prisma.client.findFirst({ where: { name } });
    if (!existing) await prisma.client.create({ data: { name } });
  }

  const acme = await prisma.client.findFirst({ where: { name: "Cliente ACME" } });
  if (acme) {
    await prisma.client.update({ where: { id: acme.id }, data: { creditLimit: 5000000 } });

    const existingContacts = await prisma.clientContact.count({ where: { clientId: acme.id } });
    if (existingContacts === 0) {
      await prisma.clientContact.createMany({
        data: [
          { clientId: acme.id, name: "María López", position: "Jefe de Compras", phone: "3001234567", email: "maria@acme.com", isPrimary: true },
          { clientId: acme.id, name: "Carlos Pérez", position: "Logística", phone: "3107654321", email: "carlos@acme.com", isPrimary: false },
        ],
      });
    }

    const existingAddresses = await prisma.clientAddress.count({ where: { clientId: acme.id } });
    if (existingAddresses === 0) {
      await prisma.clientAddress.create({
        data: {
          clientId: acme.id,
          label: "Bodega Principal",
          addressLine: "Cra 45 #12-30",
          city: "Medellín",
          region: "Antioquia",
          isPrimary: true,
        },
      });
    }

    // Producto cargado a mano (aparte de los que salen solos por historial de
    // pedidos, ver GET /:id/top-products) -- MAN-001 a propósito no aparece
    // en ningún pedido demo, para que se vea claro que es una sección
    // distinta en la pestaña "Productos" del cliente.
    const mangueta = await prisma.product.findFirst({ where: { sku: "MAN-001" } });
    if (mangueta) {
      const admin = await prisma.user.findUnique({ where: { email: "administrador@empresa.com" } });
      await prisma.clientManualProduct.upsert({
        where: { clientId_productId: { clientId: acme.id, productId: mangueta.id } },
        create: {
          clientId: acme.id,
          productId: mangueta.id,
          quantity: 50,
          notes: "Lo pedía antes de este sistema",
          createdById: admin?.id,
        },
        update: {},
      });
    }
  }

  // Pedido demo ya aprobado y sin OP generada, para poder probar el módulo
  // de Planeación apenas se entra al sistema (aparece en la cola de
  // pendientes). orderNumber fijo (no sigue el patrón PED-00001 que genera
  // la app) para poder chequear existencia de forma idempotente sin pisar
  // la numeración real de pedidos creados por Ventas.
  const norte = await prisma.client.findFirst({ where: { name: "Distribuidora Norte" } });
  const bulto = await prisma.product.findFirst({ where: { sku: "BUL-001" } });
  const rollo = await prisma.product.findFirst({ where: { sku: "ROL-PL-001" } });
  if (norte && bulto && rollo) {
    const existingSeedPedido = await prisma.pedido.findUnique({ where: { orderNumber: "PED-SEED-PLANEACION" } });
    if (!existingSeedPedido) {
      await prisma.pedido.create({
        data: {
          orderNumber: "PED-SEED-PLANEACION",
          clientId: norte.id,
          status: "aprobado",
          currentVersion: 1,
          versions: {
            create: {
              versionNumber: 1,
              status: "aprobado",
              notes: "Pedido demo para probar el módulo de Planeación",
              items: {
                create: [
                  { productId: bulto.id, quantity: 40, unitPrice: bulto.unitPrice, measure: bulto.measure },
                  { productId: rollo.id, quantity: 25, unitPrice: rollo.unitPrice, measure: rollo.measure },
                ],
              },
            },
          },
        },
      });
    }

    // Un segundo pedido demo repitiendo el bulto (distinta cantidad, sin el
    // rollo) para que "Productos que más pide" tenga algo real que mostrar
    // apenas se entra al sistema: bulto queda con frecuencia 2, rollo con 1.
    const existingSeedPedido2 = await prisma.pedido.findUnique({ where: { orderNumber: "PED-SEED-TOP-PRODUCTOS" } });
    if (!existingSeedPedido2) {
      await prisma.pedido.create({
        data: {
          orderNumber: "PED-SEED-TOP-PRODUCTOS",
          clientId: norte.id,
          status: "aprobado",
          currentVersion: 1,
          versions: {
            create: {
              versionNumber: 1,
              status: "aprobado",
              notes: "Segundo pedido demo, mismo cliente, para poblar productos que más pide",
              items: {
                create: [{ productId: bulto.id, quantity: 20, unitPrice: bulto.unitPrice, measure: bulto.measure }],
              },
            },
          },
        },
      });
    }
  }

  // Cadena demo de OPs por proceso (modelo nuevo: una OP por estación con
  // derivaciones): Extrusión finalizada → deriva en una de Sellado en
  // pendiente_calidad (para que la cola de Calidad no esté vacía) y una de
  // Impresión en proceso (para ver la derivación con dos hijas). orderNumber
  // fijo (mismo criterio que PED-SEED-PLANEACION) para poder chequear
  // existencia sin pisar la numeración real OP-00001, OP-00002... de la app.
  if (bulto && acme) {
    const existingSeedExtrusion = await prisma.productionOrder.findFirst({
      where: { orderNumber: "OP-SEED-EXTRUSION" },
    });
    if (!existingSeedExtrusion) {
      const extrusionSeq = await nextSeedStationSequence("extrusion");
      const extrusionOp = await prisma.productionOrder.create({
        data: {
          orderNumber: "OP-SEED-EXTRUSION",
          station: "extrusion",
          productId: bulto.id,
          clientId: acme.id,
          quantityPlanned: 100,
          measure: bulto.measure,
          status: "finalizada",
          specs: {
            formaMaterial: "Tubular",
            materialPara: "SELLADO",
            materiaPrima: [
              { ref: "ALTA", pct: 69, lote: "L-2301" },
              { ref: "LINEAL", pct: 30, lote: "L-2302" },
              { ref: "BIODEGRADABLE", pct: 1, lote: "L-2303" },
            ],
            ancho: "14",
            anchoUnidad: "Pulgadas",
            calibre: "0.45",
            densidad: "ALTA",
            color: "TRANSP",
            tratado: "NO",
            grafilado: "NO",
            maquina: "Extrusora 1",
            observaciones: "Por favor bien calibrados - no arrugados",
          },
          rolls: {
            create: [
              {
                station: "extrusion",
                stationSequence: extrusionSeq,
                shift: "Turno 1",
                operatorName: "Operario Demo",
                machine: "1",
                label: "R-001",
                weightKg: 48,
                wasteKg: 1.5,
                details: { pResistencia: "SI", pTratado: "NO" },
              },
              {
                station: "extrusion",
                stationSequence: extrusionSeq + 1,
                shift: "Turno 2",
                operatorName: "Operaria Demo 2",
                machine: "1",
                label: "R-002",
                weightKg: 52,
                wasteKg: 0.8,
                details: { pResistencia: "SI", pTratado: "NO" },
              },
            ],
          },
        },
      });

      const selladoSeq = await nextSeedStationSequence("sellado");
      await prisma.productionOrder.create({
        data: {
          orderNumber: "OP-SEED-CALIDAD",
          station: "sellado",
          productId: bulto.id,
          clientId: acme.id,
          quantityPlanned: 30,
          measure: bulto.measure,
          status: "pendiente_calidad",
          parentOrderId: extrusionOp.id,
          specs: { tipoMaterial: "Tubular", materialDensidad: "ALTA", medidasUnidad: "Pulgadas", medAncho: "14", medLargo: "20" },
          rolls: {
            create: [
              {
                station: "sellado",
                stationSequence: selladoSeq,
                shift: "Turno 1",
                operatorName: "Operario Demo",
                machine: "Selladora 1",
                label: "B-001",
                weightKg: 30,
                details: { eBulto: "B-001", pBulto: 30, paqXUnid: "20x100", pResistencia: "SI" },
                notes: "Bulto demo para probar el módulo de Calidad",
              },
            ],
          },
        },
      });

      const impresionSeq = await nextSeedStationSequence("impresion");
      await prisma.productionOrder.create({
        data: {
          orderNumber: "OP-SEED-IMPRESION",
          station: "impresion",
          productId: bulto.id,
          clientId: acme.id,
          quantityPlanned: 40,
          measure: bulto.measure,
          status: "en_proceso",
          parentOrderId: extrusionOp.id,
          specs: {
            tipoMaterial: "Tubular",
            repeticionesAlAncho: "2",
            coloresCara1: [
              { unidad: 1, color: "Azul pantone 2935", lote: "T-101" },
              { unidad: 2, color: "Blanco", lote: "T-102" },
            ],
          },
          rolls: {
            create: [
              {
                station: "impresion",
                stationSequence: impresionSeq,
                shift: "Turno 1",
                operatorName: "Operario Demo",
                machine: "Flexo 1",
                label: "RI-001",
                weightKg: 18,
                details: { etiquetaExt: "R-001", pesoExt: 20, pDesprendimiento: "SI" },
              },
            ],
          },
        },
      });
    }

    // OP en "borrador": Gestión la está armando (specs a medio cargar, sin
    // rollos) y todavía no la liberó a planta — para que se vea el estado
    // nuevo en el listado de Gestión y confirmar que NO aparece en la cola
    // del operario de Extrusión hasta que se libere. Guard propio (no el de
    // OP-SEED-EXTRUSION de arriba) para que también se cree en bases donde
    // ya existía la cadena vieja antes de este cambio.
    const existingSeedBorrador = await prisma.productionOrder.findFirst({ where: { orderNumber: "OP-SEED-BORRADOR" } });
    if (!existingSeedBorrador) {
      await prisma.productionOrder.create({
        data: {
          orderNumber: "OP-SEED-BORRADOR",
          station: "extrusion",
          productId: bulto.id,
          clientId: acme.id,
          quantityPlanned: 60,
          measure: bulto.measure,
          status: "borrador",
          specs: { formaMaterial: "Tubular", materiaPrima: [{ ref: "ALTA", pct: 100, kg: 30 }] },
        },
      });
    }

    // OP recién creada, todavía SIN proceso asignado (station null) — así lo
    // pidió el cliente: se crea "en blanco" y Gestión la deriva a Extrusión
    // como primer paso explícito (POST /:id/derive), en vez de nacer ya
    // asignada. Sirve para ver ese estado en el listado sin tener que crear
    // una OP a mano.
    const existingSeedSinProceso = await prisma.productionOrder.findFirst({ where: { orderNumber: "OP-SEED-SIN-PROCESO" } });
    if (!existingSeedSinProceso) {
      await prisma.productionOrder.create({
        data: {
          orderNumber: "OP-SEED-SIN-PROCESO",
          station: null,
          productId: bulto.id,
          clientId: acme.id,
          quantityPlanned: 40,
          measure: bulto.measure,
          status: "borrador",
        },
      });
    }
  }

  // Catálogo de materia prima (las 10 refs fijas del formato F-OP-01 de
  // Extrusión) + stock inicial, para que el módulo de Inventario > Materia
  // Prima no esté vacío al entrar. Idempotente por `code` (único).
  const rawMaterialsDemo = [
    { code: "BAJA", minStock: 50, stock: 200 },
    { code: "ALTA", minStock: 100, stock: 1500 },
    { code: "BIODEGRADABLE", minStock: 20, stock: 80 },
    { code: "LINEAL", minStock: 50, stock: 600 },
    { code: "PIGMENTO", minStock: 5, stock: 15 },
    { code: "TERMO", minStock: 5, stock: 10 },
    { code: "SECANTE", minStock: 5, stock: 12 },
    { code: "ANTIBLOCK", minStock: 5, stock: 8 },
    { code: "AGLUTINADO", minStock: 10, stock: 30 },
    { code: "PELETIZADO", minStock: 10, stock: 25 },
  ];
  for (const rm of rawMaterialsDemo) {
    const material = await prisma.rawMaterial.upsert({
      where: { code: rm.code },
      update: {},
      create: { code: rm.code, minStock: rm.minStock },
    });
    // Antes esto escribía currentQuantity directo, sin ningún movimiento
    // que lo respalde -- el historial de materia prima quedaba vacío pero
    // el stock no, así que nunca cuadraba contra la suma de movimientos
    // reales (ver auditoría de inventario). Se registra como una compra
    // real, y solo la primera vez (si ya existe la fila, no se vuelve a
    // sumar en cada corrida del seed).
    const existingStock = await prisma.rawMaterialStock.findUnique({ where: { rawMaterialId: material.id } });
    if (!existingStock) {
      await prisma.$transaction((tx) =>
        applyRawMaterialMovement(tx, {
          rawMaterialId: material.id,
          quantity: rm.stock,
          movementType: "compra",
          referenceType: "manual_adjustment",
          notes: "Stock inicial demo (seed)",
        })
      );
    }
  }

  // Ubicaciones demo de bodega + un poco de stock ya repartido entre ellas,
  // para que el módulo de Almacén no esté vacío al entrar. Idempotente por
  // `code` (único): si ya existen, no se tocan ni se duplica el stock.
  const demoLocations = [
    { code: "A-1", label: "Bodega A - Estante 1" },
    { code: "A-2", label: "Bodega A - Estante 2" },
    { code: "B-1", label: "Bodega B - Refrigerado" },
  ];
  for (const loc of demoLocations) {
    await prisma.warehouseLocation.upsert({
      where: { code: loc.code },
      update: {},
      create: { ...loc, publicToken: randomBytes(16).toString("hex") },
    });
  }
  const a1 = await prisma.warehouseLocation.findUnique({ where: { code: "A-1" } });
  const a2 = await prisma.warehouseLocation.findUnique({ where: { code: "A-2" } });
  if (a1 && a2 && bulto && rollo) {
    // Antes esto solo escribía StockLocation directo, sin sumarle nada a
    // InventoryStock -- el producto podía terminar con MENOS stock total
    // que lo que sus propias ubicaciones decían tener ("sin ubicar"
    // negativo desde la primera corrida). Ahora cada asignación demo entra
    // primero como una entrada real al total agregado (misma transacción),
    // y solo la primera vez.
    const demoLocationAssignments = [
      { product: bulto, location: a1, quantity: 30 },
      { product: rollo, location: a2, quantity: 20 },
    ];
    for (const { product, location, quantity } of demoLocationAssignments) {
      const existing = await prisma.stockLocation.findUnique({
        where: { productId_locationId: { productId: product.id, locationId: location.id } },
      });
      if (existing) continue;
      await prisma.$transaction(async (tx) => {
        await applyMovement(tx, {
          productId: product.id,
          quantity,
          movementType: "entrada_produccion",
          referenceType: "manual_adjustment",
        });
        await incrementLocationStock(tx, product.id, location.id, quantity);
      });
    }
  }

  const adminUser = await prisma.user.findUnique({ where: { email: "admin@empresa.com" } });

  // Etiquetas de bulto demo: unas disponibles para probar el escaneo en
  // Sellado sin tener que generarlas a mano primero. Idempotente por
  // `code` (único).
  const bultoLabelCodes = ["EXT-00001", "EXT-00002", "EXT-00003"];
  for (const code of bultoLabelCodes) {
    await prisma.bultoLabel.upsert({
      where: { code },
      update: {},
      create: { code, createdById: adminUser?.id },
    });
  }

  // Movimiento de inventario demo (ajuste manual), para que el módulo de
  // Movimientos tenga un ejemplo de cada tipo. Idempotente por su propio
  // tipo+referencia (no por "¿hay algún movimiento?" en general -- las
  // entradas de las ubicaciones demo, arriba, ya dejan movimientos propios
  // antes de llegar acá, así que ese conteo global siempre daría > 0 y este
  // ajuste nunca se llegaría a crear).
  const existingAdjustment = await prisma.inventoryMovement.findFirst({
    where: { movementType: "ajuste", referenceType: "manual_adjustment", referenceId: null },
  });
  if (!existingAdjustment && bulto) {
    await prisma.$transaction((tx) =>
      applyMovement(tx, {
        productId: bulto.id,
        quantity: 20,
        movementType: "ajuste",
        referenceType: "manual_adjustment",
        createdById: adminUser?.id,
      })
    );
  }

  // 2 OPs demo ya cerradas con su control de calidad (una aprobada, otra
  // rechazada), para que el módulo de Indicadores no esté vacío al entrar.
  // Idempotente por `orderNumber` fijo, mismo criterio que OP-SEED-CALIDAD.
  if (bulto) {
    const qualitySeedOps = [
      { orderNumber: "OP-SEED-INDICADORES-1", result: "aprobado" as const },
      { orderNumber: "OP-SEED-INDICADORES-2", result: "rechazado" as const },
    ];
    for (const seedOp of qualitySeedOps) {
      const existing = await prisma.productionOrder.findFirst({ where: { orderNumber: seedOp.orderNumber } });
      if (existing) continue;

      const precorteSeq = await nextSeedStationSequence("precorte");
      const op = await prisma.productionOrder.create({
        data: {
          orderNumber: seedOp.orderNumber,
          station: "precorte",
          productId: bulto.id,
          quantityPlanned: 15,
          measure: bulto.measure,
          status: seedOp.result === "aprobado" ? "finalizada" : "detenida",
          rolls: {
            create: {
              station: "precorte",
              stationSequence: precorteSeq,
              date: new Date(Date.now() - 2 * 60 * 60 * 1000),
              machine: "Cortadora 1",
              operatorName: "Operario Demo",
              weightKg: 15,
              notes: "Rollo de precorte demo para probar el módulo de Indicadores",
            },
          },
        },
      });
      // Una OP "aprobada" real suma sus kg a inventario al aprobarse (ver
      // POST /:id/quality-check) -- acá se creaba el qualityCheck directo,
      // sin ese movimiento, dejando la OP diciendo "aprobado" con 15kg
      // producidos pero sin que esos kg existieran en ningún lado.
      await prisma.$transaction(async (tx) => {
        const check = await tx.qualityCheck.create({
          data: { productionOrderId: op.id, result: seedOp.result, observations: "Control de calidad demo" },
        });
        if (seedOp.result === "aprobado") {
          await applyMovement(tx, {
            productId: bulto.id,
            quantity: 15,
            movementType: "entrada_produccion",
            referenceType: "manual_adjustment",
            referenceId: check.id,
          });
        }
      });
    }
  }

  // Despacho demo ya completado, para que el ranking de "Top productos
  // despachados" de Indicadores tenga datos. Idempotente por un marcador
  // fijo en las notas del ítem (Dispatch no tiene un campo único propio).
  const DISPATCH_SEED_MARKER = "Despacho demo (seed)";
  if (acme && bulto) {
    const existingSeedDispatchItem = await prisma.dispatchItem.findFirst({ where: { notes: DISPATCH_SEED_MARKER } });
    if (!existingSeedDispatchItem) {
      // Un despacho completado de verdad descuenta stock al marcarse (ver
      // PATCH /:dispatchId/items/:itemId) -- acá se creaba con
      // quantityDispatched ya cargado directo, sin ese movimiento, así que
      // el "despacho" nunca salió de ningún lado según el ledger.
      await prisma.$transaction(async (tx) => {
        const dispatch = await tx.dispatch.create({
          data: {
            clientId: acme.id,
            status: "despachado",
            dispatchedDate: new Date(),
            items: {
              create: [{ productId: bulto.id, quantityRequested: 12, quantityDispatched: 12, notes: DISPATCH_SEED_MARKER }],
            },
          },
          include: { items: true },
        });
        await applyMovement(tx, {
          productId: bulto.id,
          quantity: -12,
          movementType: "salida_despacho",
          referenceType: "dispatch_item",
          referenceId: dispatch.items[0].id,
        });
      });
    }
  }

  // Notificación demo para el admin, para que la campana no esté vacía al
  // entrar. Idempotente por `type` fijo.
  if (adminUser) {
    const existingSeedNotif = await prisma.notification.findFirst({ where: { userId: adminUser.id, type: "seed_demo" } });
    if (!existingSeedNotif) {
      await prisma.notification.create({
        data: {
          userId: adminUser.id,
          type: "seed_demo",
          message: "OP-SEED-CALIDAD está pendiente de revisión de calidad",
          link: "/calidad",
        },
      });
    }
  }

  console.log(
    "Seed completado. Usuarios (password123 para todos): admin@empresa.com (super_admin), " +
      "administrador@empresa.com (admin), produccion@empresa.com (gerente_produccion), " +
      "planeacion@empresa.com, ventas@empresa.com (ventas_pedidos), despacho@empresa.com (almacen_despachos), " +
      "operario.extrusion@empresa.com, operario.impresion@empresa.com, operario.sellado@empresa.com, " +
      "operario.precorte@empresa.com, calidad@empresa.com, auditor@empresa.com"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
