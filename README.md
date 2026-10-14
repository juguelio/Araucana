# Araucana

Aplicacion con Next.js, Prisma y PostgreSQL. La autenticacion web y nativa usa Supabase Auth con Google; los perfiles, roles y permisos operativos siguen en la base Postgres de Araucana.

## Configuracion de autenticacion

1. En Supabase, habilitar Google como proveedor e ingresar el OAuth Client ID y Secret de Google. Deshabilitar email/password y cualquier otro proveedor para que Google sea el único método de acceso.
2. En Google Cloud, registrar como redirect URI la URL que Supabase muestra para el proveedor (normalmente `https://<project-ref>.supabase.co/auth/v1/callback`).
3. En Supabase Auth, agregar a la lista de Redirect URLs `http://localhost:3000/auth/callback` y el callback HTTPS del dominio de produccion.
   Para la app de choferes, agregar también `araucana-chofer://login-callback`.
4. Configurar las variables de `.env.example`. `SUPABASE_SECRET_KEY` es solo de servidor y se usa para revocar una identidad cuando un administrador elimina una cuenta.
5. Ejecutar `npm run prisma:migrate` para asociar los perfiles con Supabase Auth.

Las cuentas nuevas se crean con rol `USER` e inactivas. Solo ven la pantalla de aprobación; las páginas públicas y reservas siguen disponibles sin iniciar sesión. Una cuenta existente se vincula por email Google verificado y conserva su rol y estado.

### Primer administrador

Los registros de administradores existentes conservan su rol y estado al vincularse con el mismo email Google verificado. Si la base no tiene una cuenta administradora, después de registrarla el callback crea un perfil pendiente; promovelo manualmente en PostgreSQL:

```sql
UPDATE "User"
SET "role" = 'ADMIN', "isActive" = true
WHERE lower("email") = lower('admin@tu-dominio.com');
```

Luego, volvé a iniciar sesión. A partir de ahí, el administrador puede activar cuentas y asignar `ADMIN`, `SECRETARY` o `DRIVER` desde `/admin/usuarios`.

## API compartida

La web y las apps nativas envían el access token de Supabase como Bearer:

```http
Authorization: Bearer <supabase-access-token>
```

- `GET /api/v1/auth/me` devuelve el perfil Araucana asociado a la identidad.
- El cierre de sesión se realiza con el SDK de Supabase en web y en apps nativas.
- `GET /api/v1/users`, `GET /api/v1/openapi` y `GET /api/v1/docs`.

Los endpoints protegidos validan la identidad contra Supabase Auth y consultan rol/estado en Postgres. No se autorizan permisos desde metadatos del usuario en Supabase. Las cuentas inactivas reciben `403 PENDING_APPROVAL`.

## Desarrollo

```bash
npm install
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

El seed carga vehículos y rutas de demostración, nunca credenciales ni usuarios administradores.
