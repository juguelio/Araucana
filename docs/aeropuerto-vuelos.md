# Vuelos del aeropuerto: de dónde salen y cómo se corrigen

Documento de operación para quien toque este módulo. Describe el sistema tal como está, no como
debería estar: si algo de acá no coincide con el código, el código manda y hay que actualizar esto.

## Las tres fuentes

| Fuente | Qué trae | Cuándo |
|---|---|---|
| **AirLabs** (`provider.ts`) | Programación oficial de la aerolínea para CPC (SAZY). | El día en curso y, a veces, el siguiente. No publica semanas futuras. |
| **Tablero del aeropuerto** (`fids.ts`) | Scraping de los tableros públicos de arribos y salidas: hora, estima y estado («En Vuelo», «Aterrizó», «Demorado»). | El día en curso. |
| **Carga manual** (`MANUAL`) | Vuelos que no están en ninguna de las dos, como American Jet. | Cuando el operador lo carga. |

Cada fila de `Flight` guarda su origen en `source`.

## Jerarquía entre fuentes

```
FIDS  >  API  >  MANUAL  >  ESTIMADO
```

`FIDS` es la vista autorizada del día: si el tablero del aeropuerto ya tiene la fila, AirLabs **no la
pisa** (`sync.ts`, al procesar la API). Esto es deliberado, porque el tablero es lo que ve el pasajero
en la pantalla del aeropuerto el día del vuelo.

`ESTIMADO` es siempre una proyección nuestra, nunca un dato de una fuente.

## Qué hace una corrida del sync

1. **Unifica JetSMART**: el tablero publica `WJ3182` y la API `JA3182`; se colapsan a `JA`.
2. **Por día y por sentido**, pide a AirLabs y crea o actualiza, salvo que la fila sea `FIDS`.
3. **Trae el tablero** del día y, si difiere, corrige la grilla futura del **mismo día de la semana**.
4. **Cuenta los vuelos reales del día**: si un día tiene datos de la API, no se proyecta ese día.
5. **Proyecta** hasta 30 días: repite el patrón de cada vuelo según su propia frecuencia.
6. **Corrige** las filas `ESTIMADO` futuras que quedaron con la hora de otro día.
7. **Limpia** proyecciones de días que ya consiguieron datos reales.

## Cuándo corre

No hay cron. Se dispara cuando alguien consulta los vuelos del día en el sitio
(`/api/v1/airport/flights`), con un tope de **30 minutos** entre corridas y **12 por día**
(`freshness.ts`). El botón **«Actualizar vuelos»** del panel corre el sync sin ese tope.

Ojo: el disparo automático anota su corrida en `airport.lastSync`; el botón no. Mirar ese registro
para saber si el sync corrió da falsos negativos.

## Cómo se proyecta

La proyección es **por vuelo**, no por día. Cada servicio se repite según su propia frecuencia:

- Si el mismo día de la semana tiene dato real, se usa esa hora.
- Si el vuelo se vio en días consecutivos, se considera servicio diario y se proyecta cualquier día.
- Si se vio en varios días salteados y el objetivo no es uno de ellos, no se proyecta
  (martes/jueves/sábado de American Jet).
- Si sólo hay una muestra, se asume diario.

## Reglas que costaron un reporte del cliente

- **No copiar el reloj del vuelo de hoy a toda la grilla futura.** JetSMART no sale a la misma hora
  todos los días. Fue el bug del JA3182 del 15-nov.
- **Las `ESTIMADO` no cuentan como evidencia del patrón**, o la grilla mala se valida a sí misma.
- **No tocar una fila con reservas o combi asignada**: ahí la hora la decide el operador.
- **El control de duplicados va por aerolínea.** Comparar sólo sentido y ±25 minutos hacía que el
  AJ325 de Neuquén bloqueara el AR1657 de Aeroparque, que es otro servicio, otra ruta y otra empresa.

## Vuelos que no se ofrecen

`offered-flights.ts` tiene la lista `VUELOS_QUE_NO_SE_OFRECEN`. Los vuelos de esa lista siguen
existiendo en la base y en la hoja del día —el registro del aeropuerto es real y el chofer lo
necesita— pero no se listan al pasajero, no se muestran en el panel del día y no se proyectan.

Hoy tiene los American Jet a Neuquén (AJ324, AJ325, AJ328, AJ329), fuera de la oferta por pedido del
cliente. Volver a ofrecerlos es borrar el número de la lista.

## Dónde se ve cada cosa

| Pantalla | Query |
|---|---|
| Reserva del pasajero | `listAirportFlights` (`booking.ts`) |
| Panel del día | `admin/aeropuerto/page.tsx` |
| Hoja del chofer | `getAirportServiceOrderReservations` (reservas, no vuelos) |

## Verificación rápida

```bash
# la grilla que ve el pasajero
curl -s "https://araucana.vercel.app/api/v1/airport/flights?slug=aeropuerto-chapelco-sma&date=2026-11-24" | jq '.flights[] | {number, scheduledAt, source}'
```

Las horas se muestran en **UTC-3**. La base guarda UTC.
