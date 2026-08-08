import { Prisma } from "../generated/prisma/client";

/**
 * Los números consecutivos (COT-00001, PED-00001, FAC-00001, OP-00001) se
 * calculan con `count()+1` dentro de una transacción, que NO es atómico:
 * dos requests casi simultáneas pueden calcular el mismo número y chocar
 * contra el unique constraint. En vez de rediseñar a una tabla de secuencia
 * dedicada (overkill para el volumen de un equipo de ventas chico), se
 * reintenta la transacción completa unas pocas veces si el choque ocurre —
 * en el reintento el count() ya ve la fila que acaba de commitear la otra
 * request, así que el segundo intento calcula el número correcto.
 */
export async function withSequentialNumberRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isUniqueConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isUniqueConflict || attempt === attempts) throw err;
    }
  }
  // Inalcanzable: el loop siempre retorna o lanza en el último intento.
  throw new Error("withSequentialNumberRetry: no debería llegar acá");
}
