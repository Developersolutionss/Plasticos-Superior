/**
 * Plantillas de Orden de Producción por proceso, transcritas de los formatos
 * en papel del cliente (media/FORMATO *.xlsx). Espejo de
 * server/src/services/opTemplates.ts (mismo criterio que ROLES ↔ navConfig):
 * si se cambia una plantilla hay que tocar ambos lados.
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
}

export interface OpTemplate {
  title: string;
  cod: string;
  materiaPrimaRefs?: string[];
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
  /** true cuando la columna ETIQUETA (source "label") identifica el rollo
   * que ESTA estación está creando ahora mismo (Extrusión, Impresión) — ahí
   * se genera sola (código RL-<id>) en vez de pedirse a mano. En Sellado/
   * Precorte esa misma columna es el rollo de ORIGEN que se toma como
   * insumo, así que sigue siendo manual/editable. */
  labelIsOwnRoll?: boolean;
}

export const STATION_LABELS: Record<OpStation, string> = {
  extrusion: "Extrusión",
  impresion: "Impresión",
  sellado: "Sellado",
  precorte: "Precorte",
};

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
          { key: "color", label: "Color", kind: "text" },
          { key: "tratado", label: "Tratado", kind: "options", options: SI_NO },
          { key: "caras", label: "Caras", kind: "text" },
          { key: "fuelles", label: "Fuelles", kind: "text" },
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
          { key: "color", label: "Color", kind: "text" },
          { key: "impreso", label: "Impreso", kind: "text" },
          { key: "caras", label: "Caras", kind: "text" },
          { key: "rollos", label: "Rollos", kind: "number" },
          { key: "fuelles", label: "Fuelles", kind: "text" },
          { key: "calibre", label: "Calibre", kind: "text" },
          { key: "ancho", label: "Ancho", kind: "text" },
          { key: "anchoUnidad", label: "Unidad de ancho", kind: "options", options: ["Pulgadas", "Cms."] },
          { key: "cantidadKilos", label: "Cantidad (kilos)", kind: "number" },
          { key: "cantidadRollos", label: "Cantidad (rollos)", kind: "number" },
        ],
      },
      MEDIDAS_FINALES,
    ],
    ordenReferencia: true,
    ordenReferenciaUnidField: { key: "unidadesSellado", label: "Unid." },
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
        fields: [{ key: "tipoMaterial", label: "Tipo", kind: "options", options: FORMA_MATERIAL }],
      },
      {
        title: "MATERIAL",
        fields: [
          { key: "materialDensidad", label: "Material (baja/alta)", kind: "options", options: ["BAJA", "ALTA"] },
          { key: "color", label: "Color", kind: "text" },
          { key: "impreso", label: "Impreso", kind: "text" },
          { key: "caras", label: "Caras", kind: "text" },
          { key: "fuelles", label: "Fuelles", kind: "text" },
          { key: "calibre", label: "Calibre", kind: "text" },
          { key: "ancho", label: "Ancho", kind: "text" },
          { key: "anchoUnidad", label: "Unidad de ancho", kind: "options", options: ["Pulgadas", "Cms."] },
          { key: "cantidadKilos", label: "Cantidad (kilos)", kind: "number" },
          { key: "cantidadRollos", label: "Cantidad (rollos)", kind: "number" },
        ],
      },
      MEDIDAS_FINALES,
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
      { label: "COLOR", source: "detail", detailKey: "color" },
      { label: "DENSIDAD", source: "detail", detailKey: "densidad" },
      { label: "DESPERDICIO", source: "waste", kind: "number" },
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

/** Estados en los que la OP acepta rollos, edición de specs y cierre. */
export const OPEN_STATUSES = ["pendiente", "en_proceso"];

/** Estados desde los que Gestión puede reabrir una OP para corregir un error. */
export const REOPENABLE_STATUSES = ["finalizada", "pendiente_calidad", "detenida"];
