# Reservas y preparación de lanzamiento — 14/11/2026

## Dictamen

El producto está avanzado y es candidato a un piloto supervisado después de publicar y aceptar estas correcciones. Esta revisión **no autoriza un lanzamiento sin supervisión**: faltan aceptación del circuito real de comprobantes/cobro, política de reservas abandonadas y tratamiento de reintentos, y decisiones operativas del cliente.

La web ya está publicada; «responde en producción» no acredita que pueda operar de extremo a extremo con pasajeros reales.

## Base y alcance

- Se actualizó `upstream/main`: base `64e19a5` (PR #134).
- Rama aislada: `codex/live-readiness-20261114`, worktree `/Users/altostake/Dev/araucana-live-review`.
- El checkout principal estaba en `64450ff`, con cambios de otro agente y sin dependencias. La revisión anterior describía esa rama vieja, no el último main. No se tocaron sus cambios.
- Se revisaron reservas de aeropuerto, ida/vuelta, cupos, cobros/revisión, cancelación/restitución, navegación, pruebas, migraciones y dependencias.
- No se crearon reservas ni se modificó configuración de producción. Las escrituras de prueba se hicieron en PostgreSQL local descartable, puerto 55439, base `araucana_review`.

## Correcciones implementadas en esta rama

1. **P1, cotización:** ida/vuelta ahora incluye el recargo de zona de cada domicilio y el equipaje; pasa la configuración tanto desde la web como desde el panel. Los totales de distintas monedas se muestran separados.
2. **P1, sentido:** la consulta y la selección del vuelo exigen ARRIVAL/DEPARTURE según el tramo pedido. Se rechaza un arribo enviado como salida.
3. **P2, cronología:** se resuelven ambos vuelos en la transacción y se comprueba que el segundo ocurra después del primero, incluso el mismo día y con demora. La interfaz también valida antes de avanzar/enviar. No se inventó un margen mínimo de conexión: falta definición operativa.
4. **P2, resultado:** los enlaces de pago y el resumen respetan el orden de ida/vuelta elegido, con etiquetas explícitas de llegada/salida.
5. **P1, restitución:** una documentación ya aprobada vuelve a CONFIRMED; antes volvía a DOCUMENTATION_PENDING con pago APPROVED, un estado que la revisión posterior no admitía.
6. **P1, restitución y operación:** aplica los cortes del aeropuerto también al restituir; antes podía reactivar una salida cuya recorrida ya había arrancado.
7. **P2, dependencias:** Zod 4.4.3 → 4.6.7, actualización compatible señalada por npm audit para corregir agotamiento de memoria con colecciones restringidas sobredimensionadas. Lockfile actualizado; no se aplicaron upgrades mayores automáticos.
8. **P2, calidad:** claves React únicas en menú público; expectativa E2E de excursiones actualizada al catálogo real; opción `PLAYWRIGHT_USE_BUILD=1` para verificar el build optimizado con las mismas protecciones del runner.

Sin cambios de esquema ni migraciones nuevas.

## Evidencia

- Base antes de cambios: **715/715** unitarios.
- Reproducciones antes del arreglo: **3 fallos** de sentido/horarios, **2 fallos** de restitución. Después pasan.
- Suite final: **728/728**, 104 archivos.
- `npx tsc --noEmit`: sin errores.
- `next build --webpack`: correcto, con URL de base local. No se usó el build para migrar producción.
- Todas las migraciones existentes aplicadas desde cero en PostgreSQL local: correcto.
- Navegador contra el build: suite general **13/14** inicialmente; el único fallo restante era el selector del nuevo test móvil. Corregidos los labels del test, los **3/3** casos de aeropuerto pasan. Los otros 11 escenarios ya estaban correctos. No se afirma una nueva ejecución única de 14/14.
- API: vuelo del sentido incorrecto y vuelta anterior rechazados sin reservas parciales.
- API y BD: dos reservas/pagos creados con recargo, importes persistidos coincidentes.
- Concurrencia: dos solicitudes simultáneas por los últimos 22 lugares → una 201 y una 409; ocupación final exactamente 24. No se acepta 429 como prueba de exclusión de cupo.
- Móvil a 390 px: selecciona vuelos, usa domicilio con recargo, muestra $30.000, carga pasajero, crea dos reservas cuyo total es $30.000, muestra dos enlaces de pago; sin desborde horizontal. Captura local: `/tmp/araucana-live-checkout-mobile.png`.
- Otros E2E: acceso, home/menú, excursiones y roles, reserva regular, rechazo y aprobación de comprobante. **Blob externo se simula** en los tests existentes: no acredita almacenamiento remoto.
- En `next dev --webpack` se reprodujo un problema de idioma; en el build optimizado local los tres idiomas pasan y la página pública inglesa responde en inglés. No se modificó el middleware basándose sólo en ese fallo de desarrollo.
- Lecturas públicas de producción: home 200, `/admin` 307, `/admin/reportes/export` 401; `/en/excursiones` en inglés. No se verificó sesión ADMIN real ni descarga autenticada.
- `npm audit --omit=dev` final: 0 críticos, 3 entradas high (cadena Prisma/@prisma/config/deepmerge-ts) y 2 moderate (ExcelJS/uuid). No son cinco fallas independientes: incluyen dependencias afectadas por los mismos avisos. Pendiente evaluar exposición y remediación de esas cadenas.

## Qué falta para abrir, en orden

### P1 — Publicar y aceptar el circuito de reservas/cobro

Revisar y publicar esta rama; después hacer un recorrido controlado en el entorno publicado: reserva, cuenta/alias correctos, subida a Blob privado, visualización por operador, rechazo, reenvío, aprobación, comprobante del pasajero y planilla del chofer. Comprobar permisos y montos en cada paso, con cancelación de una sola pata. La prueba local simula parte del almacenamiento: ese límite no debe confundirse con verificación de producción.

### P1 — Reintentos de alta y reservas abandonadas

El alta de aeropuerto no tiene clave de idempotencia: una solicitud completada cuya respuesta se pierde puede generar otra reserva cuando el usuario reintenta. El límite por IP no resuelve esa duplicación.

Los pendientes siguen ocupando lugares hasta cancelación; no se encontró vencimiento automático de reservas. Antes de recibir tráfico, definir un plazo/cola de gestión y proteger los comprobantes ya enviados. No cancelar ni vencer automáticamente con un tiempo inventado: transferencias y atención manual requieren una regla acordada. Estos dos puntos son la siguiente prioridad técnica/operativa.

### P1/P2 — Coherencia de horarios operativos

El corte de venta usa el horario estimado cuando hay demora, pero `airportPickupStart` calcula por defecto desde el programado y se usa en vistas/planillas. Unificar el criterio de hora mostrada, de la recorrida y de cierre, preservando la hora coordinada a mano. Hallazgo de lectura, pendiente de reproducción integral. También definir el margen mínimo entre dos traslados del mismo día: ahora se exige orden cronológico, no viabilidad de una conexión con determinado tiempo de viaje.

### P2 — Decisiones y trabajo abierto del cliente

Consulta de GitHub durante esta revisión:
- Issue #123: menor de 4 con asiento/sillita, decisión de cobro pendiente.
- Issue #136: planilla de chofer para salidas de ruta, recorrido y WhatsApp.
- Issue #110: planilla de excursiones, PR #126 abierto.
- PR #135 abierto: recorrido del día y WhatsApp. No duplicar ese trabajo.
- PR #42 sigue abierto aunque la rama revisada contiene un limitador por IP; revisar el estado antes de tratarlo como funcionalidad faltante.

Definir qué de esto integra el lanzamiento inicial y qué puede operar manualmente. Comprobar además flota/cupos, tarifas/recargos, domicilios y contactos finales sobre los datos reales; no se auditó toda la configuración de producción.

### P2 — Operación y recuperación

Acreditar responsables de atención y revisión de pagos, alertas de errores, monitoreo de altas fallidas y un procedimiento probado de respaldo/restauración. Los tests de esta pasada no prueban esos controles ni la capacidad de carga. No se asigna un porcentaje de avance ni fecha de salida sin esas evidencias.

## Repetir validación

Usar una base local descartable con migraciones aplicadas y `E2E_ISOLATED_DATABASE=1`. No copiar credenciales de producción. Compilar con la URL local, luego `PLAYWRIGHT_USE_BUILD=1 PLAYWRIGHT_BASE_URL=http://localhost:3219 npm run test:e2e -- --workers=1`, con `E2E_DATABASE_URL` y un secreto de sesión de prueba. Ejecutar `npm test` y `npx tsc --noEmit`.

La base y archivos de prueba no son datos de negocio. El runner conserva sus guardas contra bases habituales y servidores publicados. Los tests nuevos de aeropuerto exigen hostname de base local.
