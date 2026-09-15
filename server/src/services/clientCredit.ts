import type { TxClient } from "./stockService";

/**
 * Saldo pendiente real del cliente: facturas no anuladas, total de ítems
 * menos pagos recibidos (mismo cálculo que GET /clients/:id/cartera).
 * Se usa tanto para mostrar la cartera como para bloquear un Pedido que
 * excedería el límite de crédito (ver PATCH /pedidos/:id).
 *
 * Una factura con saldo residual de menos de un centavo (ej. 1499.995 vs
 * 1500.00 por redondeo de punto flotante en varios pagos parciales) cuenta
 * como pagada — sin esta tolerancia una factura ya cobrada por completo
 * podía seguir figurando como "pendiente" y bloqueando pedidos nuevos.
 */
export async function getClientSaldoPendiente(tx: Pick<TxClient, "factura">, clientId: number): Promise<number> {
  const facturas = await tx.factura.findMany({
    where: { clientId, status: { not: "anulada" } },
    include: { items: true, payments: true },
  });

  let saldoPendiente = 0;
  for (const f of facturas) {
    const total = f.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
    const paid = f.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const saldo = total - paid;
    if (saldo > 0.005) saldoPendiente += saldo;
  }
  return saldoPendiente;
}
