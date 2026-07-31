import ExcelJS from "exceljs";

export interface ParsedProductionRow {
  rowNumber: number;
  sku: string;
  labelCode?: string;
  operatorName: string;
  clientName?: string;
  measure?: string;
  kilos: number;
  driverName?: string;
  observations?: string;
  error?: string;
}

/**
 * Columnas esperadas en el Excel/CSV que hoy se comparte por WhatsApp:
 * SKU | Etiqueta | Operario | Cliente | Medida | Kilos | Conductor | Observaciones
 */
const EXPECTED_HEADERS = [
  "sku",
  "etiqueta",
  "operario",
  "cliente",
  "medida",
  "kilos",
  "conductor",
  "observaciones",
];

export async function parseProductionFile(buffer: Buffer, filename: string): Promise<ParsedProductionRow[]> {
  const workbook = new ExcelJS.Workbook();

  if (filename.toLowerCase().endsWith(".csv")) {
    await workbook.csv.read(bufferToStream(buffer));
  } else {
    await workbook.xlsx.load(buffer as any);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1).values as unknown[];
  const headerMap = buildHeaderMap(headerRow);

  const rows: ParsedProductionRow[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const values = row.values as unknown[];

    const sku = String(getByHeader(values, headerMap, "sku") ?? "").trim();
    const operatorName = String(getByHeader(values, headerMap, "operario") ?? "").trim();
    const kilosRaw = getByHeader(values, headerMap, "kilos");
    const kilos = Number(kilosRaw ?? NaN);

    if (!sku && !operatorName) return; // fila vacía

    let error: string | undefined;
    if (!sku) error = "Falta SKU";
    else if (!operatorName) error = "Falta operario";
    else if (Number.isNaN(kilos) || kilos <= 0) error = "Kilos inválidos";

    rows.push({
      rowNumber,
      sku,
      labelCode: optionalString(getByHeader(values, headerMap, "etiqueta")),
      operatorName,
      clientName: optionalString(getByHeader(values, headerMap, "cliente")),
      measure: optionalString(getByHeader(values, headerMap, "medida")),
      kilos,
      driverName: optionalString(getByHeader(values, headerMap, "conductor")),
      observations: optionalString(getByHeader(values, headerMap, "observaciones")),
      error,
    });
  });

  return rows;
}

function buildHeaderMap(headerRow: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    if (typeof cell !== "string") return;
    const normalized = normalizeHeader(cell);
    if (EXPECTED_HEADERS.includes(normalized)) {
      map.set(normalized, index);
    }
  });
  return map;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function getByHeader(values: unknown[], headerMap: Map<string, number>, key: string): unknown {
  const index = headerMap.get(key);
  if (index === undefined) return undefined;
  return values[index];
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str.length ? str : undefined;
}

function bufferToStream(buffer: Buffer) {
  const { Readable } = require("stream");
  return Readable.from(buffer);
}
