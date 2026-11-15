# Aeropuerto: integridad de datos — 14/11/2026

Estado: correcciones preparadas en `codex/airport-data-integrity-20261114`, sobre `66c460d`. No desplegadas por esta auditoría. Producción consultada en modo sólo lectura; sin modificaciones de vuelos, reservas o configuración.

## Evidencia comprobada (hora argentina UTC−3)

A las 11:24 se consultó la tabla Flight de producción y el HTML público de Chapelco. A las 11:25 se consultaron ambos sentidos de AirLabs con respuesta HTTP 200 y sin error del proveedor. Sólo se conservaron campos operativos; sin claves ni datos personales.

| Caso | Base/pantalla | Fuente consultada y causa |
|---|---|---|
| JA3183 | 12:22, Aterrizó, estima 00:00 | FIDS decía `En Vuelo` dentro de CSS `arribado`. El parser interpretaba la clase como estado. AirLabs también informó `active`. 00:00 era un valor sin estima útil. |
| JA3181 | Sábado 12:04, Aterrizó, estima 17:10 | Última consulta viernes 13 a las 19:00. La regla «más de seis horas atrás = mañana» trasladó el registro al sábado. No había reservas ni combis asociadas. |
| JA3182 | Sábado 12:37, demora 308 min | Mismo traslado de fecha desde la consulta del viernes a las 19:00. No había reservas ni combis asociadas. No se confirmó que ese vuelo operara el sábado. |
| AR1652 | Programado 12:05 | AirLabs devolvió 11:45, estimado 11:39, en vuelo. El sync actualizaba estado y estima, pero omitía actualizar el horario programado. |
| AR1653 | Programado 12:45 | AirLabs devolvió 12:25. Mismo defecto de persistencia del horario. |
| AR1657 | Programado 15:15 | AirLabs devolvió 15:20. Mismo defecto. |
| AJ324 / AJ325 | Carga manual, «En horario» | Filas manuales actualizadas el 16/10. No se obtuvo confirmación independiente de su operación del 14/11. |
| Vuelos futuros | 326 filas | Todas con source ESTIMADO. Son proyecciones históricas, no programación futura proporcionada por una aerolínea. |

El FIDS no incluye fecha por vuelo. Su fecha de cabecera se construye con el reloj del navegador: no demuestra vigencia de cada fila. AirLabs es un proveedor externo con vuelos fechados; su respuesta tampoco sustituye una confirmación operacional de aerolínea/aeropuerto.

Fuentes públicas consultadas:
- [FIDS arribos de Chapelco](https://fids.aeropuertochapelco.com/P26/arrp24.php)
- [FIDS partidas de Chapelco](https://fids.aeropuertochapelco.com/P26/parp24.php)
- [Documentación AirLabs schedules](https://airlabs.co/docs/schedules): ventana de hasta diez horas por delante; no documenta parámetro `date` para pedir programación de otro día.

## Cambios implementados

- Estado FIDS tomado del texto visible, nunca de la clase CSS; estima 00:00 tratada como ausente.
- Eliminada la inferencia de mañana por antigüedad del horario. La fecha de observación se mantiene como inferida y se informa al operador.
- Datos FIDS trasladados desde una consulta anterior al día asignado, o aterrizajes incompatibles con el horario a la hora de observación, quedan «Por verificar». La alerta no desaparece sólo porque pase el tiempo. Nuevas reservas sobre estas filas se bloquean en el servidor.
- El paso del horario no implica que el vuelo haya finalizado. El panel separa pendientes, por verificar y finalización informada; muestra fuente y última consulta. Las cargas manuales no dicen «En horario» sin seguimiento; las proyecciones dicen «Sin confirmar».
- AirLabs puede corregir filas FIDS y ahora persiste el nuevo horario programado. Un FIDS sin fecha no sobrescribe la API consultada ese mismo día.
- Sync consulta únicamente el día local actual; se elimina `date` sin soporte. El filtro usa UTC−3 también cerca de medianoche.
- FIDS no propaga cambios de horario a todo el mes proyectado.
- La recorrida estimada acompaña una demora, coherente con el corte de reservas ya existente. Se respeta siempre la hora coordinada por el operador.

## Prioridades pendientes para operación confiable

1. **P0: publicar y verificar estas correcciones antes de confiar en el panel.** Ejecutar una sincronización posterior al despliegue y contrastar JA3183/AR1652/AR1653/AR1657. Los registros contaminados JA3181/JA3182 se conservan señalizados; corregir o retirar sólo tras confirmar fecha real y revisar nuevamente sus relaciones. No se borraron en producción.
2. **P1: sustituir o validar las proyecciones futuras.** Hoy se repite un patrón observado (incluso puede asumir frecuencia diaria con una sola frecuencia conocida). La etiqueta mejora la honestidad, no confirma que esos vuelos existan. Incorporar programación fechada o revisión operativa antes de ofrecer garantía de horario. Revisar también los American Jet manuales.
3. **P1: trazabilidad por observación y control de frescura.** Guardar evidencia por fuente, fecha explícita vs inferida y discrepancias. Alertar fallos/atrasos del sync. Hoy se conserva un estado por vuelo y el último timestamp; no existe reconciliación exhaustiva entre fuentes. La preferencia por API fechada tampoco resuelve todos los conflictos operativos.
4. **P2: recepción de datos operativos.** Confirmar horarios reales de aterrizaje/salida y procedimiento de validación manual para discrepancias, con responsable y registro de revisión.

## Validación

- Reproducción previa: dos pruebas nuevas del parser fallaron con el código anterior (En Vuelo/CSS arribado y viernes trasladado al sábado).
- Suite unitaria: 757 pruebas; regresiones de parser, fecha, calidad, bloqueo de reserva, prioridad de fuentes, actualización de horario, filtro local y recorridas.
- TypeScript y compilación de producción.
- Suite E2E en PostgreSQL local aislado: 15 pruebas, incluyendo panel autenticado en escritorio/móvil y reservas de ida/vuelta. No usa la base de producción ni servicios de pago reales.

Dictamen: datos de fuentes reales mezclados con inferencias y cargas manuales; el panel observado no era confiable para afirmar aterrizajes ni programación futura. La corrección resuelve los fallos reproducidos, pero las proyecciones y los registros históricos requieren validación operativa antes de considerar el módulo plenamente confiable.
