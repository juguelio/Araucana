import { ManagedUsersPage } from "../users/managed-users-page";

export default async function AdminUsersPage({ searchParams }: { searchParams?: Promise<{ notice?: string; q?: string }> }) {
  const params = await searchParams;
  return <ManagedUsersPage notice={params?.notice} query={params?.q} />;
}
