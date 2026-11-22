import { SchoolEditPage } from "../edit-page";

export default async function New({ searchParams }: { searchParams: Promise<{ fecha?: string; aviso?: string }> }) {
  const { fecha, aviso } = await searchParams;
  return <SchoolEditPage fecha={fecha} aviso={aviso} />;
}
