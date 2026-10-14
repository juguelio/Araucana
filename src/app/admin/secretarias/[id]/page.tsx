import { EditManagedUserPage } from "../../users/managed-user-form-page";

type EditSecretaryPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditSecretaryPage({ params }: EditSecretaryPageProps) {
  const { id } = await params;
  return <EditManagedUserPage id={id} />;
}
