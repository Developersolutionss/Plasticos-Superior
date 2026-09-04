import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { getLowStockAlerts } from "../services/stockService";

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

type Period = "mes" | "trimestre" | "anio";

/** Límites [inicio, fin) del período actual y del inmediatamente anterior
 * (mismo largo), para poder mostrar el % de cambio en cada toggle. */
function periodRanges(period: Period, now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(start);
  const prevEnd = new Date(start);

  if (period === "mes") {
    prevStart.setMonth(prevStart.getMonth() - 1);
  } else if (period === "trimestre") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    start.setMonth(quarterStartMonth);
    prevStart.setTime(start.getTime());
    prevStart.setMonth(start.getMonth() - 3);
    prevEnd.setTime(start.getTime());
  } else {
    start.setMonth(0);
    prevStart.setTime(start.getTime());
    prevStart.setFullYear(start.getFullYear() - 1);
    prevEnd.setTime(start.getTime());
  }

  return { start, end: now, prevStart, prevEnd };
}

dashboardRouter.get("/resumen", async (req, res) => {
  const period: Period = (["mes", "trimestre", "anio"] as const).includes(req.query.period as Period)
    ? (req.query.period as Period)
    : "mes";
  const ahora = new Date();
  const { start, prevStart, prevEnd } = periodRanges(period, ahora);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthsBack = 5;
  const chartStart = new Date(startOfMonth);
  chartStart.setMonth(chartStart.getMonth() - monthsBack);

  const [
    facturasUltimos6Meses,
    todasLasFacturas,
    rollsUltimos6Meses,
    opsEnCurso,
    pedidosEnProduccion,
    cotizacionesAbiertasRaw,
    cotizacionesDelPeriodo,
    clientesConLimite,
    lowStockAlerts,
    ordenesEnCurso,
  ] = await Promise.all([
    prisma.factura.findMany({
      where: { status: { not: "anulada" }, createdAt: { gte: chartStart } },
      include: { items: true },
    }),
    prisma.factura.findMany({
      where: { status: { not: "anulada" } },
      include: { items: true, payments: true, client: { select: { id: true, name: true } } },
    }),
    prisma.productionRoll.findMany({
      where: { date: { gte: chartStart } },
      select: { date: true, weightKg: true },
    }),
    prisma.productionOrder.count({ where: { status: { in: ["pendiente", "en_proceso", "pendiente_calidad"] } } }),
    prisma.pedido.count({ where: { status: "en_produccion" } }),
    prisma.cotizacion.findMany({
      where: { status: { in: ["borrador", "enviada"] } },
      include: { items: true },
    }),
    prisma.cotizacion.findMany({
      where: { status: { in: ["aceptada", "rechazada"] }, createdAt: { gte: prevStart } },
      select: { status: true },
    }),
    prisma.client.findMany({ where: { creditLimit: { gt: 0 } }, select: { id: true, name: true, creditLimit: true } }),
    getLowStockAlerts(),
    prisma.productionOrder.findMany({
      where: { status: { in: ["pendiente", "en_proceso", "pendiente_calidad"] } },
      include: {
        product: { select: { name: true } },
        client: { select: { name: true } },
        rolls: { select: { weightKg: true, wasteKg: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const ventasPorMes = new Map<string, number>();
  for (const f of facturasUltimos6Meses) {
    const total = f.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
    const key = monthKey(f.createdAt);
    ventasPorMes.set(key, (ventasPorMes.get(key) ?? 0) + total);
  }
  const kgPorMes = new Map<string, number>();
  for (const r of rollsUltimos6Meses) {
    const key = monthKey(r.date);
    kgPorMes.set(key, (kgPorMes.get(key) ?? 0) + Number(r.weightKg));
  }

  const ventasUltimos6Meses: { mes: string; total: number; kg: number }[] = [];
  for (let i = monthsBack; i >= 0; i--) {
    const d = new Date(startOfMonth);
    d.setMonth(d.getMonth() - i);
    const key = monthKey(d);
    ventasUltimos6Meses.push({ mes: key, total: ventasPorMes.get(key) ?? 0, kg: kgPorMes.get(key) ?? 0 });
  }

  // Ventas y kg producidos del período elegido (mes/trimestre/año), vs el
  // período anterior de igual largo — recalculado con su propio rango en
  // vez de reusar el gráfico de 6 meses, que solo sirve para "mes".
  const [facturasPeriodo, facturasPeriodoAnterior, rollsPeriodo, rollsPeriodoAnterior] = await Promise.all([
    prisma.factura.findMany({ where: { status: { not: "anulada" }, createdAt: { gte: start, lte: ahora } }, include: { items: true } }),
    prisma.factura.findMany({ where: { status: { not: "anulada" }, createdAt: { gte: prevStart, lt: prevEnd } }, include: { items: true } }),
    prisma.productionRoll.aggregate({ where: { date: { gte: start, lte: ahora } }, _sum: { weightKg: true } }),
    prisma.productionRoll.aggregate({ where: { date: { gte: prevStart, lt: prevEnd } }, _sum: { weightKg: true } }),
  ]);
  const sumFacturas = (fs: typeof facturasPeriodo) =>
    fs.reduce((sum, f) => sum + f.items.reduce((s, it) => s + Number(it.quantity) * Number(it.unitPrice), 0), 0);
  const ventasDelPeriodo = sumFacturas(facturasPeriodo);
  const ventasPeriodoAnterior = sumFacturas(facturasPeriodoAnterior);
  const cambioVentasPct = ventasPeriodoAnterior > 0 ? ((ventasDelPeriodo - ventasPeriodoAnterior) / ventasPeriodoAnterior) * 100 : null;
  const kgProducidosDelPeriodo = Number(rollsPeriodo._sum.weightKg ?? 0);
  const kgProducidosPeriodoAnterior = Number(rollsPeriodoAnterior._sum.weightKg ?? 0);

  const saldoPorCliente = new Map<number, { name: string; saldo: number }>();
  let carteraPendiente = 0;
  let carteraVencida = 0;
  let facturasConSaldo = 0;
  let facturasVencidasCount = 0;

  for (const f of todasLasFacturas) {
    const total = f.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
    const paid = f.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const saldo = total - paid;
    if (saldo > 0) {
      carteraPendiente += saldo;
      facturasConSaldo += 1;
      if (f.dueDate && f.dueDate < ahora) {
        carteraVencida += saldo;
        facturasVencidasCount += 1;
      }
      const prev = saldoPorCliente.get(f.client.id);
      saldoPorCliente.set(f.client.id, { name: f.client.name, saldo: (prev?.saldo ?? 0) + saldo });
    }
  }

  const topClientesSaldo = [...saldoPorCliente.entries()]
    .map(([clientId, v]) => ({ clientId, name: v.name, saldo: v.saldo }))
    .sort((a, b) => b.saldo - a.saldo)
    .slice(0, 5);

  const valorCotizacion = (c: (typeof cotizacionesAbiertasRaw)[number]) =>
    c.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
  const cotizacionesAbiertas = cotizacionesAbiertasRaw.length;
  const valorCotizacionesAbiertas = cotizacionesAbiertasRaw.reduce((sum, c) => sum + valorCotizacion(c), 0);
  const en7Dias = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000);
  const cotizacionesPorVencerSemana = cotizacionesAbiertasRaw.filter((c) => c.validUntil && c.validUntil >= ahora && c.validUntil <= en7Dias);

  const aceptadasPeriodo = cotizacionesDelPeriodo.filter((c) => c.status === "aceptada").length;
  const totalCerradasPeriodo = cotizacionesDelPeriodo.length;
  const tasaCierrePct = totalCerradasPeriodo > 0 ? (aceptadasPeriodo / totalCerradasPeriodo) * 100 : null;

  // Alertas y acciones: solo señales que se pueden calcular con datos reales
  // del sistema (crédito, stock, cartera, cotizaciones) — nada de estado de
  // máquina/OEE/scrap, que no se registran acá.
  type Alerta = { severity: "critica" | "alta" | "media"; title: string; detail: string };
  const alertas: Alerta[] = [];

  for (const c of clientesConLimite) {
    const saldo = saldoPorCliente.get(c.id)?.saldo ?? 0;
    const limite = Number(c.creditLimit);
    if (saldo > limite) {
      alertas.push({
        severity: "critica",
        title: `Cliente ${c.name} excede límite de crédito`,
        detail: `$${Math.round(saldo).toLocaleString("es-CO")} pendientes de $${Math.round(limite).toLocaleString("es-CO")} de cupo`,
      });
    }
  }
  if (facturasVencidasCount > 0) {
    alertas.push({
      severity: "alta",
      title: `${facturasVencidasCount} factura${facturasVencidasCount === 1 ? "" : "s"} vencida${facturasVencidasCount === 1 ? "" : "s"}`,
      detail: `$${Math.round(carteraVencida).toLocaleString("es-CO")} en mora`,
    });
  }
  for (const p of lowStockAlerts) {
    alertas.push({
      severity: "media",
      title: `${p.name} bajo el mínimo`,
      detail: `${p.currentStock} ${p.unit} · mínimo ${p.minStock}`,
    });
  }
  if (cotizacionesPorVencerSemana.length > 0) {
    const valor = cotizacionesPorVencerSemana.reduce((sum, c) => sum + valorCotizacion(c), 0);
    alertas.push({
      severity: "media",
      title: `${cotizacionesPorVencerSemana.length} cotización${cotizacionesPorVencerSemana.length === 1 ? "" : "es"} vence${cotizacionesPorVencerSemana.length === 1 ? "" : "n"} esta semana`,
      detail: `$${Math.round(valor).toLocaleString("es-CO")} en riesgo de perderse`,
    });
  }
  const severityOrder: Record<Alerta["severity"], number> = { critica: 0, alta: 1, media: 2 };
  alertas.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const ordenesEnCursoTotal = await prisma.productionOrder.count({ where: { status: { in: ["pendiente", "en_proceso", "pendiente_calidad"] } } });
  const ordenesEnCursoView = ordenesEnCurso.map((o) => {
    const cargado = o.rolls.reduce((sum, r) => sum + Number(r.weightKg) + Number(r.wasteKg), 0);
    const planificado = Number(o.quantityPlanned);
    const avancePct = planificado > 0 ? Math.min(100, Math.round((cargado / planificado) * 100)) : 0;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      station: o.station,
      status: o.status,
      productName: o.product.name,
      clientName: o.client?.name ?? null,
      avancePct,
    };
  });

  res.json({
    period,
    ventasDelPeriodo,
    ventasPeriodoAnterior,
    cambioVentasPct,
    kgProducidosDelPeriodo,
    kgProducidosPeriodoAnterior,
    ventasUltimos6Meses,
    carteraPendiente,
    carteraVencida,
    facturasConSaldo,
    opsEnCurso,
    pedidosEnProduccion,
    cotizacionesAbiertas,
    valorCotizacionesAbiertas,
    tasaCierrePct,
    cotizacionesPorVencerSemana: cotizacionesPorVencerSemana.length,
    alertas,
    ordenesEnCurso: ordenesEnCursoView,
    ordenesEnCursoTotal,
    topClientesSaldo,
  });
});

/**
 * Indicadores adicionales (top productos despachados, tasa de aprobación de
 * calidad, tiempo promedio de producción), sin necesitar campos nuevos en
 * el schema. Rango configurable por querystring (`from`/`to`, YYYY-MM-DD);
 * sin params, cae al comportamiento de siempre (últimos 30 días).
 */
/**
 * Arma el límite de un día (inicio o fin) a partir de un "YYYY-MM-DD" en la
 * hora LOCAL del servidor. `new Date("YYYY-MM-DD")` parsea como medianoche
 * UTC — combinarlo con setHours/setUTCHours después queda mal en cualquier
 * huso con offset != 0 (en America/Bogota, UTC-5, se pierden horas del día
 * elegido). Parsear los componentes a mano y pasarlos al constructor local
 * evita el problema para cualquier huso horario donde corra el servidor.
 */
function localDayBoundary(dateStr: string, end: boolean): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return end ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day, 0, 0, 0, 0);
}

dashboardRouter.get("/indicadores", async (req, res) => {
  const defaultSince = new Date();
  defaultSince.setDate(defaultSince.getDate() - 30);
  defaultSince.setHours(0, 0, 0, 0);

  const fromParam = req.query.from as string | undefined;
  const toParam = req.query.to as string | undefined;

  const from = fromParam ? localDayBoundary(fromParam, false) : defaultSince;
  const to = toParam ? localDayBoundary(toParam, true) : new Date();

  const [dispatchItems, qualityChecks] = await Promise.all([
    prisma.dispatchItem.findMany({
      where: { dispatch: { status: "despachado", dispatchedDate: { gte: from, lte: to } } },
      include: { product: { select: { id: true, sku: true, name: true, unit: true } } },
    }),
    prisma.qualityCheck.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { productionOrder: { include: { rolls: { select: { date: true } } } } },
    }),
  ]);

  const porProducto = new Map<number, { sku: string; name: string; unit: string; total: number }>();
  for (const item of dispatchItems) {
    const cantidad = Number(item.quantityDispatched ?? 0);
    const prev = porProducto.get(item.productId);
    porProducto.set(item.productId, {
      sku: item.product.sku,
      name: item.product.name,
      unit: item.product.unit,
      total: (prev?.total ?? 0) + cantidad,
    });
  }
  const topProductosDespachados = [...porProducto.entries()]
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const aprobadas = qualityChecks.filter((q) => q.result === "aprobado").length;
  const rechazadas = qualityChecks.filter((q) => q.result === "rechazado").length;
  const totalChecks = aprobadas + rechazadas;
  const pctAprobacion = totalChecks > 0 ? (aprobadas / totalChecks) * 100 : null;

  const duracionesHoras: number[] = [];
  for (const q of qualityChecks) {
    const starts = q.productionOrder.rolls.map((r) => r.date.getTime());
    if (starts.length === 0) continue;
    const inicio = Math.min(...starts);
    duracionesHoras.push((q.createdAt.getTime() - inicio) / (1000 * 60 * 60));
  }
  const tiempoPromedioProduccionHoras =
    duracionesHoras.length > 0 ? duracionesHoras.reduce((a, b) => a + b, 0) / duracionesHoras.length : null;

  res.json({
    topProductosDespachados,
    calidad: { aprobadas, rechazadas, pctAprobacion },
    tiempoPromedioProduccionHoras,
  });
});
