import { EditManagedUserPage } from "../../users/managed-user-form-page";

type EditDriverPageProps = {
  searchParams?: Promise<{ notice?: string | string[] }>;
  params: Promise<{
    id: string;
  }>;
};

export default async function EditDriverPage({ params, searchParams }: EditDriverPageProps) {
  const { id } = await params;
  const message = (await searchParams)?.notice;
  return <EditManagedUserPage id={id} driversOnly notice={typeof message === "string" ? message : undefined} />;
}
