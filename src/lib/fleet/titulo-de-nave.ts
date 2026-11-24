/** «Interno 12» cuando la nave se llama igual que su interno («12»); si no, su nombre. */
export function tituloDeNave(nave: { name: string; internalNumber: string | null }) {
  return nave.internalNumber && nave.name.trim() === nave.internalNumber.trim() ? `Interno ${nave.internalNumber}` : nave.name;
}
