import { ManagedUsersPage } from "../users/managed-users-page";

type AdminDriversPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Listado de choferes. Es la misma pantalla de cuentas filtrada a rol Chofer, con dos diferencias:
 * la abre también la secretaría y no muestra sueldos ni el botón de eliminar.
 */
export default async function AdminDriversPage({ searchParams }: AdminDriversPageProps) {
  const params = (await searchParams) ?? {};
  const texto = (clave: string) => (typeof params[clave] === "string" ? (params[clave] as string) : undefined);
  return <ManagedUsersPage role="DRIVER" access="drivers" notice={texto("notice")} query={texto("q")} base="/admin/choferes" params={params} />;
}
