import { AdminToast } from "@/app/admin/form-ui";
import { roleCanAccess, type AppRole } from "@/lib/auth/roles";
import { AdminNav } from "./admin-nav";
import { BrandMark } from "./brand-mark";

type AdminShellProps = {
  children: React.ReactNode;
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  notice?: string;
  role?: AppRole;
};

const links: Array<{ href: string; label: string; roles: AppRole[]; activeFor?: string[] }> = [
  { href: "/admin", label: "Panel", roles: ["ADMIN"] },
  // Naves abre directo en el mapa: es la pantalla que el cliente mira todo el día. El tablero de flota
  // queda a un clic desde ahí («Tablero de flota»).
  { href: "/admin/naves/en-vivo", label: "Naves", roles: ["ADMIN"] },
  // Los choferes son cuentas con acceso a su planilla: los carga también la secretaría.
  { href: "/admin/choferes", label: "Choferes", roles: ["ADMIN", "SECRETARY"] },
  // Issue #174: todos los servicios del día con su nave y su chofer, de todas las áreas.
  { href: "/admin/salidas-del-dia", label: "Salidas del día", roles: ["ADMIN", "SECRETARY"] },
  // Boletería de las terminales y administración de rutas: las dos pantallas del mismo módulo.
  { href: "/admin/servicio-publico", label: "Servicio público", roles: ["ADMIN", "SECRETARY"], activeFor: ["/admin/servicio-publico", "/admin/rutas"] },
  { href: "/admin/chapelco", label: "Chapelco", roles: ["ADMIN", "SECRETARY"] },
  // Concesiones agrupa los servicios recurrentes: escuelas y aeropuerto.
  { href: "/admin/escolares", label: "Concesiones", roles: ["ADMIN", "SECRETARY"], activeFor: ["/admin/escolares", "/admin/aeropuerto"] },
  { href: "/admin/viajes-especiales", label: "Viajes especiales", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/excursiones", label: "Excursiones", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/usuarios", label: "CRM", roles: ["ADMIN"] },
  { href: "/admin/reservas", label: "Reservas", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/contabilidad", label: "Contabilidad", roles: ["ADMIN"] },
  { href: "/admin/reportes", label: "Reportes", roles: ["ADMIN"] },
  { href: "/admin/auditoria", label: "Auditoría", roles: ["SUPERADMIN"] },
  { href: "/", label: "Web publica", roles: ["ADMIN", "SECRETARY"] }
];

export function AdminShell({ children, title, eyebrow = "Operacion", action, notice, role = "ADMIN" }: AdminShellProps) {
  // `roleCanAccess` y no `includes`: el super administrador ve todo lo del administrador.
  const visibleLinks = links.filter((link) => roleCanAccess(role, link.roles));

  return (
    <main className="admin-layout">
      <aside className="admin-sidebar">
        <div className="brand-lockup">
          <BrandMark color="#1F5B4F" size={36} />
          <div>
            <span className="brand-name">Araucana</span>
            <span className="brand-kicker">PANEL</span>
          </div>
        </div>
        <AdminNav links={visibleLinks.map(({ href, label, activeFor }) => ({ href, label, activeFor }))} />
      </aside>
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
