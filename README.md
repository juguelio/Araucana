# Araucana

Aplicación con Next.js, Prisma y PostgreSQL en Neon. La autenticación usa Passport Local, contraseñas bcrypt y JWT firmados por el servidor. Neon almacena perfiles, permisos y sesiones revocables.

## Autenticación

- El acceso web usa una cookie JWT `HttpOnly`, `Secure` en producción y `SameSite=Lax`.
- Las apps nativas usan `Authorization: Bearer <token>`.
- Los JWT vencen según `SESSION_DAYS` (30 días por defecto, hasta 90) y cada token tiene una sesión revocable en Neon.
- Las contraseñas se almacenan con bcrypt. Se requieren al menos 12 caracteres y hasta 72 bytes UTF-8.
- El registro crea cuentas `USER` inactivas; un administrador aprueba y asigna roles desde `/admin/usuarios`.
- El alta inicial de un administrador existente se hace en `/inicializar-admin` con `AUTH_BOOTSTRAP_TOKEN`. El token solo funciona para una cuenta `ADMIN` que aún no tenga contraseña.

## Variables de entorno

Configurar `DATABASE_URL`, `AUTH_JWT_SECRET` (secreto aleatorio de al menos 32 bytes), `AUTH_BOOTSTRAP_TOKEN` (secreto aleatorio de un solo uso) y, opcionalmente, `SESSION_DAYS`.

## API de autenticación

- `POST /api/v1/auth/register` crea una cuenta pendiente.
- `POST /api/v1/auth/login` valida email y contraseña y devuelve un JWT.
- `POST /api/v1/auth/refresh` rota un JWT vigente.
- `POST /api/v1/auth/logout` revoca la sesión.
- `GET /api/v1/auth/me` devuelve el usuario actual.
- `GET /api/v1/users`, `GET /api/v1/openapi` y `GET /api/v1/docs`.

## Desarrollo

```bash
npm install
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

El seed carga vehículos y rutas de demostración, nunca credenciales ni usuarios administradores.
