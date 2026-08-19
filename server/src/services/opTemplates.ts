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
  /** De dónde sale el valor: campo base de ProductionRoll o clave de details. */
  source: "date" | "shift" | "operator" | "machine" | "label" | "weight" | "waste" | "detail";
  detailKey?: string;
  kind?: "text" | "number" | "siNo";
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
}

const FORMA_MATERIAL = ["Tubular", "Semitubular", "Lám. PH", "Lám. Indiv.", "Fuelles"];
const SI_NO = ["SI", "NO"];

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

export const OP_TEMPLATES: Record<OpStation, OpTemplate> = {
  extrusion: {
    title: "ORDEN DE PRODUCCION EXTRUSIÓN",
    cod: "COD F-OP-01",
    materiaPrimaRefs: [
      "BAJA",
      "ALTA",
      "BIODEGRADABLE",
      "LINEAL",
      "CARBONATO",
      "TERMO",
      "PIGMENTO",
      "SECANTE",
      "ANTIBLOCK",
      "AGLUTINADO",
      "PELETIZADO",
    ],
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
          { key: "fuelles", label: "Fuelles", kind: "text" },
          { key: "calibre", label: "Calibre", kind: "text" },
          { key: "densidad", label: "Densidad", kind: "text" },
          { key: "color", label: "Color", kind: "text" },
          { key: "tratado", label: "Tratado", kind: "options", options: SI_NO },
          { key: "tratadoCaras", label: "Caras tratadas", kind: "text" },
          { key: "grafilado", label: "Grafilado", kind: "options", options: SI_NO },
        ],
      },
    ],
    rollColumns: [
      { label: "FECHA", source: "date" },
      { label: "TURNO", source: "shift" },
      { label: "OPERARIO", source: "operator" },
      { label: "No. MAQ", source: "machine" },
      { label: "ETIQUETA", source: "label" },
      { label: "PESO (KG)", source: "weight", kind: "number" },
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
        fields: [
          { key: "tipoMaterial", label: "Tipo", kind: "options", options: FORMA_MATERIAL },
          { key: "materialDensidad", label: "Material (baja/alta)", kind: "options", options: ["BAJA", "ALTA"] },
          { key: "color", label: "Color", kind: "text" },
          { key: "tratadoCaras", label: "Tratado (caras)", kind: "text" },
        ],
      },
      {
        title: "CARACTERISTICAS DE LOS ROLLOS",
        fields: [
          { key: "ancho", label: "Ancho", kind: "text" },
          { key: "anchoUnidad", label: "Unidad de ancho", kind: "options", options: ["Pulgadas", "Cms."] },
          { key: "fuelles", label: "Fuelles", kind: "text" },
          { key: "calibre", label: "Calibre", kind: "text" },
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
  },

  sellado: {
    title: "ORDEN DE PRODUCCION SELLADO",
    cod: "COD F-SE-01",
    sections: [
      {
        title: "TIPO DE MATERIAL",
        fields: [
          { key: "tipoMaterial", label: "Tipo", kind: "options", options: FORMA_MATERIAL },
          { key: "materialDensidad", label: "Material (baja/alta)", kind: "options", options: ["BAJA", "ALTA"] },
          { key: "color", label: "Color", kind: "text" },
          { key: "impresoCaras", label: "Impreso (caras)", kind: "text" },
        ],
      },
      {
        title: "CARACTERISTICAS DE LOS ROLLOS",
        fields: [
          { key: "ancho", label: "Ancho", kind: "text" },
          { key: "anchoUnidad", label: "Unidad de ancho", kind: "options", options: ["Pulgadas", "Cms."] },
          { key: "fuelles", label: "Fuelles", kind: "text" },
          { key: "calibre", label: "Calibre", kind: "text" },
          { key: "cantidadRollos", label: "Cantidad (rollos)", kind: "number" },
        ],
      },
      MEDIDAS_FINALES,
      {
        title: "REFERENCIA DE ORDENES",
        fields: [
          { key: "kilosExtrusion", label: "Orden extrusión — kilos", kind: "number" },
          { key: "rollosExtrusion", label: "Orden extrusión — rollos", kind: "number" },
          { key: "kilosSellado", label: "Orden sellado — kilos", kind: "number" },
          { key: "bultosSellado", label: "Orden sellado — bultos", kind: "number" },
          { key: "unidadesSellado", label: "Orden sellado — unid.", kind: "number" },
        ],
      },
    ],
    rollColumns: [
      { label: "ETIQUETA TUB", source: "label" },
      { label: "PESO (KG)", source: "weight", kind: "number" },
      { label: "FECHA", source: "date" },
      { label: "TURNO", source: "shift" },
      { label: "OPERARIO", source: "operator" },
      { label: "E. BULTO", source: "detail", detailKey: "eBulto" },
      { label: "P. BULTO", source: "detail", detailKey: "pBulto", kind: "number" },
      { label: "PAQ X UNID", source: "detail", detailKey: "paqXUnid" },
      { label: "DESPERD", source: "waste", kind: "number" },
      { label: "P. RESISTENCIA", source: "detail", detailKey: "pResistencia", kind: "siNo" },
    ],
  },

  precorte: {
    title: "ORDEN DE PRODUCCION PRECORTE",
    cod: "COD F-SE-01",
    sections: [
      {
        title: "TIPO DE MATERIAL",
        fields: [
          { key: "tipoMaterial", label: "Tipo", kind: "options", options: FORMA_MATERIAL },
          { key: "materialDensidad", label: "Material (baja/alta)", kind: "options", options: ["BAJA", "ALTA"] },
          { key: "color", label: "Color", kind: "text" },
          { key: "impresoCaras", label: "Impreso (caras)", kind: "text" },
        ],
      },
      {
        title: "CARACTERISTICAS DE LOS ROLLOS",
        fields: [
          { key: "ancho", label: "Ancho", kind: "text" },
          { key: "anchoUnidad", label: "Unidad de ancho", kind: "options", options: ["Pulgadas", "Cms."] },
          { key: "fuelles", label: "Fuelles", kind: "text" },
          { key: "calibre", label: "Calibre", kind: "text" },
          { key: "cantidadRollos", label: "Cantidad (rollos)", kind: "number" },
        ],
      },
      MEDIDAS_FINALES,
    ],
    rollColumns: [
      { label: "FECHA", source: "date" },
      { label: "TURNO", source: "shift" },
      { label: "OPERARIO", source: "operator" },
      { label: "ETIQUETA R", source: "label" },
      { label: "PESO R (KG)", source: "weight", kind: "number" },
      { label: "COLOR", source: "detail", detailKey: "color" },
      { label: "DENSIDAD", source: "detail", detailKey: "densidad" },
      { label: "DESP. (KG)", source: "waste", kind: "number" },
    ],
  },
};

/** Derivaciones válidas entre procesos (Extrusión es el proceso base). */
export const DERIVATIONS: Record<OpStation, OpStation[]> = {
  extrusion: ["impresion", "sellado", "precorte"],
  impresion: ["sellado", "precorte"],
  sellado: [],
  precorte: [],
};

/** Estaciones cuyo cierre pasa por Calidad y genera entrada de inventario. */
export const FINAL_STATIONS: OpStation[] = ["sellado", "precorte"];
