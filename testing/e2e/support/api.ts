// Cliente de la API para PREPARAR datos de los flujos (crear OPs, cargar
// rollos…) sin pasar por la pantalla. Lo que cada prueba quiere verificar se
// hace siempre por la interfaz; esto solo arma el escenario de partida.

export const API = "http://localhost:4100/api";

export type Rol =
  | "admin"
  | "produccion"
  | "planeacion"
  | "ventas"
  | "despacho"
  | "extrusion"
  | "impresion"
  | "sellado"
  | "precorte"
  | "calidad"
  | "auditor";

/** Usuarios del seed (clave `password123` para todos). */
export const EMAIL: Record<Rol, string> = {
  admin: "admin@empresa.com",
  produccion: "produccion@empresa.com",
  planeacion: "planeacion@empresa.com",
  ventas: "ventas@empresa.com",
  despacho: "despacho@empresa.com",
  extrusion: "operario.extrusion@empresa.com",
  impresion: "operario.impresion@empresa.com",
  sellado: "operario.sellado@empresa.com",
  precorte: "operario.precorte@empresa.com",
  calidad: "calidad@empresa.com",
  auditor: "auditor@empresa.com",
};

export const PREFIJO = { extrusion: "EXT", impresion: "IMP", sellado: "SELL", precorte: "PRE" } as const;
export type Estacion = keyof typeof PREFIJO;

export interface SesionApi {
  token: string;
  user: { id: number; name: string; role: string; email: string };
}

const sesiones = new Map<Rol, SesionApi>();

export async function login(rol: Rol): Promise<SesionApi> {
  const guardada = sesiones.get(rol);
  if (guardada) return guardada;
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL[rol], password: "password123" }),
  });
  if (!res.ok) throw new Error(`No se pudo iniciar sesión como ${rol}: HTTP ${res.status}`);
  const sesion = (await res.json()) as SesionApi;
  sesiones.set(rol, sesion);
  return sesion;
}

export async function llamar<T = any>(rol: Rol, metodo: string, ruta: string, cuerpo?: unknown): Promise<{ status: number; datos: T }> {
  const { token } = await login(rol);
  const res = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  let datos: unknown = texto;
  try {
    datos = texto ? JSON.parse(texto) : undefined;
  } catch {
    // Rutas inexistentes responden HTML de Express: se devuelve tal cual.
  }
  return { status: res.status, datos: datos as T };
}

/** Como `llamar`, pero falla con el mensaje del servidor si la respuesta no es 2xx. */
export async function exito<T = any>(rol: Rol, metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const { status, datos } = await llamar<T>(rol, metodo, ruta, cuerpo);
  if (status >= 400) throw new Error(`${metodo} ${ruta} → ${status}: ${JSON.stringify(datos)}`);
  return datos;
}

let productoPorDefecto: number | undefined;
/** Producto en kilos del seed para las OPs de prueba. */
export async function idProducto(sku = "ROL-PL-001"): Promise<number> {
  if (sku === "ROL-PL-001" && productoPorDefecto) return productoPorDefecto;
  const productos = await exito<{ id: number; sku: string }[]>("produccion", "GET", "/inventory/products");
  const producto = productos.find((p) => p.sku === sku);
  if (!producto) throw new Error(`El producto ${sku} no está en el seed`);
  if (sku === "ROL-PL-001") productoPorDefecto = producto.id;
  return producto.id;
}

export interface OpCreada {
  id: number;
  orderNumber: string;
}

/** OP de Extrusión ya liberada a planta, con la fórmula de materia prima al 100%. */
export async function crearOpExtrusionLiberada(opciones: { kg?: number; clientId?: number } = {}): Promise<OpCreada> {
  const op = await exito<OpCreada>("produccion", "POST", "/production-orders", {
    productId: await idProducto(),
    quantityPlanned: opciones.kg ?? 200,
    ...(opciones.clientId ? { clientId: opciones.clientId } : {}),
  });
  await exito("produccion", "POST", `/production-orders/${op.id}/derive`, { station: "extrusion" });
  await exito("produccion", "PATCH", `/production-orders/${op.id}`, { specs: { materiaPrima: [{ ref: "BAJA", pct: 100 }] } });
  await exito("produccion", "POST", `/production-orders/${op.id}/release`);
  return op;
}

export interface RolloCreado {
  id: number;
  /** Código legible, ej. `EXT-3`. */
  codigo: string;
  /** Texto que codifica el QR de la etiqueta: código + token de posesión. */
  qr: string;
  /** Imagen exacta de la etiqueta que devolvió el servidor al crear el rollo. */
  imagenEtiqueta: string;
  token: string;
  pesoKg: number;
}

/** Carga un rollo en una OP (por API) y devuelve su QR, como el que se imprime en planta. */
export async function cargarRollo(opId: number, rol: Rol, pesoKg: number, extra: Record<string, unknown> = {}): Promise<RolloCreado> {
  const fila = await exito<{ id: number; station: Estacion; stationSequence: number; possessionToken: string; qrDataUrl: string }>(
    rol,
    "POST",
    `/production-orders/${opId}/rolls`,
    { weightKg: pesoKg, ...extra }
  );
  const codigo = `${PREFIJO[fila.station]}-${fila.stationSequence}`;
  return { id: fila.id, codigo, qr: `${codigo}-${fila.possessionToken}`, imagenEtiqueta: fila.qrDataUrl, token: fila.possessionToken, pesoKg };
}

export async function detalleOp(opId: number, rol: Rol = "produccion") {
  return exito<any>(rol, "GET", `/production-orders/${opId}`);
}

/** Saldo actual de un rollo (kg que todavía se pueden consumir). */
export async function saldoDeRollo(codigo: string, rol: Rol = "produccion"): Promise<number> {
  return (await exito<{ remainingKg: number }>(rol, "GET", `/production-orders/rolls/by-code/${codigo}`)).remainingKg;
}

const RELOJ = { clientTimezone: "America/Bogota", clientUtcOffsetMinutes: -300 };

/** Rol del operario de cada estación. */
export const OPERARIO_DE: Record<Estacion, Rol> = { extrusion: "extrusion", impresion: "impresion", sellado: "sellado", precorte: "precorte" };

/** Despacha el rollo a la bodega de `destino` y lo recibe allá (como lo haría su operario). */
export async function moverRolloA(rollo: RolloCreado, destino: Exclude<Estacion, "extrusion">): Promise<void> {
  const operario = OPERARIO_DE[destino];
  const traslado = await exito<{ id: number }>(operario, "POST", "/roll-transfers", {
    code: rollo.codigo,
    token: rollo.token,
    toStation: destino,
    mode: "retiro",
    ...RELOJ,
  });
  await exito(operario, "POST", `/roll-transfers/${traslado.id}/receive`, { code: rollo.codigo, token: rollo.token, ...RELOJ });
}

/** Deriva la OP a otra estación y devuelve la OP hija. */
export async function derivarOp(opId: number, estacion: Estacion): Promise<OpCreada> {
  return exito<OpCreada>("produccion", "POST", `/production-orders/${opId}/derive`, { station: estacion });
}

/** Genera etiquetas de bulto en blanco y devuelve sus códigos (ej. `EXT-00001`). */
export async function generarEtiquetasBulto(cantidad: number): Promise<string[]> {
  const etiquetas = await exito<{ code: string }[]>("produccion", "POST", "/bulto-labels/generate", { count: cantidad });
  return etiquetas.map((e) => e.code);
}
