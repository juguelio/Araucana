import { getCurrentDriverOrRedirect } from "@/lib/auth/admin";
import { MiJornada } from "./mi-jornada";
import "./jornada.css";

export const metadata = { title: "Mi jornada · Araucana", robots: { index: false, follow: false } };

export default async function DriverPage() {
  const chofer = await getCurrentDriverOrRedirect();
  return <MiJornada identidad={chofer.id} />;
}
