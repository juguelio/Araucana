import { ManagedUsersPage } from "../users/managed-users-page";

export default async function AdminUsersPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const texto = (clave: string) => (typeof params[clave] === "string" ? (params[clave] as string) : undefined);
  return <ManagedUsersPage notice={texto("notice")} query={texto("q")} base="/admin/usuarios" params={params} />;
}
