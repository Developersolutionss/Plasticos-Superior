import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { authRouter } from "./routes/auth";
import { clientsRouter } from "./routes/clients";
import { inventoryRouter } from "./routes/inventory";
import { productionRouter } from "./routes/production";
import { productionOrdersRouter } from "./routes/productionOrders";
import { dispatchesRouter } from "./routes/dispatches";
import { cotizacionesRouter } from "./routes/cotizaciones";
import { pedidosRouter } from "./routes/pedidos";
import { facturasRouter } from "./routes/facturas";
import { whatsappWebhookRouter } from "./routes/whatsappWebhook";
import { auditLogRouter } from "./routes/auditLog";
import { warehouseRouter } from "./routes/warehouse";
import { publicLocationRouter } from "./routes/publicLocation";
import { scheduleFrecuentesReset } from "./services/frecuentesReset";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Archivos subidos (avatars de clientes, adjuntos de pedidos, etc.). Sin
// autenticación: son recursos públicos que el navegador pide directo en
// <img src="/api/uploads/...">. En dev lo proxea Vite, en prod el servidor
// estático debe reenviar /api/* a la API.
app.use("/api/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/production", productionRouter);
app.use("/api/production-orders", productionOrdersRouter);
app.use("/api/dispatches", dispatchesRouter);
app.use("/api/cotizaciones", cotizacionesRouter);
app.use("/api/pedidos", pedidosRouter);
app.use("/api/facturas", facturasRouter);
app.use("/api/audit-log", auditLogRouter);
app.use("/api/warehouse", warehouseRouter);
// A propósito sin requireAuth — ver publicLocation.ts.
app.use("/api/public/locations", publicLocationRouter);
app.use("/webhook/whatsapp", whatsappWebhookRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});

// Reset semanal del contador de visitas de clientes ("Frecuentes").
scheduleFrecuentesReset();
