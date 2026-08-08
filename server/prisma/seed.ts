import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

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
      { name: "Operario Sellado/Precorte", email: "operario.sellado@empresa.com", passwordHash, role: "operario_sellado_precorte" },
      { name: "Calidad", email: "calidad@empresa.com", passwordHash, role: "calidad" },
      { name: "Auditor", email: "auditor@empresa.com", passwordHash, role: "auditor" },
    ],
    skipDuplicates: true,
  });

  const products = [
    { sku: "BUL-001", name: "Bulto 25kg Tipo A", category: "bultos", measure: "25kg", unit: "unidad", minStock: 50, unitPrice: 12000 },
    { sku: "ROL-PL-001", name: "Rollo Precintado/Laminado 20x30", category: "rollos_prec_lam", measure: "20x30", unit: "kg", minStock: 100, unitPrice: 8500 },
    { sku: "ROL-F-001", name: "Rollo Fuelle 15x40", category: "rollos_fuelle", measure: "15x40", unit: "kg", minStock: 80, unitPrice: 9200 },
    { sku: "MAN-001", name: "Mangueta Estándar", category: "mangueta", measure: "30cm", unit: "kg", minStock: 60, unitPrice: 7000 },
    { sku: "TIR-001", name: "Tiras 5cm", category: "tiras", measure: "5cm", unit: "kg", minStock: 40, unitPrice: 5000 },
    { sku: "CTL-001", name: "Control Impresión Etiqueta A", category: "control_impresion", measure: "10x10", unit: "unidad", minStock: 200, unitPrice: 300 },
  ] as const;

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: { unitPrice: product.unitPrice },
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
  }

  console.log(
    "Seed completado. Usuarios (password123 para todos): admin@empresa.com (super_admin), " +
      "administrador@empresa.com (admin), produccion@empresa.com (gerente_produccion), " +
      "planeacion@empresa.com, ventas@empresa.com (ventas_pedidos), despacho@empresa.com (almacen_despachos), " +
      "operario.extrusion@empresa.com, operario.impresion@empresa.com, operario.sellado@empresa.com, " +
      "calidad@empresa.com, auditor@empresa.com"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
