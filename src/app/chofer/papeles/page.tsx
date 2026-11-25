import { notFound } from "next/navigation";
import { getCurrentDriverOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { cargarJornadaApp } from "@/lib/driver/jornada-app";
import { DriverVehicleDocuments } from "../vehicle-documents";

export default async function Papeles({ searchParams }: { searchParams: Promise<{ nave?: string }> }) {
  const chofer = await getCurrentDriverOrRedirect();
  const { nave } = await searchParams;
  const jornada = await cargarJornadaApp(chofer.id);
  const unidad = jornada.servicios.find(s => s.nave?.id === nave)?.nave;
  if (!unidad) notFound();
  const documentos = await prisma.vehicleDocument.findMany({
    where: { vehicleId: unidad.id }, orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, fileName: true, createdAt: true, expiresAt: true }
  });
  return <main className="page-shell section">
    <a href="/chofer">Volver a mi jornada</a>
    <DriverVehicleDocuments vehicleId={unidad.id} vehicleName={unidad.nombre} documentos={documentos} />
  </main>;
}
