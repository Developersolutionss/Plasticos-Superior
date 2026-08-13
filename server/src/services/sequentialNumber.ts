import { Prisma } from "../generated/prisma/client";

/**
 * Los números consecutivos (COT-00001, PED-00001, FAC-00001, OP-00001) se
 * calculan con `count()+1` dentro de una transacción, que NO es atómico:
 * dos requests casi simultáneas pueden calcular el mismo número y chocar
 * contra el unique constraint. En vez de rediseñar a una tabla de secuencia
 * dedicada (overkill para el volumen de un equipo de ventas chico), se
 * reintenta la transacción completa si el choque ocurre — en el reintento
 * el count() ya ve la fila que acaba de commitear la otra request, así que
 * el siguiente intento calcula el número correcto.
 *
 * Con varios requests simultáneos (ej. varios vendedores facturando a la
 * vez) puede haber más de una colisión en cadena, así que cada reintento
 * espera un backoff creciente con jitter antes de reintentar — si no,
 * todos los requests trabados vuelven a leer el mismo `count()` en el
 * mismo instante y chocan de nuevo entre ellos.
 */
export async function withSequentialNumberRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isUniqueConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isUniqueConflict || attempt === attempts) throw err;
      const delayMs = 10 * attempt + Math.random() * 30;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Inalcanzable: el loop siempre retorna o lanza en el último intento.
  throw new Error("withSequentialNumberRetry: no debería llegar acá");
}
