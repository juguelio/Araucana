export type NaveApp = { id: string; nombre: string; interno: string | null; patente: string | null };
export type FilaApp = { id: string; nombre: string; cantidad: number; detalle: string; telefono: string | null; registroAnterior?: string };
export type ServicioApp = {
  id: string;
  fecha: string;
  tipo: "Aeropuerto" | "Servicio Público" | "Especial" | "Chapelco" | "Concesiones";
  titulo: string;
  salida: string | null;
  fin: string | null;
  origen: string;
  nave: NaveApp | null;
  paradas: string[];
  indicaciones: string[];
  filas: FilaApp[];
  compartida: boolean;
  comprobante?: string;
};
export type JornadaApp = { fecha: string; servicios: ServicioApp[] };
