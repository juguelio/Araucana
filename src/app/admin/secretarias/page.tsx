import { ManagedUsersPage } from "../users/managed-users-page";

type AdminSecretariesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminSecretariesPage({ searchParams }: AdminSecretariesPageProps) {
  const params = (await searchParams) ?? {};
  const texto = (clave: string) => (typeof params[clave] === "string" ? (params[clave] as string) : undefined);
  return <ManagedUsersPage role="SECRETARY" notice={texto("notice")} query={texto("q")} base="/admin/secretarias" params={params} />;
}
