/**
 * Plantillas de Orden de Producción por proceso, transcritas de los formatos
 * en papel del cliente (media/FORMATO *.xlsx): título y código del formato,
 * secciones del encabezado (specs), y columnas de la tabla de rollos.
 * El cliente web tiene su espejo en client/src/opTemplates.ts (mismo criterio
 * que ROLES ↔ navConfig): si se cambia una plantilla hay que tocar ambos.
 */

export type OpStation = "extrusion" | "impresion" | "sellado" | "precorte";

export interface OpSpecField {
  key: string;
  label: string;
  kind: "text" | "number" | "options";
  options?: string[];
  suffix?: string;
}

export interface OpSpecSection {
  title: string;
  fields: OpSpecField[];
}

export interface OpRollColumn {
  label: string;
  /** De dónde sale el valor: campo base de ProductionRoll, clave de details,
   * la hora de `date` (columna HORA aparte de FECHA en el papel), o el
   * acumulado de kg hasta esa fila (columna TOTAL, no se tipea — se calcula). */
  source: "date" | "time" | "shift" | "operator" | "machine" | "label" | "weight" | "waste" | "cumulativeWeight" | "detail";
  detailKey?: string;
  kind?: "text" | "number" | "siNo";
  /** true en E. BULTO de Sellado — etiqueta física pre-impresa (BultoLabel),
   * se completa al escanear, no se tipea. Ver opTemplates.ts del cliente. */
  scanBultoLabel?: boolean;
  /** Clave de las Especificaciones de la OP de la que el cliente precarga el
   * valor inicial de este campo (ej. Color/Densidad en Precorte). El server
   * no lee este campo hoy -- vive acá solo para que las dos plantillas
   * (server/client) sigan siendo un espejo exacto. Ver opTemplates.ts del
   * cliente para el uso real. */
  specDefaultKey?: string;
}

export interface OpTemplate {
  title: string;
  cod: string;
  /** Muestra la tabla de materia prima (ref / % / kg / lote). Solo Extrusión. */
  materiaPrimaRefs?: string[];
  /** Muestra las tablas de colores cara 1 / cara 2. Solo Impresión. */
  colores?: boolean;
  sections: OpSpecSection[];
  rollColumns: OpRollColumn[];
  /** Qué columnas de `details` se autocompletan al escanear el QR del rollo
   * de origen (el que se tomó como insumo de la OP padre). Si la estación no
   * tiene columnas propias para eso, se omite — igual queda registrado
   * `sourceRollId` aunque no haya campo visible que llenar. */
  originRollFields?: { labelDetailKey: string; weightDetailKey: string };
  /** Muestra la caja "ORDEN DE <estación padre> / ORDEN <esta estación>"
   * con kilos/rollos/bultos/desperdicio calculados (no texto libre). Solo
   * Sellado por ahora. */
  ordenReferencia?: boolean;
  /** Único campo manual de esa caja (ej. "Unid." en Sellado — no se puede
   * derivar de los rollos, ver PAQ X UNID). */
  ordenReferenciaUnidField?: { key: string; label: string };
  /** true cuando la columna ETIQUETA identifica el rollo que ESTA estación
   * está creando (Extrusión, Impresión) — se genera sola en vez de pedirse
   * a mano. En Sellado/Precorte esa misma columna es el rollo de ORIGEN. */
  labelIsOwnRoll?: boolean;
  /** true en Sellado/Precorte: el rollo madre que se escanea NO se consume
   * entero de una: se monta en la máquina y se le van sacando rollos chicos,
   * cada uno descontando kilos de su saldo (ver RollConsumption). En las
   * demás estaciones escanear un insumo lo consume completo, como siempre.
   * Si mañana Impresión trabaja igual, alcanza con prenderlo acá. */
  consumesSourceByWeight?: boolean;
}

export const STATION_LABELS: Record<OpStation, string> = {
  extrusion: "Extrusión",
  impresion: "Impresión",
  sellado: "Sellado",
  precorte: "Precorte",
};

/** Prefijo del código de QR de un rollo (`EXT-<id>`, `IMP-<id>`, `SELL-<id>`,
 * `PRE-<id>`) según de qué proceso salió -- antes todos los rollos de
 * cualquier estación usaban el mismo prefijo genérico "RL", así que dos
 * rollos de procesos distintos podían mostrar etiquetas que a simple vista
 * parecían del mismo tipo. El número en sí (Roll.id, autoincrement) ya es
 * único en toda la tabla sin importar la estación; el prefijo es para que
 * quien mira el QR sepa de qué proceso es sin tener que escanearlo. */
export const ROLL_CODE_PREFIX: Record<OpStation, string> = {
  extrusion: "EXT",
  impresion: "IMP",
  sellado: "SELL",
  precorte: "PRE",
};

const FORMA_MATERIAL = ["Tubular", "Semitubular", "Lám. PH", "Lám. Indiv.", "Fuelles"];
const SI_NO = ["SI", "NO"];
const DENSIDAD = ["ALTA", "BAJA"];
const COLORES = ["Negro", "Transparente", "Blanco", "Rojo", "Verde", "Verde claro"];
// El material solo se trata/imprime por una cara o por las dos -- nunca es
// otro valor, así que se restringe a opción fija en vez de texto libre
// (antes se podía tipear cualquier cosa acá).
const CARAS = ["1", "2"];

const MEDIDAS_FINALES: OpSpecSection = {
  title: "MEDIDAS FINALES",
  fields: [
    { key: "medidasUnidad", label: "Unidad", kind: "options", options: ["Pulgadas", "Cms."] },
    { key: "medAncho", label: "Ancho", kind: "text" },
    { key: "medLargo", label: "Largo", kind: "text" },
    { key: "medLateral", label: "Lateral", kind: "text" },
    { key: "medFuelleFondo", label: "Fuelle fondo", kind: "text" },
    { key: "medPestana", label: "Pestaña", kind: "text" },
    { key: "medFondo", label: "Fondo", kind: "text" },
    { key: "solapaVolada", label: "Solapa volada", kind: "options", options: ["Interna", "Externa"] },
  ],
};

/** Precorte usa la misma sección que Sellado pero sin Lateral/Fuelle fondo/
 * Pestaña/Fondo/Solapa volada — el cliente pidió sacarlos SOLO acá. */
const MEDIDAS_FINALES_PRECORTE: OpSpecSection = {
  title: "MEDIDAS FINALES",
  fields: [
    { key: "medidasUnidad", label: "Unidad", kind: "options", options: ["Pulgadas", "Cms."] },
    { key: "medAncho", label: "Ancho", kind: "text" },
    { key: "medLargo", label: "Largo", kind: "text" },
  ],
};

export const OP_TEMPLATES: Record<OpStation, OpTemplate> = {
  extrusion: {
    title: "ORDEN DE PRODUCCION EXTRUSIÓN",
    cod: "COD F-OP-01",
    // Orden y refs exactos de la OP real 4432 (media/4432 ORIGINAL...xlsx),
    // que es la fuente de verdad — la plantilla en blanco tenía "CARBONATO"
    // en vez de repetir el orden real y PIGMENTO/TERMO invertidos.
    materiaPrimaRefs: ["BAJA", "ALTA", "BIODEGRADABLE", "LINEAL", "PIGMENTO", "TERMO", "SECANTE", "ANTIBLOCK", "AGLUTINADO", "PELETIZADO"],
    labelIsOwnRoll: true,
    sections: [
      {
        title: "FORMA DEL MATERIAL",
        fields: [
          { key: "formaMaterial", label: "Forma", kind: "options", options: FORMA_MATERIAL },
          { key: "materialPara", label: "Material para", kind: "options", options: ["IMPRESION", "SELLADO", "PRECORTE"] },
        ],
      },
      {
        title: "ESPECIFICACIONES",
        fields: [
          { key: "ancho", label: "Ancho", kind: "text" },
          { key: "anchoUnidad", label: "Unidad de ancho", kind: "options", options: ["Pulgadas", "Cms."] },
          { key: "fuelles", label: "Fuelles", kind: "options", options: SI_NO },
          { key: "calibre", label: "Calibre", kind: "text" },
          { key: "densidad", label: "Densidad", kind: "options", options: DENSIDAD },
          { key: "color", label: "Color", kind: "options", options: COLORES },
          { key: "tratado", label: "Tratado", kind: "options", options: SI_NO },
          { key: "tratadoCaras", label: "Caras tratadas", kind: "options", options: CARAS },
          { key: "grafilado", label: "Grafilado", kind: "options", options: SI_NO },
        ],
      },
    ],
    rollColumns: [
      { label: "FECHA", source: "date" },
      { label: "TURNO", source: "shift" },
      { label: "OPERARIO", source: "operator" },
      { label: "No. MAQ", source: "machine" },
      { label: "HORA", source: "time" },
      { label: "ETIQUETA", source: "label" },
      { label: "PESO (KG)", source: "weight", kind: "number" },
      { label: "TOTAL (KG)", source: "cumulativeWeight" },
      { label: "DESP. (KG)", source: "waste", kind: "number" },
      { label: "P. RESISTENCIA", source: "detail", detailKey: "pResistencia", kind: "siNo" },
      { label: "P. TRATADO", source: "detail", detailKey: "pTratado", kind: "siNo" },
    ],
  },

  impresion: {
    title: "ORDEN DE PRODUCCION FLEXOGRAFIA",
    cod: "COD F-SE-01",
    colores: true,
    sections: [
      {
        title: "TIPO DE MATERIAL",
        fields: [{ key: "tipoMaterial", label: "Tipo", kind: "options", options: FORMA_MATERIAL }],
      },
      {
        title: "CARACTERISTICAS DE LOS ROLLOS",
        fields: [
          { key: "materialDensidad", label: "Material (baja/alta)", kind: "options", options: ["BAJA", "ALTA"] },
          { key: "color", label: "Color", kind: "options", options: COLORES },
          { key: "tratado", label: "Tratado", kind: "options", options: SI_NO },
          { key: "caras", label: "Caras", kind: "options", options: CARAS },
          { key: "fuelles", label: "Fuelles", kind: "options", options: SI_NO },
          { key: "calibre", label: "Calibre", kind: "text" },
          { key: "ancho", label: "Ancho", kind: "text" },
          { key: "anchoUnidad", label: "Unidad de ancho", kind: "options", options: ["Pulgadas", "Cms."] },
          { key: "cantidadKilos", label: "Cantidad (kilos)", kind: "number" },
          { key: "cantidadRollos", label: "Cantidad (rollos)", kind: "number" },
        ],
      },
      {
        title: "MONTAJE",
        fields: [
          { key: "repeticionesAlAncho", label: "Repeticiones al ancho", kind: "text" },
          { key: "rodillo", label: "Rodillo", kind: "text" },
          { key: "distanciaEntreGuias", label: "Distancia entre guías", kind: "text" },
          { key: "montajeRollos", label: "Rollos", kind: "text" },
          { key: "alcoholLote", label: "Alcohol — lote", kind: "text" },
        ],
      },
    ],
    rollColumns: [
      { label: "FECHA", source: "date" },
      { label: "TURNO", source: "shift" },
      { label: "OP.", source: "operator" },
      { label: "E. EXT", source: "detail", detailKey: "etiquetaExt" },
      { label: "P. EXT", source: "detail", detailKey: "pesoExt", kind: "number" },
      { label: "E. IMP", source: "label" },
      { label: "P. IMP (KG)", source: "weight", kind: "number" },
      { label: "DESP.", source: "waste", kind: "number" },
      { label: "P. DESPRENDIMIENTO", source: "detail", detailKey: "pDesprendimiento", kind: "siNo" },
    ],
    originRollFields: { labelDetailKey: "etiquetaExt", weightDetailKey: "pesoExt" },
    labelIsOwnRoll: true,
  },

  sellado: {
    title: "ORDEN DE PRODUCCION SELLADO",
    cod: "COD F-SE-01",
    sections: [
      {
        title: "TIPO DE MATERIAL",
        fields: [{ key: "tipoMaterial", label: "Tipo", kind: "options", options: FORMA_MATERIAL }],
      },
      {
        title: "MATERIAL",
        fields: [
          { key: "materialDensidad", label: "Material (baja/alta)", kind: "options", options: ["BAJA", "ALTA"] },
          { key: "color", label: "Color", kind: "options", options: COLORES },
          { key: "impreso", label: "Impreso", kind: "options", options: SI_NO },
          { key: "caras", label: "Caras", kind: "options", options: CARAS },
          { key: "rollos", label: "Rollos", kind: "number" },
          { key: "fuelles", label: "Fuelles", kind: "options", options: SI_NO },
          { key: "calibre", label: "Calibre", kind: "text" },
          { key: "ancho", label: "Ancho", kind: "text" },
          { key: "anchoUnidad", label: "Unidad de ancho", kind: "options", options: ["Pulgadas", "Cms."] },
          { key: "cantidadKilos", label: "Cantidad (kilos)", kind: "number" },
          { key: "cantidadRollos", label: "Cantidad (rollos)", kind: "number" },
        ],
      },
      MEDIDAS_FINALES,
    ],
    // "ORDEN DE EXTRUSIÓN" (kilos/rollos de la OP padre) y "ORDEN SELLADO"
    // (kilos/bultos/desperd. de esta misma OP) NO son texto libre — salen
    // solas de los rollos ya cargados (ver ordenReferencia en la hoja y el
    // PDF). Unid. es el único campo manual de esa caja, va acá.
    consumesSourceByWeight: true,
    ordenReferencia: true,
    ordenReferenciaUnidField: { key: "unidadesSellado", label: "Unid." },
    rollColumns: [
      { label: "ETIQUETA TUB", source: "label" },
      { label: "PESO (KG)", source: "weight", kind: "number" },
      { label: "FECHA", source: "date" },
      { label: "TURNO", source: "shift" },
      { label: "OPERARIO", source: "operator" },
      { label: "E. BULTO", source: "detail", detailKey: "eBulto", scanBultoLabel: true },
      { label: "P. BULTO", source: "detail", detailKey: "pBulto", kind: "number" },
      { label: "PAQ X UNID", source: "detail", detailKey: "paqXUnid" },
      { label: "DESPERD", source: "waste", kind: "number" },
      { label: "P. RESISTENCIA", source: "detail", detailKey: "pResistencia", kind: "siNo" },
    ],
  },

  precorte: {
    title: "ORDEN DE PRODUCCION PRECORTE",
    cod: "COD F-SE-01",
    consumesSourceByWeight: true,
    sections: [
      {
        title: "TIPO DE MATERIAL",
        fields: [{ key: "tipoMaterial", label: "Tipo", kind: "options", options: FORMA_MATERIAL }],
      },
      {
        title: "MATERIAL",
        fields: [
          { key: "materialDensidad", label: "Material (baja/alta)", kind: "options", options: ["BAJA", "ALTA"] },
          { key: "color", label: "Color", kind: "options", options: COLORES },
          { key: "impreso", label: "Impreso", kind: "options", options: SI_NO },
          { key: "caras", label: "Caras", kind: "options", options: CARAS },
          { key: "fuelles", label: "Fuelles", kind: "options", options: SI_NO },
          { key: "calibre", label: "Calibre", kind: "text" },
          { key: "ancho", label: "Ancho", kind: "text" },
          { key: "anchoUnidad", label: "Unidad de ancho", kind: "options", options: ["Pulgadas", "Cms."] },
          { key: "cantidadKilos", label: "Cantidad (kilos)", kind: "number" },
          { key: "cantidadRollos", label: "Cantidad (rollos)", kind: "number" },
        ],
      },
      MEDIDAS_FINALES_PRECORTE,
    ],
    // El precorte consume 2 rollos de entrada por registro (dos pares
    // etiqueta/peso en el papel) — el primero va en los campos base
    // (label/weight), el segundo en details.
    rollColumns: [
      { label: "FECHA", source: "date" },
      { label: "TURNO", source: "shift" },
      { label: "OPERARIO", source: "operator" },
      { label: "ETIQUETA R", source: "label" },
      { label: "PESO R (KG)", source: "weight", kind: "number" },
      { label: "ETIQUETA R", source: "detail", detailKey: "etiquetaR2" },
      { label: "PESO R (KG)", source: "detail", detailKey: "pesoR2", kind: "number" },
      { label: "COLOR", source: "detail", detailKey: "color", specDefaultKey: "color" },
      { label: "DENSIDAD", source: "detail", detailKey: "densidad", specDefaultKey: "materialDensidad" },
      { label: "DESPERDICIO", source: "waste", kind: "number" },
    ],
  },
};

/**
 * Qué campo de specs del padre alimenta cuál campo del hijo al derivar
 * (ver POST /:id/derive) — el cliente pidió que la OP derivada NO nazca en
 * blanco, sino con todo lo que ya se sabe por venir de la OP anterior
 * (color, ancho, fuelles, calibre, tipo/forma de material, etc.), en vez de
 * que Gestión tenga que volver a tipearlo. Solo se mapean conceptos que
 * realmente son "el mismo dato" entre plantillas (mismo nombre de campo, o
 * un caso especial de nombre distinto: `formaMaterial` de Extrusión ↔
 * `tipoMaterial` del resto, que comparten las mismas opciones
 * FORMA_MATERIAL; `tratadoCaras` de Extrusión ↔ `caras` del resto;
 * `densidad` de Extrusión ↔ `materialDensidad` del resto, que comparten las
 * mismas opciones BAJA/ALTA — ver DENSIDAD).
 */
const SPEC_INHERITANCE: Partial<Record<string, Record<string, string>>> = {
  "extrusion>impresion": { formaMaterial: "tipoMaterial", ancho: "ancho", anchoUnidad: "anchoUnidad", fuelles: "fuelles", calibre: "calibre", color: "color", tratado: "tratado", tratadoCaras: "caras", densidad: "materialDensidad" },
  "extrusion>sellado": { formaMaterial: "tipoMaterial", ancho: "ancho", anchoUnidad: "anchoUnidad", fuelles: "fuelles", calibre: "calibre", color: "color", tratadoCaras: "caras", densidad: "materialDensidad" },
  "extrusion>precorte": { formaMaterial: "tipoMaterial", ancho: "ancho", anchoUnidad: "anchoUnidad", fuelles: "fuelles", calibre: "calibre", color: "color", tratadoCaras: "caras", densidad: "materialDensidad" },
  "impresion>sellado": {
    tipoMaterial: "tipoMaterial",
    materialDensidad: "materialDensidad",
    color: "color",
    caras: "caras",
    fuelles: "fuelles",
    calibre: "calibre",
    ancho: "ancho",
    anchoUnidad: "anchoUnidad",
  },
  "impresion>precorte": {
    tipoMaterial: "tipoMaterial",
    materialDensidad: "materialDensidad",
    color: "color",
    caras: "caras",
    fuelles: "fuelles",
    calibre: "calibre",
    ancho: "ancho",
    anchoUnidad: "anchoUnidad",
  },
};

/** Compara sin importar mayúsculas, tildes ni espacios de más: "trasparente",
 * " ALTA " y "Lám. PH" tienen que caer en la opción real de la lista. */
function foldOption(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Sinónimos que NO son solo diferencias de mayúsculas/tildes, por campo.
 * Solo equivalencias que Gestión confirmó o que son inequívocas: "ambas"
 * caras son las 2 caras, "trasparente" es un error de tipeo y "TRANSP" la
 * abreviatura del papel de "Transparente", y "Natural" (polietileno sin
 * pigmento) es "Transparente" (confirmado por Gestión 2026-09-26). Lo que no
 * está acá se rechaza, para que Gestión elija la opción correcta en vez de
 * que el sistema adivine.
 *
 * CLEAR_VALUE ("") significa "este valor quiere decir que el campo no
 * aplica": caras "0"/"no" es una OP sin tratado, así que el campo queda
 * vacío en vez de forzarlo a 1 o 2.
 */
const CLEAR_VALUE = "";
const CARAS_ALIASES: Record<string, string> = { ambas: "2", "ambas caras": "2", una: "1", "una cara": "1", "0": CLEAR_VALUE, no: CLEAR_VALUE, ninguna: CLEAR_VALUE };
const OPTION_ALIASES: Record<string, Record<string, string>> = {
  color: { trasparente: "Transparente", transp: "Transparente", natural: "Transparente" },
  caras: CARAS_ALIASES,
  tratadoCaras: CARAS_ALIASES,
};

/** Un campo de lista con un valor que no es ninguna de sus opciones. */
export interface SpecOptionIssue {
  key: string;
  label: string;
  value: unknown;
  options: string[];
}

/** Opción canónica de `options` para `value`; CLEAR_VALUE si el valor
 * significa "no aplica" (el campo queda vacío); null si no corresponde a
 * ninguna. */
function matchOption(key: string, value: unknown, options: string[]): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const folded = foldOption(String(value));
  const direct = options.find((o) => foldOption(o) === folded);
  if (direct) return direct;
  // Fuelles se cargaba como cantidad ("0", "2") antes de ser SI/NO: 0 es
  // que no lleva, cualquier cantidad mayor es que sí (confirmado por
  // Gestión 2026-09-26). El número exacto de fuelles no tiene campo propio.
  if (key === "fuelles" && /^\d+$/.test(folded) && options.includes("SI") && options.includes("NO")) {
    return Number(folded) > 0 ? "SI" : "NO";
  }
  const alias = OPTION_ALIASES[key]?.[folded];
  if (alias === CLEAR_VALUE) return CLEAR_VALUE;
  return alias && options.includes(alias) ? alias : null;
}

/**
 * Lleva cada campo de lista (kind "options") de la plantilla de `station` a
 * su opción exacta ("alta" → "ALTA", "trasparente" → "Transparente") y
 * devuelve aparte los que no corresponden a ninguna opción. Los campos
 * vacíos y los que no son de lista no se tocan.
 *
 * Existe porque la base tiene valores cargados como texto libre (antes de que
 * esos campos fueran listas cerradas, o por API directa) que el <select> de
 * la hoja muestra en blanco, y que al derivar se copiaban tal cual a la OP
 * hija — la hija terminaba mostrando otro campo vacío en vez del dato real.
 */
export function normalizeSpecOptions(
  station: OpStation,
  specs: Record<string, unknown>
): { specs: Record<string, unknown>; issues: SpecOptionIssue[] } {
  const result = { ...specs };
  const issues: SpecOptionIssue[] = [];
  for (const section of OP_TEMPLATES[station].sections) {
    for (const field of section.fields) {
      if (field.kind !== "options" || !field.options) continue;
      const value = result[field.key];
      if (value == null || value === "") continue;
      const match = matchOption(field.key, value, field.options);
      if (match !== null) result[field.key] = match;
      else issues.push({ key: field.key, label: field.label, value, options: field.options });
    }
  }
  return { specs: result, issues };
}

/** Mensaje para el 400 cuando `normalizeSpecOptions` encontró valores inválidos. */
export function specOptionIssuesMessage(station: OpStation, issues: SpecOptionIssue[]): string {
  const detail = issues.map((i) => `${i.label} = "${String(i.value)}" (opciones: ${i.options.join(", ")})`).join("; ");
  return `Valores que no están en la lista de ${STATION_LABELS[station]}: ${detail}`;
}

/** Arma el `specs` inicial de la OP hija copiando del padre lo que aplique
 * (ver SPEC_INHERITANCE) — se ignoran los campos vacíos/no cargados del
 * padre, no tiene sentido pisar con "" algo que Gestión todavía no llenó.
 * Cada valor se lleva a la opción exacta de la lista de la HIJA; uno que no
 * corresponde a ninguna opción de la hija no se copia (antes se copiaba tal
 * cual y la hija lo mostraba en blanco). */
export function inheritSpecs(
  parentStation: OpStation,
  childStation: OpStation,
  parentSpecs: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const mapping = SPEC_INHERITANCE[`${parentStation}>${childStation}`];
  if (!mapping || !parentSpecs) return {};
  const childOptions = new Map<string, string[]>();
  for (const section of OP_TEMPLATES[childStation].sections) {
    for (const field of section.fields) {
      if (field.kind === "options" && field.options) childOptions.set(field.key, field.options);
    }
  }
  const result: Record<string, unknown> = {};
  for (const [fromKey, toKey] of Object.entries(mapping)) {
    const value = parentSpecs[fromKey];
    if (value == null || value === "") continue;
    const options = childOptions.get(toKey);
    if (!options) {
      result[toKey] = value;
      continue;
    }
    const match = matchOption(toKey, value, options);
    if (match) result[toKey] = match;
  }
  return result;
}

/** Derivaciones válidas entre procesos (Extrusión es el proceso base). */
export const DERIVATIONS: Record<OpStation, OpStation[]> = {
  extrusion: ["impresion", "sellado", "precorte"],
  impresion: ["sellado", "precorte"],
  sellado: [],
  precorte: [],
};

/** Estaciones cuyo cierre pasa por Calidad y genera entrada de inventario. */
// Impresión también puede ser un proceso final: el cliente pidió poder
// mandarla directo a Calidad/inventario/despacho sin obligarla a pasar
// por Sellado o Precorte primero (además de poder seguir derivando a
// esos dos como hasta ahora — cerrar y derivar son dos caminos, no uno
// excluye al otro).
export const FINAL_STATIONS: OpStation[] = ["impresion", "sellado", "precorte"];
