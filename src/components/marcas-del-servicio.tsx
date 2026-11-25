import type { FilaApp } from "@/lib/driver/jornada-app-types";
import { diferenciasDeEmbarque, horaDeMarca, resumenDeMarcas, ultimasMarcas, type Marca } from "@/lib/driver/marcas";

type Fila = Pick<FilaApp, "id" | "nombre" | "cantidad" | "registroAnterior">;

export function MarcasDelServicio({ marcas, filas = [] }: { marcas: Marca[]; filas?: Fila[] }) {
  const registros = ultimasMarcas(marcas);
  const informadas = new Set(registros.filter(m => m.tipo === "embarque" && m.estado === "guardada").map(m => m.filaId));
  const otras = filas.filter(f => !informadas.has(f.id));
  const excesos = diferenciasDeEmbarque(registros);
  return <section aria-label="Registro del chofer" className="plain-card admin-section">
    <h3>Registro del chofer</h3>
    <p>{resumenDeMarcas(registros)}</p>
    {registros.length > 0 && <ul>{registros.map(m => {
      const descripcion = m.tipo === "embarque"
        ? [m.fila, m.cantidad === 0 ? "Ausente" : `${m.cantidad} de ${m.prevista} embarcados`].join(" · ")
        : m.tipo === "inicio" ? "Inicio del servicio" : "Fin del servicio";
      const exceso = excesos.has(JSON.stringify([m.fecha, m.servicioId, m.filaId]));
      return <li key={m.id}><strong>{descripcion}</strong> · {m.nave || "Sin nave asignada"} · {horaDeMarca(m.at)}
        {exceso && " · El total entre naves supera la cantidad reservada"}
        {m.estado === "revision" && <strong> · Para revisar · {m.motivo}</strong>}</li>;
    })}</ul>}
    {otras.length > 0 && <details><summary>Reservas sin marca nueva · {otras.length}</summary>
      <ul>{otras.map(f => <li key={f.id}>{f.nombre} · {f.cantidad} previstos · {f.registroAnterior ?? "Sin informar"}</li>)}</ul>
    </details>}
  </section>;
}
