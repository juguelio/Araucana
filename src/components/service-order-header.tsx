export function CabeceraOrden({ fecha, subtitulo = "Traslados Aeropuerto Chapelco", alcance, soloPantalla, logoSrc }: {
  fecha: string; subtitulo?: string; alcance?: string; soloPantalla?: boolean; logoSrc?: string;
}) {
  return (
    <header className={soloPantalla ? "orden-cabecera no-print" : "orden-cabecera"}>
      {logoSrc && <img width={122} height={62} src={logoSrc} alt="La Araucana Viajes S.R.L." />}
      <div>
        {!logoSrc && <p className="orden-marca">La Araucana viajes S.R.L.</p>}
        <h1 className="orden-titulo">ORDEN DE SERVICIO</h1>
        <p className="orden-subtitulo">{subtitulo}</p>
      </div>
      <div className="orden-fecha">
        <span>Fecha</span>
        <strong>{fecha}</strong>
        {alcance ? <span className="no-print">{alcance}</span> : null}
      </div>
    </header>
  );
}
