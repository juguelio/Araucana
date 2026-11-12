import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getAirportExtras } from "@/lib/airport/extras-settings";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { CoverageEditor } from "./coverage-editor";
import { ExtrasEditor } from "./extras-editor";

export default async function AirportCoveragePage() {
  const user = await getCurrentAdminOrRedirect();
  const [coverage, extras] = await Promise.all([getAirportCoverage(), getAirportExtras()]);

  return (
    <AdminShell title="Cobertura de aeropuerto" role={user.role}
      action={<Link className="ghost-button" href="/admin/aeropuerto">Volver a aeropuerto</Link>}>
      <section className="plain-card admin-section">
        <CoverageEditor initialCoverage={coverage} />
      </section>
      <section className="plain-card admin-section">
        <ExtrasEditor initialExtras={extras} />
      </section>
    </AdminShell>
  );
}
