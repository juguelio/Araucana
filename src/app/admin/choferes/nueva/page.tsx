import { CreateManagedUserPage } from "../../users/managed-user-form-page";

/**
 * Alta de chofer: el rol viene fijo y la pantalla también la abre la secretaría, que es quien arma
 * el día. Antes esta ruta redirigía a `/admin/usuarios`, así que el botón «Chofer nuevo» del tablero
 * dejaba a la persona en el listado de todas las cuentas.
 */
export default function NewDriverPage() {
  return <CreateManagedUserPage fixedRole="DRIVER" />;
}
