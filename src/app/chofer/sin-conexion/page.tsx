import { MiJornada } from "../mi-jornada";
import "../jornada.css";

export const metadata = { title: "Mi jornada · Araucana", robots: { index: false, follow: false } };

// Esta página se precarga anónimamente. Nunca se guarda el HTML de una sesión autenticada.
export default function JornadaSinConexion() {
  return <MiJornada identidad={null} />;
}
