# Cómo armo las demos/pruebas con Playwright

Este archivo documenta el patrón que uso para probar features en el navegador con Playwright
en este proyecto — tanto pruebas rápidas de verificación como demos narradas para que el
usuario las mire en vivo. Es una guía de trabajo, no documentación técnica del sistema.

## Cuándo uso cada modalidad

- **Prueba rápida** (`slowMo: 150-250`, sin narración): para verificar que algo funciona antes
  de reportarlo. Corre en segundos, solo me interesa el resultado en consola/asserts.
- **Demo narrada** (`STEP_SECONDS = 12`, con banner en pantalla): cuando el usuario pide "ver"
  el flujo, paso a paso, para poder juzgarlo él mismo antes de aprobar. Cada paso se anuncia
  antes de ejecutarse y se sostiene ~12s para que a simple vista se note el cambio.

En ambos casos: **ventana visible** (`headless: false`), nunca headless — así el usuario puede
mirar la pantalla mientras corre (ver memoria `browser-visible-window`).

## Ubicación y limpieza

- El script vive como archivo suelto en la raíz del repo (ej. `demo-seleccion-sugerencias.mjs`,
  `test-multi-sugerencias.mjs`) para que `node archivo.mjs` resuelva `node_modules/playwright`
  sin tener que instalar nada aparte — Playwright ya es devDependency del proyecto.
- **Siempre se borra después de correrlo** (`rm archivo.mjs`) — nunca queda commiteado. Antes de
  cualquier commit, `git status --short` tiene que salir limpio de estos archivos sueltos.
- Alternativa más prolija (no usada por ahora, pero válida): escribirlo en el scratchpad de la
  sesión y copiarlo a la raíz solo para ejecutar, después borrar la copia — evita tocar el
  working tree del repo en absoluto salvo por la ejecución misma.

## Estructura de un script de demo narrada

```js
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const API = "http://localhost:4000/api";
const STEP_SECONDS = 12;

async function showStep(page, n, text) {
  console.log(`\n=== PASO ${n} === ${text}`);
  await page.evaluate((msg) => {
    let el = document.getElementById("__demo_banner__");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo_banner__";
      el.style.position = "fixed";
      el.style.top = "0";
      el.style.left = "0";
      el.style.right = "0";
      el.style.zIndex = "999999";
      el.style.background = "#0f172a";
      el.style.color = "#fff";
      el.style.padding = "10px 16px";
      el.style.fontFamily = "sans-serif";
      el.style.fontSize = "15px";
      el.style.borderBottom = "3px solid #10b981";
      document.body.appendChild(el);
    }
    el.textContent = msg;
  }, `PASO ${n}: ${text}`);
  await page.waitForTimeout(STEP_SECONDS * 1000);
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 250 });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await page.goto(BASE);
  await showStep(page, 1, "Descripción del paso 1");
  // ... acción del paso 1 ...

  await showStep(page, 2, "Descripción del paso 2");
  // ... acción del paso 2 ...

  console.log("\n=== FIN DE LA DEMO ===");
  await page.waitForTimeout(8000); // deja la ventana abierta un rato al final
  await browser.close();
}

main().catch((err) => {
  console.error("ERROR EN LA DEMO:", err);
  process.exit(1);
});
```

Claves del patrón:

- El banner (`__demo_banner__`) es un `<div>` fijo arriba de la página, inyectado con
  `page.evaluate`, para que el paso actual se lea directamente sobre la pantalla que el usuario
  está mirando — no alcanza con loguear en la terminal si el usuario no está leyendo la consola.
- `showStep` imprime también por `console.log` — así el transcript de la sesión queda con el
  registro de qué pasó en cada paso, útil para citarlo en el resumen final.
- Cada paso hace **una sola cosa observable** (un clic, un cambio de página, un chequeo visual)
  y se anuncia ANTES de ejecutarla, no después — el usuario tiene que poder anticipar qué va a
  ver.

## Login y datos de prueba

- Login siempre como `admin@empresa.com` / `password123` (`super_admin`, pertenece a todos los
  grupos de rol) salvo que la demo necesite probar un permiso específico de otro rol.
- El token se saca de `localStorage` después del login (`page.evaluate(() => localStorage.getItem("token"))`)
  y se reusa para llamadas directas por `fetch` a la API — sirve para preparar el escenario
  (crear clientes/productos/órdenes/sugerencias de antemano) sin tener que clickear todo el setup
  a mano en el navegador, dejando la demo enfocada en la parte que importa mostrar.
- Cuando el escenario necesita "historial" (ej. varias OPs pasadas para que el sistema calcule
  una sugerencia por frecuencia), ese historial se genera por `fetch` a los endpoints reales
  (`POST /production-orders`, `POST /:id/derive`, etc.), nunca insertando filas directo en la
  base — así la demo prueba el camino real, no un atajo que podría esconder un bug.
- Elegir un cliente/producto distinto en cada demo nueva (ej. `products[3]`, `products[5]`)
  evita que el historial de una corrida anterior contamine la sugerencia por frecuencia de la
  siguiente corrida contra la misma base de datos de desarrollo compartida.

## Verificación real, no solo visual

Además de lo que se ve en pantalla, cada demo/prueba relevante confirma el resultado contra el
servidor por `fetch` directo (no solo leyendo el DOM) — por ejemplo, después de aplicar una
sugerencia y guardar, se vuelve a pedir la OP a la API y se compara el campo guardado con el
valor esperado. Esto separó dos veces un "parece que funciona" de un bug real:

- Confirmó que aplicar una sugerencia solo llena el *borrador* (`specsDraft`/estado local) y que
  hace falta el clic en "Guardar cambios" para que persista — sin ese chequeo, una demo que solo
  mira la pantalla sin guardar puede parecer "no guardó nada" cuando en realidad es el
  comportamiento esperado (mismo patrón que cualquier otro campo de la hoja).
- Confirmó que Materia Prima (una lista de filas, no un valor simple) quedaba afuera del cálculo
  de frecuencia y de "aplicar sugerencia" hasta que se agregó soporte explícito para eso.

## Errores ya pisados (para no repetirlos)

- **Selector ambiguo por texto repetido**: `getByText("MATERIA PRIMA")` puede matchear el menú
  lateral, el encabezado de la tabla y hasta el banner de la demo a la vez. Solución: acotar con
  `page.getByRole("main").getByText(...)` o un selector más específico.
- **Menú "+N más" que tapa el siguiente clic**: si el menú de `SuggestionSources` queda abierto
  (`menuOpen: true`) y el siguiente paso intenta clickear OTRO botón "+N más", el backdrop
  (`<div class="fixed inset-0">`) del menú abierto intercepta el clic. Hay que cerrar el menú
  primero (`page.mouse.click(x, y)` en un punto vacío) antes de la siguiente interacción que lo
  necesite cerrado.
- **Botón "Ingresar", no "Iniciar sesión"**: el texto real del botón de login es "Ingresar" — un
  selector por `/iniciar sesión/i` nunca matchea y el script se cuelga en el primer paso.
- **`npm run <script> -- --nombre`, cuando el script encadena dos comandos con `&&`**: el flag
  extra se pega al ÚLTIMO comando de la cadena, no al primero. Pasarle `--name` a
  `npm run prisma:migrate` (que es `prisma migrate dev && prisma generate`) termina
  mandándoselo a `prisma generate`, y `prisma migrate dev` se queda esperando el nombre por
  stdin de forma interactiva. Mejor invocar `npx prisma migrate dev --name ...` directo cuando
  se necesita pasarle un flag puntual.
