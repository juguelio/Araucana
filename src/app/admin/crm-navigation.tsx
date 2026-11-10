import Link from "next/link";
import "./crm.css";

const sections = [
  { id: "usuarios", href: "/admin/usuarios", label: "Usuarios y roles" },
  { id: "pasajeros", href: "/admin/pasajeros", label: "Pasajeros" }
] as const;

export function CrmNavigation({ current }: { current: typeof sections[number]["id"] }) {
  return (
    <nav className="crm-tabs" aria-label="Secciones del CRM">
      {sections.map(({ id, href, label }) => (
        <Link key={id} className={id === current ? "button" : "ghost-button"} href={href} aria-current={id === current ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
