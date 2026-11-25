import { copiaParaGuardar } from "./estado-jornada";
import type { JornadaApp } from "@/lib/driver/jornada-app-types";

export type EnvioMarca = {
  id: string;
  servicioId: string;
  vehicleId: string | null;
  tipo: "inicio" | "fin" | "embarque";
  filaId?: string;
  cantidad?: number;
  at: string;
  comprobante?: string;
};
export type MarcaWeb = EnvioMarca & {
  fecha: string;
  servicio?: string;
  driverId: string;
  estado: "guardada" | "revision" | "pendiente";
  motivo?: string | null;
};
export type Copia = {
  jornada: JornadaApp;
  sincronizada: string;
  hojas: string[];
  marcas: MarcaWeb[];
};

let conexion: Promise<IDBDatabase> | undefined;
function base() {
  if (!conexion) {
    conexion = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("araucana-jornada-v1", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("jornadas");
        db.createObjectStore("envios", { keyPath: "id" }).createIndex("chofer", "driverId");
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); conexion = undefined; };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    }).catch((error) => { conexion = undefined; throw error; });
  }
  return conexion;
}

async function operacion<T>(
  nombre: "jornadas" | "envios", modo: IDBTransactionMode,
  tarea: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await base();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(nombre, modo);
    const req = tarea(tx.objectStore(nombre));
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () => reject(tx.error ?? new Error("No se pudo guardar en el dispositivo"));
    tx.onerror = () => reject(tx.error);
  });
}

export function leerCopia(chofer: string): Promise<Copia | undefined> {
  return operacion("jornadas", "readonly", store => store.get(chofer));
}
export async function guardarCopia(chofer: string, copia: Copia) {
  const db = await base();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("jornadas", "readwrite");
    const store = tx.objectStore("jornadas");
    const req = store.get(chofer);
    req.onsuccess = () => store.put(copiaParaGuardar(copia, req.result as Copia | undefined), chofer);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
export function borrarCopia(chofer: string) {
  return operacion("jornadas", "readwrite", store => store.delete(chofer));
}
export function ponerEnCola(marca: MarcaWeb) {
  return operacion("envios", "readwrite", store => store.put(marca));
}
export function quitarDeCola(id: string) {
  return operacion("envios", "readwrite", store => store.delete(id));
}
export function leerCola(chofer: string): Promise<MarcaWeb[]> {
  return operacion("envios", "readonly", store => store.index("chofer").getAll(chofer));
}

export function choferGuardado() {
  const cookie = document.cookie.split("; ").find(c => c.startsWith("chofer_offline="));
  return cookie ? decodeURIComponent(cookie.slice("chofer_offline=".length)) : null;
}
