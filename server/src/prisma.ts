import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { withAudit } from "./services/auditExtension";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const basePrisma = new PrismaClient({ adapter });

export const prisma = withAudit(basePrisma);
