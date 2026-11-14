"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminNavLink = { href: string; label: string };

/**
 * Enlaces del panel con la sección actual marcada (`aria-current="page"`). Es un componente cliente
 * sólo por `usePathname`; los enlaces y los roles los decide `AdminShell`.
 */
export function AdminNav({ links }: { links: AdminNavLink[] }) {
  const pathname = usePathname() ?? "";
  const actual = (href: string) => (href === "/" ? false : href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Administracion">
      {links.map((link) => (
        <Link href={link.href} key={link.href} aria-current={actual(link.href) ? "page" : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
