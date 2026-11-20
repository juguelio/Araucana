import { readFile } from "node:fs/promises";
import path from "node:path";
import { AdminShell } from "@/components/admin-shell";
import { getCurrentReservationsUserOrRedirect } from "@/lib/auth/admin";
import styles from "./semana.module.css";

export const dynamic = "force-dynamic";

type Fila = {
  recorrido: string;
  hora: string | null;
  chofer1: string | null;
  chofer2: string | null;
  nave: string | number | null;
  nota: string | null;
  categoria: string;
  color: string | null;
};

type Dia = { fecha: string; dia: string; hoja: string | null; filas: Fila[] };

const ETIQUETAS: Record<string, string> = {
  escolar: "Escolar / laboral",
  personal: "Personal de empresa",
  linea: "Línea regular",
  especial: "Viaje especial",
  novedad: "Franco / licencia",
  atencion: "Revisar",
  aeropuerto: "Aeropuerto / personal",
  otros: "Otros",
};

/** Sólo prototipo: la semana sale del Excel de Quique, todavía no de la base. */
async function leerSemana(): Promise<{ dias: Dia[] } | null> {
  try {
    const crudo = await readFile(path.join(process.cwd(), "semana-prototipo.json"), "utf8");
    return JSON.parse(crudo) as { dias: Dia[] };
  } catch {
    return null;
  }
}

function fechaCorta(iso: string) {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(anio, mes - 1, dia)),
  );
}

/** La columna «Hora inicio» mezcla horas, «full day», «Mañana» y «Tarde»: se ordena por lo que significa. */
function ordenDeHora(fila: Fila): number {
  const texto = (fila.hora ?? "").toLowerCase();
  if (texto.includes("full")) return 0;
  if (texto.includes("mañana") || texto.includes("manana")) return 8 * 60;
  if (texto.includes("tarde")) return 14 * 60;
  const m = /^(\d{1,2}):(\d{2})/.exec(texto);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return 24 * 60;
}

/** «Sabe», «avisado», «Avisar» son el estado con el que Quique marca la fila, no una nota más. */
function estadoDeFila(fila: Fila): string | null {
  const nota = (fila.nota ?? "").toString().toLowerCase();
  if (nota.includes("avisad")) return "avisado";
  if (nota.includes("sabe")) return "sabe";
  if (nota.includes("avisar")) return "avisar";
  return null;
}

function etiquetaHora(fila: Fila): string {
  const texto = (fila.hora ?? "").trim();
  if (!texto) return "—";
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(texto)) return texto.slice(0, 5);
  return texto;
}

export default async function SemanaPage() {
  const user = await getCurrentReservationsUserOrRedirect();
  const semana = await leerSemana();

  return (
    <AdminShell title="Semana" role={user.role}>
      <section className="plain-card admin-section">
        <div className={styles.cabecera}>
          <div>
            <h2>La semana de operación</h2>
            <p className={styles.ayuda}>
              Vista de prueba: lee la planilla de Quique y no guarda nada. Sirve para decidir dónde entra en el panel.
            </p>
          </div>
          {semana ? (
            <div className={styles.resumen}>
              {semana.dias.reduce((suma, dia) => suma + dia.filas.length, 0)} servicios en{" "}
              {semana.dias.filter((dia) => dia.filas.length > 0).length} días
            </div>
          ) : null}
        </div>

        <ul className={styles.leyenda}>
          {Object.entries(ETIQUETAS).map(([clave, etiqueta]) => (
            <li key={clave} className={styles[`chip_${clave}` as keyof typeof styles] ?? styles.chip}>
              {etiqueta}
            </li>
          ))}
        </ul>

        {!semana ? (
          <p>
            No encontré <code>semana-prototipo.json</code> en la raíz del proyecto. Generalo con{" "}
            <code>python3 ~/AraucanaWork/semana-json.py 2026-11-16 2026-11-22</code>.
          </p>
        ) : (
          <div className={styles.tablero}>
            {semana.dias.map((dia) => (
              <div key={dia.fecha} className={styles.dia}>
                <header className={styles.diaCabecera}>
                  <strong>{dia.dia}</strong>
                  <span>{fechaCorta(dia.fecha)}</span>
                  {dia.filas.some((f) => estadoDeFila(f) === "avisar") ? (
                    <em className={styles.alerta}>
                      {dia.filas.filter((f) => estadoDeFila(f) === "avisar").length} avisar
                    </em>
                  ) : null}
                  <em>{dia.filas.length}</em>
                </header>
                <div className={styles.filas}>
                  {[...dia.filas].sort((a, b) => ordenDeHora(a) - ordenDeHora(b)).map((fila, i) => (
                    <article
                      key={`${dia.fecha}-${i}`}
                      className={styles.fila}
                      data-categoria={fila.categoria}
                    >
                      <div className={styles.filaArriba}>
                        <span className={styles.hora}>{etiquetaHora(fila)}</span>
                        <span className={styles.nave}>
                          {fila.nave == null || fila.nave === "" ? "sin nave" : `nave ${fila.nave}`}
                        </span>
                      </div>
                      <p className={styles.recorrido}>{fila.recorrido}</p>
                      <p className={styles.choferes}>
                        {fila.chofer1 ?? "sin chofer"}
                        {fila.chofer2 ? ` · ${fila.chofer2}` : ""}
                      </p>
                      {estadoDeFila(fila) ? (
                        <span className={styles.estado} data-estado={estadoDeFila(fila)}>
                          {estadoDeFila(fila)}
                        </span>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  );
}
