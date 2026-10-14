import { EditManagedUserPage } from "../../users/managed-user-form-page";

type EditDriverPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditDriverPage({ params }: EditDriverPageProps) {
  const { id } = await params;
  return <EditManagedUserPage id={id} />;
}
