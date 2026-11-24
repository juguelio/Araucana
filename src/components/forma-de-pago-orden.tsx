const FORMAS_DE_PAGO = [
  { nombre: "Efectivo", abreviatura: "EF", valores: ["efectivo", "ef"] },
  { nombre: "Transferencia", abreviatura: "TR", valores: ["transferencia", "tr"] },
  { nombre: "Mercado Pago", abreviatura: "MP", valores: ["mercado pago", "mercadopago", "mercado_pago", "mp"] }
];

/** Casilleros que se pueden completar a mano en la orden impresa. */
export function FormaDePagoOrden({ metodo }: { metodo: string }) {
  const normalizado = metodo.trim().toLocaleLowerCase("es-AR");
  const seleccionada = FORMAS_DE_PAGO.find(({ valores }) => valores.includes(normalizado));
  return (
    <span className="orden-forma-pago">
      {FORMAS_DE_PAGO.map(({ nombre, abreviatura }) => {
        const marcada = seleccionada?.nombre === nombre;
        return (
          <span className={abreviatura === "MP" && !marcada ? "orden-forma-pago-opcion orden-solo-papel" : "orden-forma-pago-opcion"} key={abreviatura}>
            <span className="orden-forma-pago-casillero" aria-hidden="true">{marcada ? "✓" : ""}</span>
            <span className="no-print">{nombre}</span>
            <abbr className="orden-solo-papel" title={nombre}>{abreviatura}</abbr>
            {marcada ? <span className="sr-only"> (seleccionado)</span> : null}
          </span>
        );
      })}
      {normalizado && !seleccionada ? <span>Otro: {metodo}</span> : null}
    </span>
  );
}
