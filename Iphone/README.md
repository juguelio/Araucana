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
- Inicio de sesión con email y contraseña de Araucana; el JWT se guarda en el llavero de iOS y se envía a la API como Bearer.
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

## Acceso

La cuenta debe tener rol `DRIVER` y estar activa. La app inicia sesión en `POST /api/v1/auth/login`, renueva el JWT al recuperar una sesión y revoca la sesión al salir. Los tokens se guardan en Keychain, nunca en `UserDefaults`.
