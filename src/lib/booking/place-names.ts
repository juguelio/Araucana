/**
 * Nombres de lugares: las rutas los escriben a mano, y el mismo lugar aparece como «San Martin de los
 * Andes» (sin tilde, como `prisma/demo-routes.ts`) o «San Martín de los Andes». Para saber si una ruta
 * es la vuelta de otra, o para listar los lugares una sola vez, se comparan sin tildes, sin mayúsculas
 * y sin espacios de más (19-nov).
 */
export function claveDeLugar(nombre: string) {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function mismoLugar(a: string, b: string) {
  return claveDeLugar(a) === claveDeLugar(b);
}
