"use client";
import { createContext, useContext, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import type { Option } from "./crew-form";

type Kind = "driverId" | "vehicleId";
type Assignment = { key: string; area: string; title: string; href: string; driverId: string | null; vehicleId: string; start: number | null; end: number | null };
type Resource = { kind: Kind; id: string };
const Desk = createContext<{ panel: boolean; dragging: Resource | null }>({ panel: false, dragging: null });
const clock = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Salta", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
export function OriginField() {
  return useContext(Desk).panel ? <input type="hidden" name="panelOrigin" value="panel" /> : null;
}
export function DropSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { dragging } = useContext(Desk);
  const [hover, setHover] = useState(false);
  const accepts = dragging && dragging.kind === props.name;
  function valid(select: HTMLSelectElement) {
    return accepts && !select.matches(":disabled") && Array.from(select.options).some(o => o.value === dragging.id && !o.disabled);
  }
  return <select {...props} data-drop={accepts ? hover ? "over" : "ready" : undefined}
    onDragOver={e => { if (valid(e.currentTarget)) { e.preventDefault(); setHover(true); } }}
    onDragLeave={() => setHover(false)}
    onDrop={e => {
      setHover(false);
      if (!dragging || !valid(e.currentTarget)) return;
      e.preventDefault();
      e.currentTarget.value = dragging.id;
      e.currentTarget.dispatchEvent(new Event("change", { bubbles: true }));
      e.currentTarget.focus();
    }} />;
}

export function DispatchDesk({ panel, vehicles, drivers, assignments, children }: {
  panel: boolean; vehicles: Option[]; drivers: Option[]; assignments: Assignment[]; children: ReactNode;
}) {
  const [kind, setKind] = useState<Kind>("vehicleId");
  const [selected, setSelected] = useState<Resource | null>(null);
  const [dragging, setDragging] = useState<Resource | null>(null);
  const [search, setSearch] = useState("");
  const options = kind === "vehicleId" ? vehicles : drivers;
  const selectedName = options.find(o => o.id === selected?.id)?.label;
  const agenda = selected ? assignments.filter(a => a[selected.kind] === selected.id)
    .sort((a,b) => (a.start ?? Infinity) - (b.start ?? Infinity)) : [];
  return <Desk.Provider value={{ panel, dragging }}>
    <div className="desk-layout">
      <aside className="desk-resources" aria-label="Recursos de la jornada">
        <h3>Equipo del día</h3>
        <div className="desk-switch">{(["vehicleId","driverId"] as const).map(k => <button type="button" key={k} aria-pressed={kind === k} onClick={() => {setKind(k); setSelected(null); setSearch("");}}>{k === "vehicleId" ? "Naves" : "Choferes"}</button>)}</div>
        <input type="search" aria-label="Buscar en el equipo" placeholder={kind === "vehicleId" ? "Buscar nave…" : "Buscar chofer…"} value={search} onChange={e => setSearch(e.target.value)} />
        <p>Elegí para ver su agenda o arrastrá al selector del servicio. Guardá desde esa fila.</p>
        <div className="desk-options">{options.filter(o => o.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(o =>
          <button type="button" key={o.id} draggable aria-pressed={selected?.id === o.id} onClick={() => setSelected({ kind, id: o.id })}
            onDragStart={e => { e.dataTransfer.setData("text/plain", o.label); e.dataTransfer.effectAllowed = "copy"; setDragging({ kind, id: o.id }); }} onDragEnd={() => setDragging(null)}>
            <span aria-hidden="true">⠿</span> {o.label}
          </button>)}</div>
        {selected && <section className="desk-agenda" aria-live="polite"><h4>{selectedName}</h4>
          {agenda.length === 0 && <p>Sin servicios asignados este día.</p>}
          {agenda.map((a,i) => {
            const overlap = a.start !== null && agenda.some((b,j) => i !== j && b.start !== null && (b.start === a.start || ((a.end !== null && b.start > a.start! && b.start < a.end) || (b.end !== null && a.start! > b.start && a.start! < b.end))));
            return <a key={a.key} href={a.href}><strong>{a.start === null ? "Hora a coordinar" : clock.format(a.start)}{a.end !== null && " – " + clock.format(a.end)}</strong>{a.area} · {a.title}{a.start !== null && a.end === null && <small>Fin a coordinar</small>}{overlap && <small>Revisar cruce horario</small>}</a>;
          })}
        </section>}
      </aside>
      <div className="desk-services">{children}</div>
    </div>
  </Desk.Provider>;
}
