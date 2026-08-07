import "dotenv/config";
import express from "express";
import cors from "cors";
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

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/production", productionRouter);
app.use("/api/production-orders", productionOrdersRouter);
app.use("/api/dispatches", dispatchesRouter);
app.use("/api/cotizaciones", cotizacionesRouter);
app.use("/api/pedidos", pedidosRouter);
app.use("/api/facturas", facturasRouter);
app.use("/webhook/whatsapp", whatsappWebhookRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
