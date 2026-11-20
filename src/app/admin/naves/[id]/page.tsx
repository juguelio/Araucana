import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { formatCurrency } from "@/lib/admin/salary";
import { complianceLabel, formatoFecha, vencimientosOrdenados } from "@/lib/vehicles/compliance";
import { AREA_LABEL, GRAVEDAD_LABEL, contarPorArea, filtrarRecorridos, resumenDeDanios } from "@/lib/vehicles/ficha";
import { CabeceraDeNave, SinDatos, cargarNave, diaUtc, fechaDeRecorrido, hrefDeNave, nombreDeNave } from "./ficha-de-nave";
import { cargarRecorridos } from "./datos";

type FichaDeNaveProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ notice?: string }>;
};

/**
 * Ficha de una nave: se entra tocando la unidad en el listado. Muestra lo principal de un vistazo
 * y un panel con las secciones donde se ve el detalle (recorridos, vencimientos, daños, arreglos).
 */
export default async function FichaDeNavePage({ params, searchParams }: FichaDeNaveProps) {
  const sessionUser = await getCurrentAdminOrRedirect();
  const { id } = await params;
  const notice = (await searchParams)?.notice;
  const hoy = new Date();
  const nave = await cargarNave(id);

  const [recorridos, danios, arreglos] = await Promise.all([
    cargarRecorridos(id),
    prisma.vehicleDamage.findMany({ where: { vehicleId: id }, orderBy: { occurredAt: "desc" } }),
    prisma.accountingEntry.findMany({ where: { vehicleId: id, category: "REPAIR" }, orderBy: { occurredAt: "desc" } })
  ]);

  const proximos = filtrarRecorridos(recorridos, "proximos", null, hoy);
  const pasados = filtrarRecorridos(recorridos, "pasados", null, hoy);
  const porArea = contarPorArea(recorridos);
  const papeles = vencimientosOrdenados(nave, hoy);
  const pendientes = papeles.filter((p) => p.level === "vencido" || p.level === "proximo").length;
  const resumenDanios = resumenDeDanios(danios);
  const abiertos = danios.filter((d) => d.status !== "REPARADO");
  // Los arreglos se cargan en pesos; si algún día hay otra moneda, se suma aparte.
  const totalArreglos = arreglos.filter((a) => a.currency === "ARS").reduce((t, a) => t + a.amountCents, 0);
  const ultimoArreglo = arreglos[0];

  return (
    <AdminShell role={sessionUser.role} title={nombreDeNave(nave)} eyebrow="Naves" notice={notice}>
      <CabeceraDeNave nave={nave} seccion="resumen" hoy={hoy} />

      <section className="nave-panel" aria-label="Opciones de la nave">
        <Link className="admin-card nave-opcion" href={hrefDeNave(id, "recorridos")}>
          <span className="nave-opcion-titulo">Historial de recorridos</span>
          <strong>{recorridos.length}</strong>
          <span className="muted">
            {proximos.length} por delante · {pasados.length} hechos
          </span>
          <span className="nave-opcion-ir">Ver recorridos →</span>
        </Link>
        <Link className="admin-card nave-opcion" href={hrefDeNave(id, "vencimientos")} data-nivel={papeles[0]?.level ?? undefined}>
          <span className="nave-opcion-titulo">Vencimientos y seguro</span>
          {/* Sin ninguna fecha cargada no se sabe si está al día: se dice eso. */}
          <strong>{pendientes ? `${pendientes} a revisar` : papeles.some((p) => p.fecha) ? "Al día" : "Sin fechas cargadas"}</strong>
          <span className="muted">{nave.insurer ? `Seguro: ${nave.insurer}` : "Sin aseguradora cargada"}</span>
          <span className="nave-opcion-ir">Ver papeles →</span>
        </Link>
        <Link className="admin-card nave-opcion" href={hrefDeNave(id, "danios")} data-nivel={resumenDanios.graves ? "vencido" : resumenDanios.abiertos ? "proximo" : undefined}>
          <span className="nave-opcion-titulo">Daños</span>
          <strong>{resumenDanios.abiertos ? `${resumenDanios.abiertos} abierto${resumenDanios.abiertos === 1 ? "" : "s"}` : "Sin daños abiertos"}</strong>
          <span className="muted">
            {resumenDanios.graves ? `${resumenDanios.graves} grave${resumenDanios.graves === 1 ? "" : "s"} · ` : ""}
            {resumenDanios.total} en total
          </span>
          <span className="nave-opcion-ir">Ver daños →</span>
        </Link>
        <Link className="admin-card nave-opcion" href={hrefDeNave(id, "reparaciones")}>
          <span className="nave-opcion-titulo">Reparaciones</span>
          <strong>{formatCurrency(totalArreglos)}</strong>
          <span className="muted">
            {arreglos.length} arreglo{arreglos.length === 1 ? "" : "s"}
            {ultimoArreglo ? ` · último ${diaUtc(ultimoArreglo.occurredAt)}` : ""}
          </span>
          <span className="nave-opcion-ir">Ver reparaciones →</span>
        </Link>
      </section>

      <div className="nave-columnas">
        <section className="plain-card admin-section" aria-labelledby="nave-proximos">
          <div className="nave-seccion-top">
            <h2 id="nave-proximos">Próximos servicios</h2>
            <Link className="ghost-button" href={`${hrefDeNave(id, "recorridos")}?momento=proximos`}>Ver todos</Link>
          </div>
          {proximos.length === 0 ? (
            <SinDatos titulo="No tiene servicios por delante.">Se asigna desde salidas, viajes especiales, aeropuerto o Chapelco.</SinDatos>
          ) : (
            <ul className="nave-lista">
              {proximos.slice(0, 5).map((r) => (
                <li key={r.key}>
                  <span className="nave-lista-fecha">{fechaDeRecorrido(r)}</span>
                  <span>
                    {r.href ? <Link href={r.href}>{r.titulo}</Link> : r.titulo}
                    <br />
                    <span className="muted">
                      {AREA_LABEL[r.area]}
                      {r.chofer ? ` · ${r.chofer}` : " · sin chofer"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {recorridos.length > 0 ? (
            <p className="muted nave-nota">
              {(Object.keys(porArea) as Array<keyof typeof porArea>)
                .filter((area) => porArea[area] > 0)
                .map((area) => `${AREA_LABEL[area]}: ${porArea[area]}`)
                .join(" · ")}
            </p>
          ) : null}
        </section>

        <section className="plain-card admin-section" aria-labelledby="nave-papeles">
          <div className="nave-seccion-top">
            <h2 id="nave-papeles">Papeles</h2>
            <Link className="ghost-button" href={hrefDeNave(id, "vencimientos")}>Detalle</Link>
          </div>
          <ul className="nave-lista">
            {papeles.map((p) => (
              <li key={p.tipo} data-nivel={p.level ?? undefined}>
                <span className="nave-lista-fecha">{formatoFecha(p.fecha)}</span>
                <span>
                  <strong>{p.tipo}</strong>
                  <br />
                  <span className="nave-papel" data-nivel={p.level ?? undefined}>{complianceLabel(p.fecha, hoy)}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="nave-seccion-top">
            <h2>Daños abiertos</h2>
            <Link className="ghost-button" href={hrefDeNave(id, "danios")}>Anotar daño</Link>
          </div>
          {abiertos.length === 0 ? (
            <SinDatos titulo="Sin daños pendientes." />
          ) : (
            <ul className="nave-lista">
              {abiertos.slice(0, 4).map((d) => (
                <li key={d.id} data-nivel={d.severity === "GRAVE" ? "vencido" : "proximo"}>
                  <span className="nave-lista-fecha">{GRAVEDAD_LABEL[d.severity as keyof typeof GRAVEDAD_LABEL] ?? d.severity}</span>
                  <span>{d.description}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {nave.notes ? (
        <section className="plain-card admin-section">
          <h2>Notas</h2>
          <p className="nave-notas">{nave.notes}</p>
        </section>
      ) : null}
    </AdminShell>
  );
}
