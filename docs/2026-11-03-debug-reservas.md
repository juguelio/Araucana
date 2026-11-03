# Reservas: diagnóstico, correcciones y mejoras — 2026-11-03

Base: `692b352`. Rama: `codex/reservas-debug-20261103`.
Autorización: Jugue pidió debug del sistema de reservas y posterior implementación de mejoras.

## Problemas corregidos

- **Una aprobación podía reactivar una reserva cancelada.** Reproducido primero con un test que falló: la operación devolvía CONFIRMED. Ahora sólo se revisan pagos MANUAL/PENDING de reservas PENDING_PAYMENT con comprobante. Transacción Serializable con reintentos y nueva comprobación del estado ante conflictos. La API de aprobación devuelve errores 404/409 en lugar de un 500 genérico para estos casos.
- **Pago pendiente presentado como reserva confirmada.** El encabezado ahora diferencia recepción pendiente de confirmación. Reservas canceladas no ofrecen subir comprobantes.
- **Fecha de aeropuerto en el listado interno.** Se usa horario del vuelo/fecha del servicio antes de considerar la creación de la reserva.
- **Build:** PostCSS exportaba un objeto sin `plugins`; la página de reserva exportaba helpers no admitidos por Next. Configuración válida y helpers movidos a `presentation.ts`.

## Mejoras implementadas

- **A2:** las tarjetas de excursiones y grupos abren WhatsApp con consulta contextual, sin crear reservas web.
- **A3:** secretaría/administración pueden rechazar un comprobante. El pago queda REJECTED, la reserva sigue PENDING_PAYMENT y el pasajero ve instrucciones para reenviar. Al adjuntar otro comprobante, el pago vuelve a PENDING; sólo entonces puede aprobarse. Se conservan importe/moneda/referencia y comprobante actual. No se agregó motivo obligatorio ni historial de decisiones: eso requeriría definir persistencia adicional.
- **A4:** filtros combinables por código parcial, ruta (origen/destino/slug), ID de salida y fecha de viaje. La fecha respeta Argentina para salidas y aeropuerto, y fecha calendario UTC para Chapelco. Fechas inválidas dan un aviso, sin ejecutar una búsqueda sin filtro.
- Pruebas de reserva pública con fixtures propios y fechas futuras; ya no dependen del seed de mayo. Opción `PLAYWRIGHT_WEBPACK=1` para probar sin Turbopack.

## Verificación

- `npm test`: **188/188**, 38 archivos, exit 0.
- Suite E2E completa: **7/7**, exit 0, Chromium, un worker. Reserva pública real, navegación/login anónimo, WhatsApp, filtros y rechazo/aprobación con rol SECRETARY.
- `npm run build -- --webpack`: **OK**, incluida comprobación TypeScript y 54 páginas estáticas.
- `git diff --check`: OK.
- Base temporal PostgreSQL 17 exclusiva en `127.0.0.1:55483/araucana_debug`, directorio `/tmp/araucana-pg-20261103`. Las 17 migraciones se aplicaron sólo allí; fixtures sintéticos. El servidor temporal se detiene al cerrar la tarea.

Comando E2E reproducible, con base previamente preparada y separada de la habitual:

```sh
E2E_DATABASE_URL=postgresql://araucana_test@127.0.0.1:55483/araucana_debug \
E2E_ISOLATED_DATABASE=1 PLAYWRIGHT_BASE_URL=http://localhost:3219 \
PLAYWRIGHT_WEBPACK=1 AUTH_JWT_SECRET=isolated-test-secret-20261103-not-a-production-key \
npm run test:e2e -- --workers=1
```

## Límites y pendientes

- Sin deploy, push, migraciones sobre base compartida ni cambios de credenciales/configuración de producción.
- Turbopack falló por permiso de apertura de puerto interno en este entorno; build verificado con Webpack. La primera compilación además falló por descarga de Google Fonts restringida.
- La primera corrida E2E paralela tuvo un selector ambiguo de grupos (corregido) y un timeout del checkout; reserva aislada y suite secuencial posterior correctas. No se presenta estabilidad paralela como verificada.
- La subida a Vercel Blob está cubierta por tests con dobles; E2E simula un comprobante ya adjuntado. Falta comprobar almacenamiento real con su configuración autorizada.
- No se declara verificado el CU-10 completo, recuperación de backups, tracking de vuelos ni aceptación contractual/producción. Jev no se ejecutó.
- Siguiente paso: revisar el diff, publicar mediante el flujo acordado y verificar reserva/pagos en el entorno de entrega con registro Anexo I-F. A2/A3/A4 pasan de implementación pendiente a verificación de entrega.
- Rollback: revertir el commit de esta tanda; no hay migraciones nuevas que revertir. No modificar las reservas existentes como parte del rollback.
