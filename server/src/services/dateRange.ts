/**
 * Arma el límite de un día (inicio o fin) a partir de un "YYYY-MM-DD" en la
 * hora LOCAL del servidor — evita el corrimiento de horas que da
 * `new Date("YYYY-MM-DD")` + setHours en husos horarios != 0.
 *
 * Vivía copiada igual en dashboard.ts, productionOrders.ts y
 * rollTransfers.ts (cada filtro de rango de fechas la necesitaba); se
 * consolida acá para que un cambio de criterio no se pueda hacer en una sola
 * copia y olvidarse de las otras dos.
 */
export function localDayBoundary(dateStr: string, end: boolean): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return end ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day, 0, 0, 0, 0);
}
