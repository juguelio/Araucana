import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { cargarFlotaEnVivo, VENTANA_SENAL_MINUTOS } from "@/lib/driver/en-vivo";
import { FlotaEnVivoMapa } from "./flota-en-vivo-mapa";
import "./en-vivo.css";

export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

/**
 * Mapa en vivo de la flota (issue #316). El dato ya se guardaba (`DriverVehicleLocation`, que escribe
 * el panel del chofer cada 3 s); lo que faltaba era quién lo mirara desde la operación.
 */
export default async function NavesEnVivoPage() {
  const sessionUser = await getCurrentAdminOrRedirect();
  const flota = await cargarFlotaEnVivo();

  return (
    <AdminShell
      role={sessionUser.role}
      title="Naves en vivo"
      action={
        <Link className="ghost-button" href="/admin/naves">
          Volver al tablero
        </Link>
      }
    >
      <p className="lead flota-en-vivo-intro">
        Dónde está cada nave que tiene el panel del chofer abierto. El mapa se actualiza solo cada 10
        segundos; una nave que deja de reportar sigue en su última posición, marcada como <strong>sin señal</strong>{" "}
        después de {VENTANA_SENAL_MINUTOS} minutos.
      </p>

      <FlotaEnVivoMapa inicial={flota} />
    </AdminShell>
  );
}
