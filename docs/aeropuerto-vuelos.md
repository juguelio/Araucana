# Programación y operación de los vuelos de Chapelco

## Próximos 35 días

El flujo de GitHub Actions **Programación de vuelos de Chapelco** consulta los servicios entre Buenos Aires (Aeroparque y Ezeiza) y Chapelco. Está programado para las 06:23 de Argentina desde `main` y admite ejecución manual. Cada registro identifica número de vuelo, sentido, fecha local, aeropuerto de origen, aeropuerto de destino y hora en Chapelco. La base guarda los instantes en UTC y el panel los muestra en hora argentina.

| Fuente en Flight | Significado para Operaciones |
|---|---|
| AR_OFICIAL | Vuelo publicado en el calendario de Aerolíneas Argentinas. |
| JA_OFICIAL | Vuelo publicado por JetSMART. |
| ITINERARIO | Horario de itinerario pendiente de confirmación por la aerolínea. Ese aviso también aparece al elegir el vuelo. |
| RETIRADO | Servicio retirado de la oferta. |
| REVISAR | El vuelo requiere revisión y conserva sus reservas, asignaciones o datos de coordinación. Aparece en Aeropuerto, en «Por verificar». No admite nuevas reservas. |
| MANUAL / PASAJERO | Carga del operador o vuelo privado declarado por un pasajero. |
| ESTIMADO | Proyección histórica de versiones anteriores. Está excluida de las reservas nuevas. |

Para JetSMART se consulta su tablero oficial durante la primera semana. Después se usa la programación mensual por ruta de FlightInformation y, si falta esa grilla, las ofertas fechadas de Almundo. Cada oferta debe identificar el operador, el número y el tramo directo. Una oferta permite incorporar o actualizar ese vuelo. Sólo una grilla completa permite retirar servicios ausentes.

La conciliación compara cada fecha, sentido, aerolínea y aeropuerto con la cobertura validada de la fuente. Una consulta incompleta deja pendiente esa parte de la grilla. Los cambios de programación conservan la referencia de las reservas existentes. Para atender un vuelo marcado «Revisar», abrí su tarjeta en Aeropuerto y verificá el traslado y las reservas vinculadas antes de coordinarlo.

## Día de operación

La consulta de vuelos de hoy, desde el sitio o el panel, puede refrescar las lecturas de AirLabs y del tablero oficial del aeropuerto. Por defecto transcurren al menos 30 minutos entre corridas automáticas y hay un máximo de 12 por día.

- AirLabs aporta horario con fecha y estado operativo. Una lectura comercial que sólo indica «Programado» requiere evidencia adicional para incorporar un vuelo ausente de la programación.
- El tablero FIDS muestra las horas y el estado. Una hora que se interpreta como del día siguiente queda en el historial de observaciones. Los estados del día pueden actualizarse sin reemplazar el horario publicado por una aerolínea.
- Los vuelos JetSMART con códigos JA y WJ se agrupan por número canónico, fecha local y sentido. Las filas retiradas y las pendientes de revisión conservan su historial.
- El listado de vuelos excluidos de la oferta, incluidos los American Jet de Neuquén, está en `src/lib/airport/offered-flights.ts`.

## Seguimiento

`FlightObservation` conserva las lecturas del día de AirLabs y FIDS. Usá `syncRunId` para agrupar una corrida, `syncOutcome` para ver si se aplicó una lectura y `flightId` para encontrar el vuelo. `FECHA_FUTURA_INFERIDA` identifica una hora del tablero interpretada como futura. `PENDIENTE_DE_CONFIRMACION` identifica una lectura que necesita otra confirmación para modificar la oferta.

El selector público y el alta administrativa consultan `listAirportFlights`. Las reservas compartidas y privadas vuelven a validar el vuelo en el servidor al guardarse. En el panel, «Revisar» mantiene accesibles los datos del traslado para Operaciones.
