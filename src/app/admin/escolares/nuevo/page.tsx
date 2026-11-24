import { SchoolEditPage } from "../edit-page";

export default async function New({ searchParams }: { searchParams: Promise<{ fecha?: string; tipo?: string; aviso?: string }> }) {
  const { fecha, tipo, aviso } = await searchParams;
  return <SchoolEditPage fecha={fecha} tipo={tipo} aviso={aviso} />;
}
