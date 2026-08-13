import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.use(requireRole(...ROLES.ADMIN));

/**
 * Resumen ejecutivo: unos pocos KPIs de venta/cartera/producción calculados
 * con consultas propias (no reusa clients.ts/facturas.ts) para no arriesgar
 * esa lógica ya en producción — es la misma cuenta "total - pagado" de
 * siempre, repetirla acá es más simple que refactorizar los otros routers.
 */
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

dashboardRouter.get("/resumen", async (_req, res) => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthsBack = 5;
  const chartStart = new Date(startOfMonth);
  chartStart.setMonth(chartStart.getMonth() - monthsBack);

  const [facturasUltimos6Meses, todasLasFacturas, opsEnCurso, pedidosEnProduccion, cotizacionesAbiertas] = await Promise.all([
    prisma.factura.findMany({
      where: { status: { not: "anulada" }, createdAt: { gte: chartStart } },
      include: { items: true },
    }),
    prisma.factura.findMany({
      where: { status: { not: "anulada" } },
      include: { items: true, payments: true, client: { select: { id: true, name: true } } },
    }),
    prisma.productionOrder.count({ where: { status: { in: ["pendiente", "en_proceso", "pendiente_calidad"] } } }),
    prisma.pedido.count({ where: { status: "en_produccion" } }),
    prisma.cotizacion.count({ where: { status: { in: ["borrador", "enviada"] } } }),
  ]);

  const ventasPorMes = new Map<string, number>();
  for (const f of facturasUltimos6Meses) {
    const total = f.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
    const key = monthKey(f.createdAt);
    ventasPorMes.set(key, (ventasPorMes.get(key) ?? 0) + total);
  }

  const ventasUltimos6Meses: { mes: string; total: number }[] = [];
  for (let i = monthsBack; i >= 0; i--) {
    const d = new Date(startOfMonth);
    d.setMonth(d.getMonth() - i);
    const key = monthKey(d);
    ventasUltimos6Meses.push({ mes: key, total: ventasPorMes.get(key) ?? 0 });
  }

  const ventasDelMes = ventasUltimos6Meses[ventasUltimos6Meses.length - 1].total;
  const ventasMesAnterior = ventasUltimos6Meses[ventasUltimos6Meses.length - 2]?.total ?? 0;
  const cambioVentasPct = ventasMesAnterior > 0 ? ((ventasDelMes - ventasMesAnterior) / ventasMesAnterior) * 100 : null;

  const saldoPorCliente = new Map<number, { name: string; saldo: number }>();
  let carteraPendiente = 0;
  let facturasConSaldo = 0;

  for (const f of todasLasFacturas) {
    const total = f.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
    const paid = f.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const saldo = total - paid;
    if (saldo > 0) {
      carteraPendiente += saldo;
      facturasConSaldo += 1;
      const prev = saldoPorCliente.get(f.client.id);
      saldoPorCliente.set(f.client.id, { name: f.client.name, saldo: (prev?.saldo ?? 0) + saldo });
    }
  }

  const topClientesSaldo = [...saldoPorCliente.entries()]
    .map(([clientId, v]) => ({ clientId, name: v.name, saldo: v.saldo }))
    .sort((a, b) => b.saldo - a.saldo)
    .slice(0, 5);

  res.json({
    ventasDelMes,
    ventasMesAnterior,
    cambioVentasPct,
    ventasUltimos6Meses,
    carteraPendiente,
    facturasConSaldo,
    opsEnCurso,
    pedidosEnProduccion,
    cotizacionesAbiertas,
    topClientesSaldo,
  });
});
