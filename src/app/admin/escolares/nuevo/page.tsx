import { SchoolEditPage } from "../edit-page";

export default async function New({ searchParams }: { searchParams: Promise<{ tipo?: string; fecha?: string; aviso?: string }> }) {
  const { tipo, fecha, aviso } = await searchParams;
  return <SchoolEditPage tipo={tipo} fecha={fecha} aviso={aviso} />;
}
