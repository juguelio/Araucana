/** Casilleros que se pueden completar a mano en la orden impresa. */
export function FormaDePagoOrden({ metodo }: { metodo: string }) {
  const normalizado = metodo.trim().toLocaleLowerCase("es-AR");
  const conocido = !normalizado || normalizado === "efectivo" || normalizado === "transferencia";
  return (
    <span className="orden-forma-pago">
      {["Efectivo", "Transferencia"].map((opcion) => (
        <span className="orden-forma-pago-opcion" key={opcion}>
          <span className="orden-forma-pago-casillero" aria-hidden="true">{normalizado === opcion.toLowerCase() ? "✓" : ""}</span>
          {opcion}{normalizado === opcion.toLowerCase() ? <span className="sr-only"> (seleccionado)</span> : null}
        </span>
      ))}
      {!conocido ? <span>Otro: {metodo}</span> : null}
    </span>
  );
}
