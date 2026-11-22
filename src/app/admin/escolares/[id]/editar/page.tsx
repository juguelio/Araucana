import { SchoolEditPage } from "../../edit-page";

export default async function Edit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aviso?: string }> }) {
  return <SchoolEditPage id={(await params).id} aviso={(await searchParams).aviso} />;
}
