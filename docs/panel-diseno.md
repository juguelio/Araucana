# Diseño del panel: qué se cambió y por qué

Resumen de la tanda de diseño del panel de administración (13 y 14 de noviembre de 2026, más las pantallas de rutas del 15). Todo es **presentación**: mismas consultas, mismas acciones, sin migraciones. Cada pantalla tiene su hoja de estilos propia; `globals.css` no se tocó en ninguna.

Sirve para no repetir discusiones ya cerradas y para saber dónde mirar cuando algo se ve distinto.

## Las pantallas

| Pantalla | PR | Qué se arregló |
|---|---|---|
| Menú lateral / barra del celular | #129 | El menú entra en el celular; el activo se ve y hay pista de que sigue habiendo secciones |
| Aeropuerto (listado) | #130 | El día se lee de un vistazo: arribos, partidas, pasajeros, vuelos con imprevisto |
| Reservas (listado) | #131 | Se lee en el celular y marca lo que pide acción |
| Portada del panel | #132 | Abre lo que se usa todos los días |
| Ficha de reserva | #133 | Estado arriba, comprobante a mano |
| Menú del celular: indicio de scroll | #134 | Chevron sobre el degradé cuando hay más secciones |
| Ficha de viaje especial | #143 | Cabecera con fecha, estado, pasajeros, total y contacto; itinerario como línea de tiempo; «Falta: …» con saltos a la sección o a la edición |
| Listado de viajes especiales | #144 | «Falta:» bajo el estado; tarjetas en el celular; filtros plegados |
| Naves (flota y vencimientos) | #154 | Bloque «Vencimientos de la flota» arriba, ordenado por urgencia; tarjetas en el celular |
| Rutas (listado) | #155 | Avisa qué rutas activas no tienen precio o salidas, y cuáles no aparecen en la web |
| Salidas de una ruta | #156 | Las tarjetas entran en la celda: «Cerrar» y «×» ya no quedan fuera de la vista |

## Reglas que se siguieron

1. **Sólo presentación.** Si un cambio necesita tocar una consulta, un server action o el esquema, va en otro PR.
2. **Hoja de estilos propia por pantalla** (`ficha.css`, `listado.css`, `naves.css`, `rutas.css`, `salidas.css`). `globals.css` se deja quieto para no arrastrar otras pantallas.
3. **Los datos que no existen no se inventan.** Si un campo es texto libre que escribe el operador (por ejemplo el estado de pago de un viaje especial), no se traduce ni se formatea a ciegas: se muestra como está.
4. **Dos anchos, siempre**: 1280 y 390. En el celular las tablas pasan a tarjetas con rótulos; ninguna pantalla del panel debe tener scroll horizontal propio.
5. **Medir, no estimar.** Lo que se afirma en el PR se midió en el navegador (píxeles de desborde, conteos, textos), no se dedujo del código.

## Un detalle del entorno de build

`src/app/layout.tsx` importa `Poppins` de `next/font/google`: **cada build descarga la fuente**. Un corte de red hacia Google hace fallar el build aunque el código esté bien. Si un deploy falla sin errores de TypeScript ni de tests, mirar ahí primero.
