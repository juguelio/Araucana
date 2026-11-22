# Naves en vivo: qué hacen los sistemas de seguimiento que existen y qué adoptamos

Análisis de productos de seguimiento de flota para decidir qué le falta al módulo de La Araucana y en
qué orden construirlo. Fecha: noviembre 2026. Autor: Cerebrito (agente), para Iván Muller y Jugue.

**Alcance del análisis.** Se leyó documentación pública y páginas de producto de cinco sistemas, no su
código ni su panel pago. No hay datos de uso de esos productos ni capturas de su operación real: los
patrones que siguen se citan de lo que cada uno publica. Lo que se afirma de *nuestro* repo está medido
sobre el código (archivo y modelo citados).

## Qué se miró

| Sistema | Qué aporta al análisis | Fuente |
|---|---|---|
| Traccar (open source) | El modelo de datos canónico del rubro: *posiciones*, *eventos*, *viajes*, *paradas*, *resumen*, *geocercas*, *replay*. Tipos de evento: en línea / sin reportar / inactivo, en movimiento / detenido, exceso de velocidad, entrada y salida de geocerca. | `traccar.org/reports/`, `traccar.org/events/` |
| Motive | "Fleet View" (unidad + chofer emparejados en un mapa) y "Historical Activity search": *"verify reports, confirm delivery schedules… accountability"*. | `gomotive.com/products/fleet-management/` |
| Track My Tour | Operación turística: historial por unidad **por fecha**, alertas por zona, umbral de velocidad configurable por unidad y **clic en la unidad → viaje activo + ETA al próximo punto**. | `trackmytour.in/tour-management/gps-tracking-software/` |
| Smart Fleet | Detalle del viaje con línea de tiempo, **link en vivo para compartir con la persona que se va a buscar**, y unidades **sin señal a los 15 min = offline**. | `smartwebinfotech.com/items/smart-fleet-saas-vehicle-tracking-system/1012` |
| 360Ground (shuttles) | Reportes de **viaje, kilómetros, paradas e inactividad por vehículo, listos para facturar y auditar**. | `360ground.com/cop32/fleet-gps-tracking/` |

## Los cinco patrones que se repiten

1. **El mapa en vivo no es el producto: es la puerta.** Todos los sistemas venden además historial,
   resumen del día y reportes exportables, porque eso es lo que se usa para facturar y auditar.
2. **La unidad sin señal no desaparece: queda marcada** con cuánto hace que no reporta (10 a 15 min en
   los casos citados).
3. **Las excepciones se listan aparte del mapa**: sin señal, exceso, inactividad. Nadie quiere
   descubrir un problema mirando pines.
4. **El historial se pide por fecha**, no por ventana móvil de horas.
5. **El estado se liga al servicio**: qué viaje está haciendo y cuándo llega (Track My Tour), o el
   viaje con su línea de tiempo (Smart Fleet). Es el patrón que más valor operativo tiene y el que
   nosotros todavía no tenemos.

## Estado en nuestro repo (antes de este cambio)

| Patrón | Estado previo | Dónde |
|---|---|---|
| Mapa con posición, velocidad y antigüedad | Sí | `/admin/naves/en-vivo` |
| Sin señal con minutos, sin desaparecer | Sí | `src/lib/driver/en-vivo.ts` (`VENTANA_SENAL_MINUTOS = 10`) |
| Recorrido dibujado por tramos, con color por unidad | Sí (PR #322) | `src/lib/driver/recorrido.ts`, `mapa-unidades.tsx` |
| Historial navegable **por fecha** | **No** (sólo ventana de 8 h) | — |
| Resumen del día por unidad (km, tiempos, paradas, máximo) | **No** | — |
| Excepciones listadas aparte del mapa | **No** | — |
| Historial de una unidad (salidas, vuelos, viajes) | Sí, pero es de **servicios**, no de posiciones | `/admin/naves/[id]/recorridos` |
| Reporte exportable para facturar | Parcial: `.xlsx` de servicios, no de kilómetros | `src/lib/*/export` |

## Lo que se construyó con este análisis

Dos cosas, ambas sobre el historial que ya escribe la app del chofer
(`DriverLocationSample`), sin tabla nueva y sin proceso en background:

1. **Resumen del día por unidad** (`src/lib/driver/jornada.ts`, `dia.ts`,
   `resumen-del-dia.tsx`): kilómetros, tiempo en movimiento, tiempo detenido, velocidad máxima,
   paradas de 5 minutos o más con su horario, primera y última señal. Es el reporte que el cliente
   puede facturar y el que hoy arma a mano.
2. **Excepciones del día** en la misma pantalla: sin señal (con minutos), exceso sobre el límite
   aplicado, día sin movimiento y cortes de señal repetidos.

Criterios que se respetaron, porque son los que hacen que un número se pueda defender:

- **Kilometraje con el mismo filtro que el mapa**: se descarta el temblor del GPS quieto (<25 m) y los
  saltos imposibles (>3 km o velocidad inferida >180 km/h). Un reporte perdido no infla lo que se
  factura.
- **La espera entre servicios no es una parada.** Un hueco de más de 60 minutos no suma tiempo
  detenido ni se cuenta como corte: es la unidad esperando en la base.
- **Las paradas sobreviven a un corte de señal** cuando los dos extremos dicen «detenida»: una unidad
  estacionada con mala cobertura estuvo detenida, no «desaparecida».
- **El límite de velocidad se muestra en pantalla** (80 km/h por defecto) porque es una definición del
  cliente, no una verdad del sistema.
- **El día se corta en hora argentina**, no en UTC, y se arma con el mismo criterio que el resto del
  repo (`timestamp without time zone` + UTC).

## Lo que deliberadamente NO se copia

- **Puntuación de conductores para sancionar** (driver behaviour scoring). Es una decisión laboral del
  cliente: primero el acuerdo con el chofer sobre el seguimiento; el sistema puede mostrar los hechos.
- **Hardware GPS en el vehículo.** La app del chofer ya manda posición y el contrato no incluye
  dispositivos.
- **Geocercas con alertas de entrada y salida.** Sin las zonas definidas por el cliente (base,
  aeropuerto, Chapelco) es una pantalla para configurar cero zonas.
- **Cumplimiento regulatorio** (ELD, horas de servicio, IFTA): no aplica a la operación de la agencia.
- **Heatmaps y analítica de flota**: se mira una vez y no se vuelve a abrir.

## Lo que falta y conviene hacer después (en orden de valor para el cliente)

1. ~~Ligar la unidad al servicio del día~~ **Hecho**: la pestaña «Servicios de hoy» cruza el tablero
   (salidas, vuelos, Chapelco y viajes especiales) con la posición de la unidad asignada y marca
   *sin nave*, *en riesgo*, *atención* o *listo*. Falta el paso siguiente: **ETA y hora de llegada
   registrada** (entrar al radio del punto de recogida), que necesita geocercas por servicio. **P1.**
2. **Persistir viajes y eventos** (`Trip`, `FleetEvent`) para que el resumen no se recalcule leyendo
   todo el día y para tener un lugar donde anotar «este corte fue por falta de datos del teléfono».
   **P2**, cuando haya volumen real.
3. **Exportar el resumen del día** a `.xlsx` con la forma de la hoja que el cliente ya usa. **P2.**
4. **Link público de sólo lectura** del resumen del día para el dueño o el pasajero. **P3**: es dato
   personal del chofer y necesita aviso y acuerdo escrito antes de exponerlo fuera del panel.
5. **Límite de velocidad por unidad** en lugar de uno global. **P3**, depende de la definición del
   cliente.

## Límites de este documento

- Las funciones de los otros sistemas se citan de sus páginas públicas; no se abrió su panel pago ni se
  midió su comportamiento.
- Los umbrales (parada de 5 min, límite de 80 km/h, 60 min entre servicios) son decisiones nuestras
  para poder mostrar algo coherente: están visibles en la pantalla y se cambian en un solo lugar
  (`src/lib/driver/jornada.ts`).
- Los datos con los que se verificó la pantalla son **sembrados en la base local**; en producción el
  historial todavía tiene pocas filas y así se reporta.
