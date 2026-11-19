"use client";
import { createContext, useContext, useEffect, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import Link from "next/link";
import { assignmentsOverlap, type DispatchAssignment } from "@/lib/operations/dispatch";
import { AREA_LABEL } from "@/lib/operations/day-board";
import type { Option } from "./crew-form";

type Kind = "driverId" | "vehicleId";
type Resource = { kind: Kind; id: string };
const ServiceKey = createContext("");
const Desk = createContext<{ panel: boolean; dragging: Resource | null }>({ panel: false, dragging: null });
const clock = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Salta", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
export function OriginField() {
  const key = useContext(ServiceKey);
  return useContext(Desk).panel ? <><input type="hidden" name="panelOrigin" value="panel" />{key && <input type="hidden" name="panelService" value={key} />}</> : null;
}
export function DropSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { dragging } = useContext(Desk);
  const [hover, setHover] = useState(false);
  const accepts = dragging && dragging.kind === props.name;
  const transferType = `application/x-araucana-${props.name?.toLowerCase()}`;
  return <select {...props} data-drop={accepts ? hover ? "over" : "ready" : undefined}
    onDragOver={e => {
      if (e.dataTransfer.types.includes(transferType) && !e.currentTarget.matches(":disabled")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setHover(true);
      }
    }}
    onDragLeave={() => setHover(false)}
    onDrop={e => {
      setHover(false);
      const id = e.dataTransfer.getData(transferType);
      if (!id || e.currentTarget.matches(":disabled")) return;
      if (!Array.from(e.currentTarget.options).some(option => option.value === id && !option.disabled)) return;
      e.preventDefault();
      e.currentTarget.value = id;
      e.currentTarget.dispatchEvent(new Event("change", { bubbles: true }));
      e.currentTarget.focus();
    }} />;
}

export function ServiceDisclosure({ panel, summary, children, serviceKey, initiallyOpen }: { serviceKey: string; initiallyOpen: boolean; panel: boolean; summary: ReactNode; children: ReactNode }) {
  const { dragging } = useContext(Desk);
  if (!panel) return <>{children}</>;
  return <details name="servicio-panel" open={initiallyOpen || undefined} className="plan-service-fold" onDragEnter={event => {
    if (dragging) event.currentTarget.open = true;
  }}>
    <summary>{summary}</summary>
    <ServiceKey.Provider value={serviceKey}><div className="plan-edit">{children}</div></ServiceKey.Provider>
  </details>;
}

export function DispatchDesk({ dateKey, panel, vehicles, drivers, assignments, actions, shortcuts, children }: {
  dateKey: string; panel: boolean; vehicles: Option[]; drivers: Option[]; assignments: DispatchAssignment[]; actions: ReactNode; shortcuts: ReactNode; children: ReactNode;
}) {
  const [showTeam, setShowTeam] = useState(false);
  useEffect(() => {
    if (panel) setShowTeam(sessionStorage.getItem("araucana.panel.equipo") === dateKey);
  }, [dateKey, panel]);

  function toggleTeam() {
    if (showTeam) sessionStorage.removeItem("araucana.panel.equipo");
    else sessionStorage.setItem("araucana.panel.equipo", dateKey);
    setShowTeam(!showTeam);
  }

  const [kind, setKind] = useState<Kind>("vehicleId");
  const [selected, setSelected] = useState<Resource | null>(null);
  const [dragging, setDragging] = useState<Resource | null>(null);
  const [search, setSearch] = useState("");
  const options = kind === "vehicleId" ? vehicles : drivers;
  const selectedName = options.find(o => o.id === selected?.id)?.label;
  const agenda = selected ? assignments.filter(a => a[selected.kind] === selected.id)
    .sort((a,b) => (a.start ?? Infinity) - (b.start ?? Infinity)) : [];
  return <Desk.Provider value={{ panel, dragging }}>
    {panel && <div className="plan-toolbar">
      {actions}
      <button type="button" className="plan-team-trigger" aria-expanded={showTeam} aria-controls="plan-team" onClick={toggleTeam}>Equipo del día</button>
      {shortcuts}
    </div>}
    <div className={panel && !showTeam ? "desk-layout plan-wide" : "desk-layout"}>
      <aside hidden={panel && !showTeam} id="plan-team" className="desk-resources" aria-label="Recursos de la jornada">
        <h3>{panel ? "Naves y choferes" : "Equipo del día"}</h3>
        <div className="desk-switch">{(["vehicleId","driverId"] as const).map(k => <button type="button" key={k} aria-pressed={kind === k} onClick={() => {setKind(k); setSelected(null); setSearch("");}}>{k === "vehicleId" ? "Naves" : "Choferes"}</button>)}</div>
        <input type="search" aria-label="Buscar en el equipo" placeholder={kind === "vehicleId" ? "Buscar nave…" : "Buscar chofer…"} value={search} onChange={e => setSearch(e.target.value)} />
        <p>Elegí para ver la agenda o arrastrá al servicio.</p>
        <div className="desk-options">{options.filter(o => o.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(o =>
          <button type="button" key={o.id} draggable aria-pressed={selected?.id === o.id} onClick={() => setSelected({ kind, id: o.id })}
            onDragStart={e => { e.dataTransfer.setData(`application/x-araucana-${kind.toLowerCase()}`, o.id); e.dataTransfer.effectAllowed = "copy"; setDragging({ kind, id: o.id }); }} onDragEnd={() => setDragging(null)}>
            <span aria-hidden="true">⠿</span> {o.label}
          </button>)}</div>
        {selected && <section className="desk-agenda" aria-live="polite"><h4>{selectedName}</h4>
          {panel && agenda.some(a => a.area === "AEROPUERTO") && (
            <Link prefetch={false} href={{ pathname: "/admin/aeropuerto/orden-de-servicio/ver", query: { date: dateKey, [selected.kind]: selected.id } }}>
              Órdenes de aeropuerto
            </Link>
          )}
          {agenda.length === 0 && <p>Sin servicios asignados este día.</p>}
          {agenda.map((a,i) => {
            const overlap = agenda.some((b, j) => i !== j && assignmentsOverlap(a, b));
            return <a key={a.key} href={a.href}><strong>{a.start === null ? "Hora a coordinar" : clock.format(a.start)}{a.end !== null && " – " + clock.format(a.end)}</strong>{AREA_LABEL[a.area]} · {a.title}{a.estimatedWindow && <span>{a.sharedPickupId ? "Recorrida compartida · horario estimado" : "Horario estimado de servicio"}</span>}{a.start !== null && a.end === null && <small>Fin a coordinar</small>}{overlap && <small>Revisar cruce horario</small>}</a>;
          })}
        </section>}
      </aside>
      <div className="desk-services">{!panel && actions}{children}</div>
    </div>
  </Desk.Provider>;
}
