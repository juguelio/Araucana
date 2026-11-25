# Araucana Chofer para iPhone

La app SwiftUI para iOS 17 o posterior abre la jornada de la cuenta de chofer. Administración asigna los servicios y las naves. Cada salida reúne su hoja, las paradas y las marcas de inicio, fin y embarque.

## Desarrollo

Abrí `Iphone/AraucanaChofer/AraucanaChofer.xcodeproj` en Xcode y ejecutá el esquema `AraucanaChofer`. Para usar el servidor de desarrollo, iniciá `npm run dev` en la Mac e ingresá `http://127.0.0.1:3000` en el campo de API del simulador. La compilación de distribución usa `https://araucana.vercel.app`.

## Operación

- El primer ingreso necesita conexión y una cuenta activa con rol `DRIVER`. El token se guarda en el llavero y la copia local se separa por cuenta y servidor.
- Las hojas de hoy se descargan al actualizar la jornada. Abrir una hoja futura con conexión la guarda para consultarla sin señal. Las marcas pendientes se vuelven a enviar con el mismo identificador al recuperar la conexión. Al cerrar sesión se eliminan las hojas y las marcas pendientes quedan reservadas para el siguiente ingreso de la misma cuenta.
- Durante una franja asignada, iOS solicita permiso de ubicación al abrir la app en primer plano. Con el permiso concedido, el seguimiento iniciado continúa en segundo plano y con la pantalla bloqueada mientras iOS permite su ejecución. Una salida sin franja completa ofrece activación manual dentro de sus límites conocidos y durante su día. Al finalizar la franja, detener el envío manual o cerrar sesión se corta el seguimiento.
- La jornada y las marcas usan `/api/v1/driver/jornada` y `/api/v1/driver/marcas`. Cada lectura GPS se envía a `/api/v1/driver/location` con la nave y la salida correspondientes.
