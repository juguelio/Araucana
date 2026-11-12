# Excursiones — issue #58

## Estado

Implementación local sobre `upstream/main` `24aae55`, rama `feat/excursiones-58`, worktree `/Users/altostake/Dev/araucana-excursiones`. Commit local autorizado por Jugue; sin push, PR ni deploy. El checkout compartido `/Users/altostake/Dev/araucana` no se modificó.

## Uso

1. ADMIN o SECRETARY abre **Excursiones** en el panel y crea un borrador con nombre, descripción, duración, precio opcional y fechas puntuales de salida en hora argentina (UTC−3).
2. Guarda el borrador y agrega fotos JPG/PNG/WebP, una por carga, hasta 3 MB cada una y 12 fotos por excursión. La primera es la portada; se puede elegir otra desde la galería.
3. Marca **Publicar en la web** y guarda. El catálogo `/excursiones` y la ficha `/excursiones/[id]` muestran las próximas salidas, fotos y consulta contextual por WhatsApp. La tarjeta de excursiones del home lleva al catálogo. Interfaz pública ES/EN/PT; los textos cargados por el cliente se conservan en su idioma original.
4. Una excursión sin futuras salidas sigue visible con un mensaje para consultar fechas. Una excursión sin fotos no se publica. Quitar la última foto la devuelve a borrador. La eliminación completa exige escribir `ELIMINAR`.

Decisiones provisionales explícitas: fechas puntuales, no recurrencias semanales; permisos ADMIN/SECRETARY, no un rol nuevo. No reserva online, asignación de naves ni integración contable.

## Datos y seguridad

- Migración aditiva `20261112120000_excursions`: `Excursion`, `ExcursionPhoto`, `ExcursionDeparture`. No cambia reservas ni rutas.
- Fotos en Vercel Blob **privado**, namespace `excursion-photos/`, separado de comprobantes. Proxy `/excursiones/fotos/[id]` sólo sirve borradores a personal activo ADMIN/SECRETARY; fotos publicadas accesibles al público. No expone el pathname privado al navegador.
- Validación de tipo, tamaño y firma del archivo en servidor. Precios decimales positivos, fechas reales, hasta 100 salidas sin duplicados.
- Escrituras autorizadas en cada server action. Bloqueo por excursión para cambios relacionados y versión `updatedAt` para evitar sobrescribir ediciones concurrentes.
- La limpieza de Blob es best-effort: si falla, la baja editorial permanece y se registra una advertencia. No toca archivos de comprobantes.

## Evidencia ejecutada por HAL

| Prueba | Resultado |
|---|---|
| `npm run test` | 531/531, 82 archivos |
| `npx --no-install tsc --noEmit` | exit 0 |
| `npm run build` | exit 0, nuevas rutas presentes en el listado |
| `git diff --check` | exit 0 |
| Migraciones completas en PostgreSQL local propio de prueba | 31 migraciones aplicadas |
| `prisma migrate diff` DB local vs schema | sin diferencias, exit 0 |
| E2E focalizados `excursions.spec.ts` + `admin.spec.ts` | 7/7 en Chromium |
| Regresión por sabotaje del filtro de publicación | falla al incluir borradores; pasa al restaurar filtro |
| Estado final de fixtures de excursiones | 0 excursiones, 0 fotos, 0 salidas |

Base exclusiva de esta tarea: `araucana_excursiones_58` en `127.0.0.1:55432`. No se copiaron credenciales de producción al worktree.

E2E: catálogo vacío en tres idiomas; acceso anónimo bloqueado; secretaría crea borrador; precio y fecha persistidos; borrador público 404; archivo con MIME falso rechazado; publicación; galería; sólo fechas futuras; WhatsApp contextual; catálogo/detalle sin overflow a 390 px; edición concurrente rechazada; cambio de portada; quitar última foto pasa a borrador; eliminación con cascada; acceso ADMIN permitido y USER/DRIVER bloqueado.

**Límite de la evidencia:** no se hizo una subida real a Vercel Blob. En E2E las fotos válidas se asociaron por fixture Prisma y se interceptó la respuesta de imagen. Almacenamiento y proxy tienen tests unitarios con el SDK simulado. No presentar las fotos del fixture como prueba de Blob remoto. La revisión independiente no encontró bloqueantes; propuso más cobertura de carreras simultáneas y una integración completa de subida/proxy.

Avisos previos del sitio observados durante los E2E: `middleware` deprecado, claves duplicadas `/#contacto`, scroll smooth sin atributo y `ECONNRESET` de solicitudes abortadas durante navegación. Las pruebas terminaron con exit 0; no se hicieron refactors ajenos al issue.

## Gate de publicación

Antes de merge/deploy: aprobación para push/PR, contrastar nuevos cambios de upstream, revisar pendientes de migración una por una y aplicar la migración aprobada en la base real **antes** del código. El build no aplica migraciones. Después verificar una foto real y el flujo de publicación en el entorno autorizado. No se ejecutó ninguna migración ni escritura de negocio en producción.
