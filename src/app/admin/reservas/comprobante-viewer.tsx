const IMAGEN = /\.(jpe?g|png|webp|gif|avif)$/i;
const PDF = /\.pdf$/i;

/**
 * Qué se puede hacer con el archivo que subió el pasajero. HEIC (la foto del iPhone) cae en
 * "otro": no hay visor confiable en el navegador del admin, así que se ofrece el enlace.
 */
export function tipoDeComprobante(fileName?: string | null) {
  if (fileName && PDF.test(fileName)) return "pdf" as const;
  if (fileName && IMAGEN.test(fileName)) return "imagen" as const;
  return "otro" as const;
}

type ComprobanteViewerProps = {
  /** Ruta del panel que sirve el archivo (`/admin/reservas/<code>/comprobante`). */
  href: string;
  fileName?: string | null;
  /** Fecha de subida ya formateada, para no repetir el locale en cada listado. */
  subido?: string | null;
};

/**
 * El comprobante adentro del modal, no en otra pestaña (19-nov: «apreté validar y validó sin que
 * pueda ver el comprobante»). Se ve la foto o el PDF y recién ahí están los botones de validar y
 * rechazar, así no se puede aprobar a ciegas.
 */
export function ComprobanteViewer({ href, fileName, subido }: ComprobanteViewerProps) {
  const tipo = tipoDeComprobante(fileName);
  return (
    <figure className="comprobante-viewer">
      {tipo === "imagen" ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title="Abrir el comprobante en tamaño completo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="comprobante-viewer-img" src={href} alt={`Comprobante ${fileName ?? "de pago"}`} />
        </a>
      ) : tipo === "pdf" ? (
        <object className="comprobante-viewer-pdf" data={`${href}#view=FitH`} type="application/pdf" aria-label={`Comprobante ${fileName ?? "de pago"}`}>
          <p className="muted">
            El navegador no muestra el PDF acá.{" "}
            <a href={href} target="_blank" rel="noopener noreferrer">Abrirlo en otra pestaña</a>.
          </p>
        </object>
      ) : (
        <p className="muted">
          Este formato no se puede mostrar acá.{" "}
          <a href={href} target="_blank" rel="noopener noreferrer">Abrir el comprobante</a>.
        </p>
      )}
      <figcaption className="muted">
        {fileName ?? "Comprobante"}
        {subido ? ` · subido el ${subido}` : ""}
      </figcaption>
    </figure>
  );
}
