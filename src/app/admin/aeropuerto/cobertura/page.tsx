import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getAirportExtras } from "@/lib/airport/extras-settings";
import { getAirportOfficePickup } from "@/lib/airport/office-pickup";
import { getAirportCoverage } from "@/lib/airport/pickup-zone-settings";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { CoverageEditor } from "./coverage-editor";
import { ExtrasEditor } from "./extras-editor";
import { OfficePickupEditor } from "./office-pickup-editor";

export default async function AirportCoveragePage() {
  const user = await getCurrentAdminOrRedirect();
  const [coverage, extras, officePickup] = await Promise.all([getAirportCoverage(), getAirportExtras(), getAirportOfficePickup()]);

  return (
    <AdminShell title="Cobertura de aeropuerto" role={user.role}
      action={<Link className="ghost-button" href="/admin/aeropuerto">Volver a aeropuerto</Link>}>
      <section className="plain-card admin-section">
        <CoverageEditor initialCoverage={coverage} />
      </section>
      <section className="plain-card admin-section">
        <ExtrasEditor initialExtras={extras} />
      </section>
      <section className="plain-card admin-section">
        <OfficePickupEditor initialPickup={officePickup} />
      </section>
    </AdminShell>
  );
}
