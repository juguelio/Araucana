# Araucana Chofer iPhone

Proyecto SwiftUI nativo para la app de choferes.

## Abrir en Xcode

Abrir:

```bash
Iphone/AraucanaChofer/AraucanaChofer.xcodeproj
```

## Base inicial

- App SwiftUI.
- Target iOS 17.
- Bundle ID: `com.araucana.chofer`.
- Inicio de sesión Google con Supabase Auth; el access token se envía a la API como Bearer.
- Recupera usuario con `GET /api/v1/auth/me`.
- Recupera datos de chofer, rutas de trabajo, salidas proximas y pasajeros con `GET /api/v1/driver/bootstrap`.

## Desarrollo local

Con el servidor web corriendo en la Mac:

```bash
npm run dev
```

En el simulador iPhone usar:

```text
http://127.0.0.1:3000
```

El usuario debe tener rol `DRIVER`.

## Supabase Auth

Configura en los Build Settings de Debug y Release `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`.
Agrega `araucana-chofer://login-callback` a las Redirect URLs permitidas de Supabase Auth.
El SDK mantiene y renueva la sesión; la app ya no guarda tokens de acceso en `UserDefaults`.
