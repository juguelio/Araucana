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

type EnlaceDelPanel = { href: string; label: string; roles: AppRole[]; activeFor?: string[]; externo?: boolean };

/**
 * El menú del panel, en grupos (24-nov, pedido de Jugue: «reorganizame este panel»). Antes eran 16
 * enlaces seguidos; ahora cada grupo responde una pregunta de la oficina:
 * - Operación: ¿qué sale hoy, con qué nave y con quién?
 * - Servicios: cada servicio que vende la empresa, con su tablero.
 * - Ventas: reservas y clientes.
 * - Administración: plata, números y auditoría.
 * Un grupo sin enlaces para el rol (la secretaría no ve Administración) no se muestra.
 */
const grupos: Array<{ titulo: string | null; enlaces: EnlaceDelPanel[] }> = [
  {
    titulo: null,
    enlaces: [{ href: "/admin", label: "Panel", roles: ["ADMIN"] }]
  },
  {
    titulo: "Operación",
    enlaces: [
      // Issue #174: todos los servicios del día con su nave y su chofer, de todas las áreas.
      { href: "/admin/salidas-del-dia", label: "Salidas del día", roles: ["ADMIN", "SECRETARY"] },
      // Naves abre directo en el mapa: es la pantalla que el cliente mira todo el día. El tablero de flota
      // queda a un clic desde ahí («Tablero de flota»), y sigue marcando «Naves» en el menú.
      { href: "/admin/naves/en-vivo", label: "Naves", roles: ["ADMIN"], activeFor: ["/admin/naves"] },
      // Los choferes son cuentas con acceso a su planilla: los carga también la secretaría.
      { href: "/admin/choferes", label: "Choferes", roles: ["ADMIN", "SECRETARY"] }
    ]
  },
  {
    titulo: "Servicios",
    enlaces: [
      // Boletería de las terminales y administración de rutas: las dos pantallas del mismo módulo.
      { href: "/admin/servicio-publico", label: "Servicio público", roles: ["ADMIN", "SECRETARY"], activeFor: ["/admin/servicio-publico", "/admin/rutas"] },
      { href: "/admin/aeropuerto", label: "Aeropuerto", roles: ["ADMIN", "SECRETARY"] },
      { href: "/admin/chapelco", label: "Chapelco", roles: ["ADMIN", "SECRETARY"] },
      { href: "/admin/viajes-especiales", label: "Viajes especiales", roles: ["ADMIN", "SECRETARY"] },
      // Concesiones agrupa los servicios recurrentes: escuelas, personal de aeropuerto y otros.
      { href: "/admin/escolares", label: "Concesiones", roles: ["ADMIN", "SECRETARY"], activeFor: ["/admin/escolares"] },
      { href: "/admin/excursiones", label: "Excursiones", roles: ["ADMIN", "SECRETARY"] }
    ]
  },
  {
    titulo: "Ventas",
    enlaces: [
      { href: "/admin/reservas", label: "Reservas", roles: ["ADMIN", "SECRETARY"] },
      { href: "/admin/usuarios", label: "CRM", roles: ["ADMIN"] }
    ]
  },
  {
    titulo: "Administración",
    enlaces: [
      { href: "/admin/contabilidad", label: "Contabilidad", roles: ["ADMIN"] },
      { href: "/admin/reportes", label: "Reportes", roles: ["ADMIN"] },
      { href: "/admin/auditoria", label: "Auditoría", roles: ["SUPERADMIN"] }
    ]
  },
  {
    // La web pública no es una sección del panel: va aparte, al pie, y se abre en otra pestaña.
    titulo: null,
    enlaces: [{ href: "/", label: "Ver la web pública", roles: ["ADMIN", "SECRETARY"], externo: true }]
  }
];

export function AdminShell({ children, title, eyebrow = "Operacion", action, notice, role = "ADMIN" }: AdminShellProps) {
  // `roleCanAccess` y no `includes`: el super administrador ve todo lo del administrador.
  const visibles = grupos
    .map((grupo) => ({
      titulo: grupo.titulo,
      enlaces: grupo.enlaces
        .filter((enlace) => roleCanAccess(role, enlace.roles))
        .map(({ href, label, activeFor, externo }) => ({ href, label, activeFor, externo }))
    }))
    .filter((grupo) => grupo.enlaces.length > 0);

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
        <AdminNav grupos={visibles} />
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
