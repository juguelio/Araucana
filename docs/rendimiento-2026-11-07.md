# Rendimiento — auditoría y mejoras (7-nov-2026)

Rama `perf/rendimiento-20261107` sobre `main` `d6399af` (PR #31 incluido). 12 commits chicos, **sin migraciones**.
Hecho por Claude a pedido de Jugue; lo publica Hermes con el brief `BRIEF-araucana-rendimiento-2026-11-07`.
Lo que no se midió está marcado como «no medido».

## 1. Producción (sólo lecturas, sin sesión)

- Funciones en **`iad1`** (`x-vercel-id: iad1::iad1::…`, 3 de 3) y base Neon en **`us-east-1`** (host de `.env`
  leído sin credenciales). **Están en la misma región: no hay un problema de distancia** (a diferencia de cannabis-club).
- `DATABASE_URL` usa el host **directo** de Neon, no el `-pooler`.
- TTFB desde el contenedor (EE. UU.): páginas en caché de Vercel 130-370 ms; dinámicas (`/rutas`, `/reservar/…`)
  170-300 ms en caliente, **1,3-3,0 s en frío** (primer pedido: función nueva + conexión nueva a Neon).
- La home **pesa ~26 MB en el celular**: `hero-araucana.mp4` (21,5 MB, 1280×720, 56 s) y `video-aeropuerto.mp4`
  (4,4 MB, 1080×1920) arrancan solos. Imágenes y videos de `/public` con `Cache-Control: max-age=0, must-revalidate`.
- No hay `/api/health`: no se midió el tiempo de una consulta en producción.

## 2. Cómo se midió

- Build de producción (`next build` + `next start`) de `main` (worktree propio) y de la rama, contra el **mismo**
  Postgres 16 local, con un proxy TCP que agrega latencia por sentido: **2 ms** (≈ misma región, el caso real) y
  **25 ms** (exagerado, para que se vean las consultas encadenadas).
- Datos con los volúmenes de producción del 6-nov (39 naves, 36 sin asientos; ~630 salidas futuras de Traful;
  280 `Schedule` por ruta de aeropuerto; 56 de Hua Hum; 532 vuelos; 78 eventos) más **~430 reservas inventadas**
  para simular temporada. Todo inventado; ningún dato de producción.
- Servidor: 1 pedido de calentamiento + 3 medidos por pantalla; consultas = líneas `statement/execute` que llegan a
  Postgres (`log_statement=all`, reseteado al final).
- Celular: Chromium 390×844, CPU ×4, mediana de 3 cargas; LCP/FCP por `PerformanceObserver`; KB transferidos.
  **Chromium de Playwright no reproduce H.264**: el peso de los videos se toma del tamaño de los archivos.

## 3. Resultados

### Servidor (ms en caliente, promedio de 3)

| Pantalla | Consultas main → rama | 2 ms main → rama | 25 ms main → rama | HTML KB main → rama |
|---|---|---|---|---|
| `/rutas` | 11 → 9 | 428 → 207 | 738 → 464 | **552 → 69** |
| `/rutas/sma-villa-traful` | 6 → 5 | 165 → 144 | 465 → 378 | 19 → 19 |
| `/reservar/sma-villa-traful` | 6 → 5 | 292 → 246 | 541 → 483 | **538 → 187** |
| `/reservar/aeropuerto-chapelco-sma` | 9 → 9 | 74 → 73 | 489 → 486 | 19 → 19 |
| `/reservas/<código>` | 8 → 8 | 68 → 56 | 432 → 441 | 17 → 17 |
| `/admin` | 17 → 16 | 88 → 71 | 594 → 568 | 22 → 23 |
| `/admin/reservas` | 15 → 11 | 117 → 103 | 813 → 685 | 67 → 68 |
| `/admin/reservas/<código>` | 13 → 12 | 93 → 88 | 697 → 644 | 21 → 21 |
| `/admin/aeropuerto` | 13 → 12 | 102 → 99 | 730 → 657 | 107 → 107 |
| `/admin/rutas` | 3 → 2 | 41 → 36 | 176 → 152 | 28 → 28 |
| `/admin/rutas/<id>/salidas` | 8 → 6 | **407 → 221** | 782 → 489 | 107 → 107 |
| `/admin/naves` | 3 → 2 | 67 → 80 | 192 → 166 | 161 → 161 |
| `/admin/naves/<id>` | 4 → 3 | 45 → 40 | 228 → 175 | 33 → 34 |
| `/admin/usuarios` | 3 → 2 | 37 → 46 | 183 → 134 | 43 → 44 |
| `/admin/contabilidad` | 12 → 11 | 199 → 230 | 645 → 594 | 22 → 23 |
| `/admin/reportes` | 11 → 10 | 185 → 180 | 715 → 565 | 26 → 27 |
| `/admin/chapelco` | 8 → 7 | 50 → 43 | 382 → 328 | 30 → 30 |
| `/chofer` | 20 → 20 | 97 → 91 | 750 → 751 | 78 → 78 |
| `/`, `/soporte`, `/api/v1/routes` | sin cambios | ≤ 23 | ≤ 70 | — |

Ruido: con 2 ms las diferencias de ±30 ms son ruido (las pantallas con 2-3 consultas suben o bajan al azar). Lo que
no es ruido: una consulta menos en **todas** las pantallas con sesión, `/rutas` y el calendario de salidas a la mitad,
y el HTML de `/rutas` y `/reservar` 3-8 veces más chico. `contabilidad` en 2 ms (199 → 230) es ruido: en 25 ms baja y
la consulta trae sólo el mes (ver punto 9).

### Celular simulado (mediana de 3)

| Pantalla | FCP main → rama | LCP main → rama | Imágenes KB | HTML KB (comprimido) | JS KB |
|---|---|---|---|---|---|
| `/` | 376 → 492 | **716 → 492** | 746 → 258 | 60 → 21 | 184 → 146 |
| `/rutas` | 792 → 504 | **920 → 504** | 315 → 22 | 68 → 19 | 142 → 146 |
| `/reservar/sma-villa-traful` | 480 → 508 | 480 → 560 | 315 → 22 | 92 → 30 | 154 → 157 |
| `/reservar/aeropuerto…` | 268 → 356 | 268 → 356 | 315 → 22 | 56 → 16 | 154 → 157 |
| `/admin/reservas` | 388 → 412 | 388 → 436 | 315 → 22 | 76 → 51 | 143 → 147 |
| `/admin/aeropuerto` | 372 → 320 | 372 → 352 | 331 → 38 | 73 → 39 | 144 → 148 |
| `/chofer` | 316 → 332 | 316 → 332 | 315 → 22 | 60 → 27 | 167 → 170 |

- **Videos de la home en un celular: 25,9 MB → 3,2 MB** (hero móvil 2,4 MB + tarjeta 0,75 MB). Por tamaño de archivo.
- Los 315 KB de imágenes que `main` baja en **todas** las pantallas son el prefetch de las fotos de la home y el logo
  PNG; en la rama son el logo WebP (22 KB) porque las fotos de la home ahora son `loading="lazy"`.
- Las pantallas que no cambiaron quedan dentro de ±90 ms en FCP/LCP: en esta máquina (2 vCPU, servidor y navegador
  juntos, CPU ×4) es ruido; no se afirma mejora ni empeora. JS +3-4 KB por el componente de Web Vitals.

## 4. Qué cambia (commits)

1. `perf(auth)` — la sesión se resuelve en **una** consulta (`user.findFirst` con `sessions.some`), antes dos
   encadenadas (`include: { user: true }`). Corre en cada pantalla y en cada pedido autenticado de la API. Probado:
   token vigente 200, vencido 401 y la sesión se borra; `/admin` sin sesión sigue en 307 → `/login`.
2. `perf(salidas)` — los listados de salidas piden `_count` de asientos y de cada reserva sólo estado y lugares (antes
   cada asiento y cada reserva completa). El calendario de salidas del panel pedía **todas las salidas de todas las
   rutas** y filtraba en la página: ahora pide las de la ruta (filtro `routeId`, con test).
3. `perf(reservar)` — el formulario recibe las salidas sin la ruta repetida en cada una (`CheckoutScheduleDto`).
   La API `/api/v1/schedules` no cambia.
4. `perf(rutas)` — **cambio visible**: el carril de `/rutas` muestra las próximas 30 salidas por ruta; el contador
   sigue mostrando el total y en Consultar disponibilidad se eligen todas. **Pedir el OK de Iván**; se revierte solo.
5. `perf(admin/reservas)` — conteo y página en paralelo; la tabla usa un `include` propio sin la nave con todos sus
   asientos ni el ticket (3 viajes menos). Mismo DTO, paginación igual.
6. `perf(home)` — hero con fuente móvil (`media="(max-width: 760px)"`, 640 px, 2,4 MB, mismo clip) + póster de
   108 KB; tarjeta del aeropuerto a 720 px (745 KB); logo, story, flota y Lanín en WebP (mismas imágenes);
   `loading="lazy"` abajo del pliegue; `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` para
   videos e imágenes de `/public` (los archivos nuevos tienen nombre nuevo; los originales quedan).
7. `perf(externos)` — `AbortSignal.timeout` a AirLabs y al tablero FIDS (8 s; se llaman **al renderizar**
   `/reservar/<aeropuerto>`) y a Google userinfo (10 s). Caen en el manejo de error que ya existía.
8. `obs` — consultas de ≥ 300 ms (`SLOW_QUERY_MS`) → `console.warn({evento:"consulta_lenta", ms, sql})`, **sin
   parámetros**. Web Vitals reales → `POST /api/vitals` (zod) → `console.info({evento:"web_vital", …})`; ruta sin
   códigos ni ids (`rutaSinIds`, con tests). Sin base, sin terceros, sin cookies.
9. `perf(contabilidad)` — `getAccountingReport` (Contabilidad, Reportes, Excel) traía **todas** las reservas
   confirmadas de la historia y filtraba el mes en JS. Ahora filtra en la base con la misma fecha que
   `reservationToIncome`. Verificado contra la base de medición con casos borde (confirmada con pago pendiente, pago
   aprobado en otro mes, cancelada con pago aprobado, confirmada sin pago) en 4 meses: **mismas reservas**.
10. `perf(home)` — el mapa crea Leaflet y pide los mosaicos de OpenStreetMap (~100 KB) cuando se acerca a la vista.
11. `fix(rutas)` — **bug encontrado al probar en 390 px**: el radio oculto de cada salida (`position:absolute` sin
    ancestro posicionado) estiraba el documento a **46.531 px** de ancho en un celular; se podía deslizar de costado a
    una zona en blanco y enfocar una salida movía la página. `position:relative` en la tarjeta; nada cambia a la vista.
12. `perf(obs)` — el componente de Web Vitals no importa zod (le sumaba ~25 KB de JS a todas las pantallas).

**Probado y descartado: esqueletos (`loading.tsx`).** Adelantan el primer pintado, pero (a) el LCP al entrar directo
empeoró 150-450 ms (`/reservar` 524 → 868, `/admin/reservas` 488 → 640, mediana de 3) y (b) con `loading.tsx` en
`/admin`, un pedido sin sesión pasa de **307 a `/login` a 200 con redirección por meta refresh** (rompe el live-check).
No quedan en la rama.

## 5. Verificación

- `npx tsc --noEmit` 0 · `npx vitest run` **263/263** (259 en `main` + 4 nuevos) · `npm run build` OK.
  Cada uno de los 12 commits compila y pasa los tests por separado. `depcheck`: sin dependencias sin usar.
  No hay script `lint` en el repo: no se corrió ESLint.
- Flujo en 390 px sobre el build de la rama: `/rutas` → Consultar disponibilidad → datos → reserva creada (una sola) →
  enlace privado; sin scroll horizontal (`scrollWidth 390`); el panel la muestra; `/admin/reservas` sin sesión → 307;
  token vencido → 401 y sesión borrada; `/api/vitals` 204/400 y la línea en el log; `consulta_lenta` en el log con
  `SLOW_QUERY_MS=1`; el log no tiene datos del pasajero; archivos nuevos de `/public` con el `Cache-Control` nuevo.
- **No medido / no probado:** producción con estos cambios (no hubo deploy); un iPhone o Android real; video H.264 en
  el navegador de prueba; calidad visual del hero móvil en una pantalla retina (640 px estirado a cover: a revisar);
  Google OAuth; subida real a Blob; Chapelco con reservas del día; re-renders del lado del cliente.

## 6. La lista de 31, punto por punto

| # | Mejora | Estado | Nota |
|---|---|---|---|
| 1 | Skeletons | Probado y descartado | ver arriba (LCP y 307→200) |
| 2 | WebP/AVIF | Hecho | logo, story, flota, Lanín, póster |
| 3 | Llamadas duplicadas | Hecho | sesión 2 → 1; no se encontraron otras repetidas |
| 4 | Debounce | No hace falta | no hay búsquedas que consulten mientras se escribe |
| 5 | Paginar | Ya estaba | reservas del panel; resto de listas chicas o por día/mes |
| 6 | CDN | Ya estaba | Vercel |
| 7 | Cola de trabajos | Para Hermes | la sincronización de vuelos corre al renderizar `/reservar/<aeropuerto>` (con freno y timeout); pasarla a un cron |
| 8 | N+1 | Ya estaba | Prisma agrupa por `IN`; no hay N+1 |
| 9 | Brotli/Gzip | Ya estaba | `content-encoding: br` |
| 10 | Caché (Redis) | No hace falta | sin proveedor nuevo; volumen chico |
| 11 | Dependencias sin usar | Ya estaba | depcheck limpio |
| 12 | Timeouts externos | Hecho | AirLabs, FIDS, Google |
| 13 | Streaming | Probado y descartado | es el mismo `loading.tsx` |
| 14 | UI optimista | No aplica | formularios con acción de servidor; no hay listas que se editen en vivo |
| 15 | Lazy loading | Hecho | imágenes abajo del pliegue y mapa |
| 16 | Peticiones en paralelo | Hecho / Ya estaba | conteo + página de reservas; panel y chofer ya en `Promise.all` |
| 17 | Índices | No hace falta (todavía) | `Reservation` no tiene índice por `createdAt`/`status`; con 8 reservas reales no pesa. Revisar arriba de ~10.000 |
| 18 | Rastrear consultas lentas | Hecho | `consulta_lenta` |
| 19 | Servidor cerca de la base | Ya estaba | `iad1` + Neon `us-east-1` |
| 20 | Render en servidor | Ya estaba | RSC |
| 21 | Scripts de terceros después | Hecho | el único es OpenStreetMap del mapa |
| 22 | Dividir JS | Hecho / Ya estaba | Leaflet fuera de la carga inicial; el resto es React/Next |
| 23 | Virtualizar listas | No hace falta | carril de `/rutas` acotado (punto 4 de los commits) |
| 24 | Sólo las columnas | Hecho | salidas, reservas del panel, contabilidad por período |
| 25 | Pool | Para Hermes | `DATABASE_URL` usa el host directo; pasar al `-pooler` |
| 26 | Re-renders | No medido | |
| 27 | Cachear estáticos | Hecho | `Cache-Control` de `/public` |
| 28 | Repartir tráfico | No aplica | Vercel |
| 29 | Fuentes propias | Ya estaba | `next/font` (Poppins servida por la app) |
| 30 | Medir usuarios reales | Hecho | `/api/vitals` |
| 31 | Probar en celulares | Hecho (simulado) / No medido (real) | 390 px, CPU ×4; falta un teléfono real |

Conteo por estado principal (el primero de cada fila): Hecho 12 · Ya estaba 8 · No hace falta 4 · No aplica 2 ·
Para Hermes 2 · Probado y descartado 2 · No medido 1 = 31.

## 7. Para Hermes (fuera de la rama)

- **Pool:** cambiar `DATABASE_URL` de producción al host `-pooler` de Neon con `pgbouncer=true&connection_limit=5`
  (y `DIRECT_URL` al directo si se usan migraciones). Es lo que más va a bajar los 1,3-3 s del primer pedido.
  Verificar la huella de la base antes y después, sin mostrar la URL.
- **Vuelos en un cron** en vez de al renderizar la página pública.
