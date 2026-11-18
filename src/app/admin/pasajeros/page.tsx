import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { EncabezadoOrdenable, OrdenOculto } from "@/components/admin-list/encabezado-ordenable";
import { Paginador } from "@/components/admin-list/paginador";
import { hrefDePagina, leerOrden, leerPagina, rangoDePagina, type OrdenDeListado } from "@/lib/admin/list-order";
import { CrmNavigation } from "../crm-navigation";

const PAGE_SIZE = 25;
const SEARCH_LIMIT = 120;
const BASE = "/admin/pasajeros";

/** Columnas ordenables (issue #192). `alta` no tiene encabezado: es el orden con que abre la pantalla. */
const COLUMNAS = ["pasajero", "email", "telefono", "reservas", "alta"] as const;
type Columna = (typeof COLUMNAS)[number];
const POR_DEFECTO: OrdenDeListado<Columna> = { columna: "alta", direccion: "desc" };

/** `orderBy` de Prisma para la columna pedida; siempre cierra con el id para que las páginas no se pisen. */
function orderByDe({ columna, direccion }: OrdenDeListado<Columna>): Prisma.PassengerOrderByWithRelationInput[] {
  const desempate: Prisma.PassengerOrderByWithRelationInput = { id: direccion };
  switch (columna) {
    case "pasajero": return [{ firstName: direccion }, { lastName: direccion }, desempate];
    case "email": return [{ email: direccion }, desempate];
    case "telefono": return [{ phone: direccion }, desempate];
    case "reservas": return [{ reservations: { _count: direccion } }, { createdAt: "desc" }, desempate];
    case "alta": return [{ createdAt: direccion }, desempate];
  }
}

export default async function AdminPassengersPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[]; orden?: string | string[]; dir?: string | string[] }>;
}) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, SEARCH_LIMIT) : "";
  const requestedPage = leerPagina(params.page);
  const orden = leerOrden(COLUMNAS, POR_DEFECTO, {
    orden: typeof params.orden === "string" ? params.orden : undefined,
    dir: typeof params.dir === "string" ? params.dir : undefined
  });
  const where: Prisma.PassengerWhereInput = query ? {
    AND: query.split(/\s+/).map((term) => {
      const match = { contains: term.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } as const;
      return { OR: [{ firstName: match }, { lastName: match }, { email: match }, { phone: match }, { documentId: match }] };
    })
  } : {};

  const total = await prisma.passenger.count({ where });
  const rango = rangoDePagina(total, requestedPage, PAGE_SIZE);
  const passengers = total === 0 ? [] : await prisma.passenger.findMany({
    where,
    orderBy: orderByDe(orden),
    skip: rango.skip,
    take: PAGE_SIZE,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      _count: { select: { reservations: true } },
      reservations: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { code: true }
      }
    }
  });

  return (
    <AdminShell role={sessionUser.role} title="CRM · Pasajeros" eyebrow="Panel de administración">
      <CrmNavigation current="pasajeros" />
      <p className="muted">Consultá los contactos que se registraron al cargar una reserva.</p>
      <form method="get" action="/admin/pasajeros" className="admin-form-grid crm-search">
        <OrdenOculto orden={orden} />
        <label>
          Buscar pasajeros
          <input type="search" name="q" defaultValue={query} maxLength={SEARCH_LIMIT} placeholder="Nombre, email, teléfono o documento" />
        </label>
        <div className="form-actions">
          <button className="button" type="submit">Buscar</button>
          {query && <Link className="ghost-button" href="/admin/pasajeros">Limpiar búsqueda</Link>}
        </div>
      </form>
      <p role="status">{total === 1 ? "1 registro de pasajero" : `${total} registros de pasajeros`}</p>
      <div className="table-scroll">
        <table className="data-table" aria-label="Pasajeros del CRM">
          <thead><tr>
            <EncabezadoOrdenable etiqueta="Pasajero" columna="pasajero" orden={orden} base={BASE} params={params} />
            <EncabezadoOrdenable etiqueta="Email" columna="email" orden={orden} base={BASE} params={params} />
            <EncabezadoOrdenable etiqueta="Teléfono" columna="telefono" orden={orden} base={BASE} params={params} />
            <EncabezadoOrdenable etiqueta="Reservas" columna="reservas" orden={orden} base={BASE} params={params} />
            <th>Última reserva</th>
          </tr></thead>
          <tbody>
            {passengers.map((passenger) => (
              <tr key={passenger.id}>
                <th scope="row">{passenger.firstName} {passenger.lastName}</th>
                <td>{passenger.email}</td>
                <td>{passenger.phone}</td>
                <td>{passenger._count.reservations}</td>
                <td>{passenger.reservations.map(({ code }) => (
                  <Link key={code} className="table-link" href={`/admin/reservas/${code}`} prefetch={false}>Ver reserva {code}</Link>
                ))}{passenger.reservations.length === 0 ? "—" : null}</td>
              </tr>
            ))}
            {passengers.length === 0 && (
              <tr><td colSpan={5}>{query ? "No hay pasajeros que coincidan con la búsqueda." : "Todavía no hay pasajeros registrados."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Paginador {...rango} hrefPagina={(n) => hrefDePagina(BASE, params, n)} etiqueta="pasajeros" />
    </AdminShell>
  );
}
