import ExcelJS from "exceljs";

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

/** Boilerplate compartido de exceljs para armar un .xlsx de una sola hoja
 * a partir de columnas + filas planas. Usado por los 4 endpoints de
 * server/src/routes/export.ts. */
export async function buildExcelBuffer(
  sheetName: string,
  columns: ExcelColumn[],
  rows: Record<string, unknown>[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
