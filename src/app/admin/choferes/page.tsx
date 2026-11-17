import { ManagedUsersPage } from "../users/managed-users-page";

type AdminDriversPageProps = {
  searchParams?: Promise<{
    notice?: string;
    q?: string;
  }>;
};

/**
 * Listado de choferes. Es la misma pantalla de cuentas filtrada a rol Chofer, con dos diferencias:
 * la abre también la secretaría y no muestra sueldos ni el botón de eliminar.
 */
export default async function AdminDriversPage({ searchParams }: AdminDriversPageProps) {
  const params = await searchParams;
  return <ManagedUsersPage role="DRIVER" access="drivers" notice={params?.notice} query={params?.q} />;
}
