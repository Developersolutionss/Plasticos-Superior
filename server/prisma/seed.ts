import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  await prisma.user.createMany({
    data: [
      { name: "Admin", email: "admin@empresa.com", passwordHash, role: "admin" },
      { name: "Operario Producción", email: "produccion@empresa.com", passwordHash, role: "produccion" },
      { name: "Encargado Despacho", email: "despacho@empresa.com", passwordHash, role: "despacho" },
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

  console.log("Seed completado. Usuarios: admin@empresa.com / produccion@empresa.com / despacho@empresa.com (password123)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
