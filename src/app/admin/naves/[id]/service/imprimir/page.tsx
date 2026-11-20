import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { SECCIONES_DE_SERVICE } from "@/lib/vehicles/service-sheet";
import { cargarNave, diaUtc, nombreDeNave } from "../../ficha-de-nave";
import { BotonImprimir } from "./boton-imprimir";
import "../service.css";

/**
 * La planilla en blanco para el taller, para quien prefiere la libreta: los mismos bloques e ítems que la
 * tarjeta, con el interno y la patente ya puestos y casillas para tildar. Después se carga en el sistema.
 */
export default async function ImprimirPlanillaPage({ params }: { params: Promise<{ id: string }> }) {
  await getCurrentAdminOrRedirect();
  const { id } = await params;
  const nave = await cargarNave(id);
  const ultima = await prisma.vehicleServiceSheet.findFirst({ where: { vehicleId: id }, orderBy: [{ servicedAt: "desc" }, { createdAt: "desc" }], select: { servicedAt: true, odometerKm: true } });
  return (
    <main className="svc-papel">
      <div className="svc-papel-acciones"><BotonImprimir /></div>
      <header className="svc-papel-cabecera">
        <div>
          <span className="svc-etiqueta">La Araucana · Planilla de service</span>
          <h1>{nombreDeNave(nave)}{nave.licensePlate ? ` · ${nave.licensePlate}` : ""}</h1>
          {[nave.brand, nave.model].filter(Boolean).length ? <p>{[nave.brand, nave.model].filter(Boolean).join(" ")}</p> : null}
        </div>
        <dl>
          <div><dt>Fecha</dt><dd /></div>
          <div><dt>Kilometraje</dt><dd /></div>
          <div><dt>Hizo el service</dt><dd /></div>
        </dl>
      </header>
      {ultima ? <p className="svc-papel-ultimo">Último service cargado: {diaUtc(ultima.servicedAt)}, {ultima.odometerKm.toLocaleString("es-AR")} km.</p> : null}
      <p className="svc-papel-clave">Marcar una casilla por ítem: <strong>B</strong> bien · <strong>F</strong> falla · <strong>N/A</strong> no aplica.</p>
      <div className="svc-papel-bloques">
        {SECCIONES_DE_SERVICE.map((seccion) => (
          <table key={seccion.id} className="svc-papel-bloque">
            <thead><tr><th>{seccion.label}</th><th>B</th><th>F</th><th>N/A</th></tr></thead>
            <tbody>{seccion.items.map((item) => <tr key={item.id}><td>{item.label}</td><td /><td /><td /></tr>)}</tbody>
          </table>
        ))}
      </div>
      <div className="svc-papel-textos">
        <div><span className="svc-etiqueta">Qué se le hizo</span><div className="svc-papel-lineas" /></div>
        <div><span className="svc-etiqueta">Observaciones</span><div className="svc-papel-lineas" /></div>
      </div>
    </main>
  );
}
