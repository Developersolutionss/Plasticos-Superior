import ExcelJS from "exceljs";

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
  /** Cómo se formatea la columna en Excel (moneda con separador de miles,
   * número simple, o fecha) — sin esto, todo sale como texto plano. */
  format?: "currency" | "number" | "date";
}

export interface ExcelBuildOptions {
  /** Título grande arriba de la tabla (ej. "Inventario — Plásticos Superior"). */
  title?: string;
  /** Línea chica debajo del título. Por defecto, fecha/hora de generación. */
  subtitle?: string;
}

const BRAND = {
  primary: "FF1E293B", // slate-800, mismo tono que el header de la app
  accent: "FF334155", // slate-700
  zebra: "FFF1F5F9", // slate-100
  border: "FFCBD5E1", // slate-300
  subtitle: "FF64748B", // slate-500
};

const NUMBER_FORMATS: Record<NonNullable<ExcelColumn["format"]>, string> = {
  currency: '"$"#,##0',
  number: "#,##0.##",
  date: "dd/mm/yyyy",
};

/** "en_produccion" -> "En produccion" — para que los valores de enums no
 * salgan con guiones bajos en un reporte que alguien va a imprimir/mandar. */
export function humanize(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Boilerplate compartido de exceljs para armar un .xlsx de una sola hoja
 * a partir de columnas + filas planas, con estilo consistente (título,
 * encabezado con color de marca, filas alternadas, formato numérico por
 * columna, autofiltro y fila congelada). Usado por los 4 endpoints de
 * server/src/routes/export.ts. */
export async function buildExcelBuffer(
  sheetName: string,
  columns: ExcelColumn[],
  rows: Record<string, unknown>[],
  options: ExcelBuildOptions = {}
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Plásticos Superior — Sistema ERP/MES";
  workbook.created = new Date();

  const headerRowNumber = options.title ? 3 : 1;
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: headerRowNumber }],
  });

  sheet.columns = columns.map((c) => ({ key: c.key, width: c.width ?? Math.max(14, c.header.length + 4) }));

  if (options.title) {
    sheet.mergeCells(1, 1, 1, columns.length);
    const titleCell = sheet.getRow(1).getCell(1);
    titleCell.value = options.title;
    titleCell.font = { bold: true, size: 14, color: { argb: BRAND.primary } };
    sheet.getRow(1).height = 24;

    sheet.mergeCells(2, 1, 2, columns.length);
    const subtitleCell = sheet.getRow(2).getCell(1);
    subtitleCell.value = options.subtitle ?? `Generado el ${new Date().toLocaleString("es-CO")}`;
    subtitleCell.font = { italic: true, size: 10, color: { argb: BRAND.subtitle } };
    sheet.getRow(2).height = 16;
  }

  const headerRow = sheet.getRow(headerRowNumber);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.primary } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "medium", color: { argb: BRAND.accent } } };
  });
  headerRow.height = 20;
  sheet.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: headerRowNumber, column: columns.length } };

  rows.forEach((row, i) => {
    const excelRow = sheet.addRow(row);
    const isEven = i % 2 === 1;
    excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const col = columns[colNumber - 1];
      if (col?.format) cell.numFmt = NUMBER_FORMATS[col.format];
      cell.border = { bottom: { style: "thin", color: { argb: BRAND.border } } };
      if (isEven) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.zebra } };
    });
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
