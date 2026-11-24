"use client";

import Link from "next/link";
import { useRef, useState } from "react";

type Entry = { group: string; label: string; href: string };
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function PanelFinder({ entries }: { entries: Entry[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const terms = normalize(query).trim().split(/\s+/);
  const results = query.trim() ? entries.filter(entry => terms.every(term => normalize(entry.group + " " + entry.label).includes(term))) : entries.filter(entry => entry.group === "Tareas");
  return <>
    <button className="ghost-button" onClick={() => { setQuery(""); dialog.current?.showModal(); }}>Buscar o actuar</button>
    <dialog ref={dialog} className="panel-finder" aria-labelledby="panel-finder-title">
      <header><h2 id="panel-finder-title">Buscar o actuar</h2><button className="ghost-button" onClick={() => dialog.current?.close()}>Cerrar</button></header>
      <input autoFocus type="search" aria-label="Buscar tareas, servicios, naves y choferes" placeholder="Tarea, servicio, nave o chofer" value={query} onChange={e => setQuery(e.target.value)} />
      {results.length === 0 && <p role="status">Sin coincidencias para esta jornada.</p>}
      {["Tareas", "Servicios", "Naves", "Choferes"].map(group => {
        const links = results.filter(result => result.group === group);
        return links.length > 0 && <section key={group}><h3>{group}</h3>{links.map(entry => <Link key={entry.href} href={entry.href} onClick={() => dialog.current?.close()}>{entry.label}</Link>)}</section>;
      })}
    </dialog>
  </>;
}
