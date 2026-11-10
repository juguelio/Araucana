import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { CrmNavigation } from "../crm-navigation";

const PAGE_SIZE = 25;
const SEARCH_LIMIT = 120;

function pageHref(query: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  return `/admin/pasajeros${params.size ? `?${params}` : ""}`;
}

export default async function AdminPassengersPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  await getCurrentAdminOrRedirect();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, SEARCH_LIMIT) : "";
  const requestedPage = typeof params.page === "string" && /^\d{1,6}$/.test(params.page) ? Number(params.page) : 1;
  const where: Prisma.PassengerWhereInput = query ? {
    AND: query.split(/\s+/).map((term) => {
      const match = { contains: term.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } as const;
      return { OR: [{ firstName: match }, { lastName: match }, { email: match }, { phone: match }, { documentId: match }] };
    })
  } : {};

  const total = await prisma.passenger.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const passengers = total === 0 ? [] : await prisma.passenger.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
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
    <AdminShell title="CRM · Pasajeros" eyebrow="Panel de administración">
      <CrmNavigation current="pasajeros" />
      <p className="muted">Consultá los contactos que se registraron al cargar una reserva.</p>
      <form method="get" action="/admin/pasajeros" className="admin-form-grid crm-search">
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
          <thead><tr><th>Pasajero</th><th>Email</th><th>Teléfono</th><th>Reservas</th><th>Última reserva</th></tr></thead>
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
      {totalPages > 1 && (
        <nav className="pagination-bar" aria-label="Paginación de pasajeros">
          {page > 1 && <Link className="ghost-button" rel="prev" href={pageHref(query, page - 1)}>Anterior</Link>}
          <span>Página {page} de {totalPages}</span>
          {page < totalPages && <Link className="ghost-button" rel="next" href={pageHref(query, page + 1)}>Siguiente</Link>}
        </nav>
      )}
    </AdminShell>
  );
}
