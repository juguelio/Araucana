import { EditManagedUserPage } from "../../users/managed-user-form-page";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditManagedUserPage id={id} />;
}
