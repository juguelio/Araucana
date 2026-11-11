import { TripEditPage } from "../../trip-edit-page";

export default async function EditTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripEditPage id={id} />;
}
