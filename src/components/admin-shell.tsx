import Link from "next/link";
import { AdminToast } from "@/app/admin/form-ui";
import { AppRole } from "@/lib/auth/roles";
import { BrandMark } from "./brand-mark";

type AdminShellProps = {
  children: React.ReactNode;
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  notice?: string;
  role?: AppRole;
};

const links: Array<{ href: string; label: string; roles: AppRole[] }> = [
  { href: "/admin", label: "Panel", roles: ["ADMIN"] },
  { href: "/admin/rutas", label: "Rutas", roles: ["ADMIN"] },
  { href: "/admin/naves", label: "Naves", roles: ["ADMIN"] },
  { href: "/admin/documentacion", label: "Documentación", roles: ["ADMIN"] },
  { href: "/admin/chapelco", label: "Chapelco", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/usuarios", label: "CRM", roles: ["ADMIN"] },
  { href: "/admin/reservas", label: "Reservas", roles: ["ADMIN", "SECRETARY"] },
  { href: "/admin/contabilidad", label: "Contabilidad", roles: ["ADMIN"] },
  { href: "/admin/reportes", label: "Reportes", roles: ["ADMIN"] },
  { href: "/", label: "Web publica", roles: ["ADMIN", "SECRETARY"] }
];

export function AdminShell({ children, title, eyebrow = "Operacion", action, notice, role = "ADMIN" }: AdminShellProps) {
  const visibleLinks = links.filter((link) => link.roles.includes(role));

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
        <nav aria-label="Administracion">
          {visibleLinks.map((link) => (
            <Link href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
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
