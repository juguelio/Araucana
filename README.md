# Araucana

Aplicación con Next.js, Prisma y PostgreSQL en Neon. La autenticación usa Passport Local y Passport Google OIDC, contraseñas bcrypt y JWT firmados por el servidor. Neon almacena perfiles, permisos, proveedores de identidad y sesiones revocables.

## Autenticación

- El acceso web usa una cookie JWT `HttpOnly`, `Secure` en producción y `SameSite=Lax`.
- Las apps nativas usan `Authorization: Bearer <token>`.
- Los JWT vencen según `SESSION_DAYS` (30 días por defecto, hasta 90) y cada token tiene una sesión revocable en Neon.
- Las contraseñas se almacenan con bcrypt. Se requieren al menos 12 caracteres y hasta 72 bytes UTF-8.
- Google usa únicamente OpenID Connect con `email` y `profile`. Las cuentas existentes se vinculan por email verificado; las cuentas nuevas se crean como `USER` inactivas hasta que un administrador las apruebe.
- La URL de retorno de Google es `${AUTH_BASE_URL}/api/v1/auth/google/callback`.
- El registro crea cuentas `USER` inactivas; un administrador aprueba y asigna roles desde `/admin/usuarios`.
- El alta inicial de un administrador existente se hace en `/inicializar-admin` con `AUTH_BOOTSTRAP_TOKEN`. El token solo funciona para una cuenta `ADMIN` que aún no tenga contraseña.

## Variables de entorno

Configurar `DATABASE_URL`, `AUTH_JWT_SECRET` (secreto aleatorio de al menos 32 bytes), `AUTH_BOOTSTRAP_TOKEN` (secreto aleatorio de un solo uso), `AUTH_BASE_URL`, `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. El botón de Google aparece cuando los dos valores OAuth están configurados. Opcionalmente, `SESSION_DAYS` controla la duración de las sesiones.

## API de autenticación

- `POST /api/v1/auth/register` crea una cuenta pendiente.
- `POST /api/v1/auth/login` valida email y contraseña y devuelve un JWT.
- `GET /api/v1/auth/google` inicia el flujo Passport/OpenID Connect.
- `GET /api/v1/auth/google/callback` valida el estado OIDC, vincula la identidad y crea una sesión JWT.
- `POST /api/v1/auth/refresh` rota un JWT vigente.
- `POST /api/v1/auth/logout` revoca la sesión.
- `GET /api/v1/auth/me` devuelve el usuario actual.
- `GET /api/v1/users`, `GET /api/v1/openapi` y `GET /api/v1/docs`.

## Desarrollo

```bash
npm install
npx prisma generate
npm run dev
```

El seed carga vehículos y rutas de demostración, nunca credenciales ni usuarios administradores. No ejecutarlo contra una base con datos reales. Las migraciones y fixtures se preparan por separado, verificando antes la identidad de la base.

## Seguridad de reservas y pagos

Las reservas nuevas usan enlaces privados con 128 bits aleatorios: quien recibe el enlace puede consultar la reserva y adjuntar su comprobante pendiente. No compartirlo públicamente. Los códigos cortos heredados sólo se consultan con una sesión activa ADMIN/SECRETARY; el pasajero debe contactar al equipo para recuperar su reserva. No se migran ni regeneran códigos existentes automáticamente.

Configurar en el entorno del servidor los datos bancarios reales: `MANUAL_PAYMENT_HOLDER`, `MANUAL_PAYMENT_BANK`, `MANUAL_PAYMENT_CBU` (22 dígitos) o `MANUAL_PAYMENT_ALIAS`, y opcionalmente `MANUAL_PAYMENT_ACCOUNT_TYPE` y `MANUAL_PAYMENT_CUIT`. Sin configuración no se ofrece una cuenta ficticia. Para subir comprobantes hace falta `BLOB_READ_WRITE_TOKEN` de un almacén privado. No guardar secretos en Git.

El servidor valida tamaño, MIME y firma inicial del archivo. Esta comprobación no equivale a análisis antivirus ni a validación completa del documento. La API comprueba acceso, estado de la reserva y almacenamiento antes de leer el archivo, y vuelve a comprobarlos antes de almacenar; se intenta eliminar el blob nuevo si falla la asociación y el anterior tras reemplazarlo. Un fallo externo de limpieza requiere revisión operativa de blobs huérfanos.

## E2E con base aislada

`npm run test:e2e` ya no ejecuta migraciones ni seed. Requiere `E2E_DATABASE_URL` de un branch de prueba distinto de `DATABASE_URL` y `E2E_ISOLATED_DATABASE=1`. Preparar explícitamente esquema y fixtures en esa base aislada, incluyendo la ruta Villa Traful con una salida futura. No reutiliza el servidor de desarrollo existente. El servidor de prueba se levanta en el puerto de `PLAYWRIGHT_BASE_URL` (por defecto `http://localhost:3000`), que tiene que estar libre, y siempre recibe `E2E_DATABASE_URL` como `DATABASE_URL`. No usar una base de clientes ni un servidor remoto.
