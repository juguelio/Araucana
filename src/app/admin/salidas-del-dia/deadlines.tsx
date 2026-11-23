import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { documentosVigentes, PAPEL_DE_VENCIMIENTO } from "@/lib/vehicles/documents";
import { shiftDateKey } from "@/lib/operations/day-board";

const short = (key: string) => key.split("-").reverse().join("/");
type DocumentDate = { label: string; due?: Date | null; paper?: { href: string; label: string } };

function age(purchase: Date | null, date: string) {
  if (!purchase) return "Sin fecha de compra";
  const start = purchase.toISOString().slice(0,10);
  if (start > date) return "Compra posterior";
  const years = Number(date.slice(0,4)) - Number(start.slice(0,4)) - Number(date.slice(5) < start.slice(5));
  return years === 0 ? "Menos de 1 año desde compra" : years + (years === 1 ? " año" : " años") + " desde compra";
}

export async function Deadlines({ date, filter }: { date: string; filter?: string }) {
  const [fleet, drivers] = await Promise.all([
    prisma.vehicle.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, internalNumber: true, acquiredAt: true, technicalInspectionDueAt: true, rtoDueAt: true, policyDueAt: true,
        documents: { select: { id: true, kind: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], distinct: ["vehicleId", "kind"] } } }),
    prisma.user.findMany({ where: { isActive: true, role: "DRIVER" }, orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, driverProfile: { select: { licenseExpiresAt: true, criminalRecordExpiresAt: true } } } })
  ]);
  const end = shiftDateKey(date, 30);
  const bucket = (due?: Date | null) => {
    const key = due?.toISOString().slice(0,10);
    if (!key) return "sin-fecha";
    return key < date ? "vencidos" : key <= end ? "proximos" : "vigentes";
  };
  const rows = [
    ...fleet.map(v => {
      const latest = documentosVigentes(v.documents);
      const paper = (label: keyof typeof PAPEL_DE_VENCIMIENTO, due: Date | null): DocumentDate => {
        const kind = PAPEL_DE_VENCIMIENTO[label];
        const doc = latest[kind];
        return { label, due, paper: doc ? { href: "/api/vehiculos/" + v.id + "/documentos/" + doc.id, label: "Abrir archivo" } :
          { href: "/admin/naves/" + v.id + "/documentacion#doc-" + kind, label: "Adjuntar" } };
      };
      return { key: "v-" + v.id, label: v.name,
        detail: [v.internalNumber && "Int. " + v.internalNumber, age(v.acquiredAt, date)].filter(Boolean).join(" · "),
        href: "/admin/naves/" + v.id + "/vencimientos", docs: [
          paper("Técnica", v.technicalInspectionDueAt), paper("RTO", v.rtoDueAt), paper("Póliza", v.policyDueAt)
        ] };
    }),
    ...drivers.map(d => ({ key: "d-" + d.id, label: d.name || d.email, detail: "Chofer", href: "/admin/choferes/" + d.id,
      docs: [{ label: "Licencia", due: d.driverProfile?.licenseExpiresAt }, { label: "Antecedentes provinciales", due: d.driverProfile?.criminalRecordExpiresAt }] as DocumentDate[] }))
  ];
  const filters = { proximos: "Próximos 30 días", vencidos: "Vencidos", "sin-fecha": "Sin fecha", todos: "Todos" };
  const active = filter && Object.hasOwn(filters, filter) ? filter : "proximos";
  const docs = rows.flatMap(r => r.docs);
  const grouped = rows.map(row => ({ ...row, docs: row.docs.filter(d => active === "todos" || bucket(d.due) === active) }))
    .filter(row => row.docs.length);
  const totals = new Map<string, number>();
  for (const doc of grouped.flatMap(r => r.docs)) totals.set(doc.label, (totals.get(doc.label) ?? 0) + 1);
  return <section aria-label="Vencimientos de flota y choferes" className="console-work">
    <h3>Vencimientos de flota y choferes</h3>
    <p>Equipo activo · del {short(date)} al {short(end)}</p>
    <nav className="console-switch" aria-label="Filtrar documentos">{Object.entries(filters).map(([key, label]) =>
      <Link key={key} href={"/admin?" + new URLSearchParams({ date, vista: "vencimientos", filtro: key })} aria-current={active === key ? "page" : undefined}>
        {label} ({key === "todos" ? docs.length : docs.filter(d => bucket(d.due) === key).length})</Link>)}</nav>
    {grouped.length ? <>
      <p className="document-totals">{[...totals].map(([label, count]) => <span key={label}>{label} <strong>{count}</strong></span>)}</p>
      <div className="ops-scroll"><table className="ops-table"><thead><tr><th>Unidad o chofer</th><th>Documento</th><th>Vencimiento</th></tr></thead>
        <tbody>{grouped.flatMap(row => row.docs.map((doc,index) => <tr key={row.key + doc.label}>
          {index === 0 && <th scope="rowgroup" rowSpan={row.docs.length}><Link href={row.href}>{row.label}</Link><small>{row.detail}</small></th>}
          <td>{doc.label}{doc.paper && <small><a href={doc.paper.href}>{doc.paper.label}</a></small>}</td><td data-urgencia={bucket(doc.due)}>{doc.due ? short(doc.due.toISOString().slice(0,10)) : "Sin fecha"}</td>
        </tr>))}</tbody></table></div></> : <p>Sin documentos en esta vista.</p>}
  </section>;
}
