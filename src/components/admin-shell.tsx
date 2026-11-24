import { AdminToast } from "@/app/admin/form-ui";
import { roleCanAccess, type AppRole } from "@/lib/auth/roles";
import Link from "next/link";
import { AdminNav } from "./admin-nav";
import { BrandMark } from "./brand-mark";

type AdminShellProps = {
  children: React.ReactNode;
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  notice?: string;
  compactMenu?: { context: string; tools: React.ReactNode; hrefs: Record<string, string>; footer: React.ReactNode };
  role?: AppRole;
};

const links: Array<{ href: string; label: string; roles: AppRole[] }> = [
  { href: "/admin", label: "Panel", roles: ["ADMIN"] },
  { href: "/admin/rutas", label: "Rutas", roles: ["ADMIN"] },
  // Naves abre directo en el mapa: es la pantalla que el cliente mira todo el día. El tablero de flota
  // queda a un clic desde ahí («Tablero de flota»).
  { href: "/admin/naves/en-vivo", label: "Naves", roles: ["ADMIN"] },
  // Los choferes son cuentas con acceso a su planilla: los carga también la secretaría.
  { href: "/admin/choferes", label: "Choferes", roles: ["ADMIN", "SECRETARY"] },
  // Issue #174: todos los servicios del día con su nave y su chofer, de todas las áreas.
  { href: "/admin/salidas-del-dia", label: "Salidas del día", roles: ["ADMIN", "SECRETARY"] },
  // Boletería de las terminales: qué sale de SMA, Traful y VLA, con ocupación y venta directa.
  { href: "/admin/servicio-publico", label: "Servicio público", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/chapelco", label: "Chapelco", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/aeropuerto", label: "Aeropuerto", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/viajes-especiales", label: "Viajes especiales", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/escolares", label: "Escolares", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/excursiones", label: "Excursiones", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/usuarios", label: "CRM", roles: ["ADMIN"] },
  { href: "/admin/reservas", label: "Reservas", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/contabilidad", label: "Contabilidad", roles: ["ADMIN"] },
  { href: "/admin/reportes", label: "Reportes", roles: ["ADMIN"] },
  { href: "/admin/auditoria", label: "Auditoría", roles: ["SUPERADMIN"] },
  { href: "/", label: "Web publica", roles: ["ADMIN", "SECRETARY"] }
];

export function AdminShell({ children, title, eyebrow = "Operacion", action, notice, compactMenu, role = "ADMIN" }: AdminShellProps) {
  // `roleCanAccess` y no `includes`: el super administrador ve todo lo del administrador.
  const visibleLinks = links.filter((link) => roleCanAccess(role, link.roles));

  return (
    <main className={compactMenu ? "admin-layout panel-shell" : "admin-layout"}>
      {compactMenu ? <header className="panel-masthead">
        <div className="panel-mast-inner">
          <Link href={compactMenu.hrefs["/admin"]} className="panel-brand"><BrandMark size={30} />Araucana</Link>
          <div key={compactMenu.context}>
            <button className="panel-menu-trigger" popoverTarget="panel-menu"><span aria-hidden="true">☰</span> Menú</button>
            <div id="panel-menu" className="panel-menu-pop" popover="auto">
              <nav aria-label="Planificación">{compactMenu.tools}</nav>
              <nav aria-label="Módulos de administración">{visibleLinks.filter(link => link.href !== "/admin").map(link =>
                <Link key={link.href} href={compactMenu.hrefs[link.href] ?? link.href}>{link.label}</Link>)}</nav>
              {compactMenu.footer}
            </div>
          </div>
        </div>
      </header> : <aside className="admin-sidebar">
        <div className="brand-lockup">
          <BrandMark color="#1F5B4F" size={36} />
          <div>
            <span className="brand-name">Araucana</span>
            <span className="brand-kicker">PANEL</span>
          </div>
        </div>
        <AdminNav links={visibleLinks.map(({ href, label }) => ({ href, label }))} />
      </aside>}
      <section className="admin-main">
        <div className="admin-top">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="section-title">{title}</h1>
          </div>
          {action}
        </div>
        <AdminToast message={notice} />
        {children}
      </section>
    </main>
  );
}
