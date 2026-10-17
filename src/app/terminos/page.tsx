import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";

// PENDIENTE CLIENTE (no publicar números inventados; definir con Iván y completar acá):
// 1) tolerancia de espera por servicio (traslados y excursiones),
// 2) escala de retención por cancelación del pasajero y plazo de devolución,
// 3) política de equipaje / bultos y excedentes,
// 4) CUIT del titular (opcional: la razón social y el domicilio ya están en la política de privacidad).

export const metadata: Metadata = {
  title: "Términos y condiciones | La Araucana Viajes",
  description:
    "Condiciones de contratación de traslados, excursiones y servicios de La Araucana Viajes: reservas, pagos por transferencia, cancelaciones y derechos del pasajero.",
  alternates: { canonical: "/terminos" }
};

export default function TermsPage() {
  return (
    <>
      <main className="page-shell section legal-page">
        <Link className="legal-back" href="/">
          ← Volver al sitio
        </Link>
        <p className="eyebrow">La Araucana Viajes</p>
        <h1 className="section-title">Términos y condiciones</h1>
        <p className="legal-updated">
          Última actualización: 16 de octubre de 2026 · Servicios de traslado, excursiones y viajes prestados por La Araucana Viajes
          E.V. y T. desde San Martín de los Andes, Provincia del Neuquén, Argentina.
        </p>

        <div className="legal-note">
          <p>
            <strong>Antes de reservar:</strong> leé estas condiciones. Al reservar por el sitio, por WhatsApp o en la oficina aceptás
            lo que se describe abajo, <strong>sin perjuicio de los derechos que te reconoce la Ley 24.240 de Defensa del
            Consumidor</strong>. Si algo de estas condiciones fuera contrario a esa ley, se aplica siempre la norma más favorable al
            consumidor.
          </p>
        </div>

        <nav className="legal-toc" aria-label="Contenido">
          <b>Contenido</b>
          <a href="#objeto">1. Objeto</a>
          <a href="#oferta">2. Información y oferta</a>
          <a href="#reserva">3. Reserva y confirmación</a>
          <a href="#pagos">4. Pagos</a>
          <a href="#salidas">5. Salidas, horarios y espera</a>
          <a href="#vuelos">6. Servicios al aeropuerto</a>
          <a href="#documentacion">7. Documentación y menores</a>
          <a href="#cancelaciones">8. Cancelaciones y reprogramaciones</a>
          <a href="#responsabilidad">9. Responsabilidad</a>
          <a href="#conducta">10. Conducta a bordo</a>
          <a href="#datos">11. Datos personales</a>
          <a href="#cookies">12. Cookies y tecnologías</a>
          <a href="#portal">13. Portal interno</a>
          <a href="#ley">14. Ley aplicable y jurisdicción</a>
          <a href="#contacto">15. Contacto</a>
        </nav>

        <h2 id="objeto">1. Objeto</h2>
        <p>
          Estas condiciones regulan el uso de este sitio y la contratación de los servicios que presta <strong>La Araucana Viajes
          E.V. y T.</strong>, en particular:
        </p>
        <ul>
          <li>traslados entre San Martín de los Andes y el Aeropuerto Chapelco (CPC), en ambos sentidos;</li>
          <li>servicio público por Ruta 40 y el corredor de los Siete Lagos (San Martín de los Andes – Villa La Angostura – Villa
            Traful) y demás recorridos publicados;</li>
          <li>excursiones locales y salidas guiadas, incluidos viajes y cruces a Chile;</li>
          <li>servicios para grupos, empresas, instituciones y turismo estudiantil.</li>
        </ul>
        <p>
          Duración, recorrido, paradas, punto de encuentro, horarios, capacidad y precio de cada servicio se informan en la ficha de
          la ruta o de la excursión y se confirman al reservar. Si el detalle publicado difiere del servicio que efectivamente se
          presta, el pasajero puede reclamar conforme a la Ley 24.240.
        </p>

        <h2 id="oferta">2. Información y oferta</h2>
        <p>
          El sitio publica las características de cada servicio y el precio vigente por persona en pesos argentinos (ARS). Mientras
          una oferta está publicada en el sitio, <strong>obliga a La Araucana</strong> en los términos del artículo 7 de la Ley 24.240.
        </p>
        <ul>
          <li>Los precios pueden actualizarse sin aviso previo. La reserva se cierra al precio informado en el momento de concretarla.</li>
          <li>Las salidas están sujetas a disponibilidad de cupos y de unidades.</li>
          <li>En rutas con salidas programadas, los horarios publicados son los de partida; los tiempos de viaje son estimados y pueden
            variar por tránsito, clima, estado de los caminos o controles.</li>
          <li>Cuando un servicio no tuviera precio publicado, se muestra como “consultar” y el valor se acuerda con el equipo antes de
            confirmar.</li>
        </ul>

        <h2 id="reserva">3. Reserva y confirmación</h2>
        <p>
          La reserva se realiza desde el sitio (elegís la salida o el vuelo, la cantidad de lugares y los datos del pasajero) o por
          WhatsApp. Al confirmarla se genera un <strong>código de reserva</strong> que sirve para consultar el estado, cargar el
          comprobante de pago y presentar el billete.
        </p>
        <ul>
          <li>El código de reserva es <strong>personal y privado</strong>: funciona como credencial de acceso a la reserva. No lo
            compartas ni lo publiques.</li>
          <li>La reserva queda <strong>pendiente de pago</strong> hasta que se acredita o el equipo valida el pago. El cupo se
            considera confirmado recién en ese momento.</li>
          <li>Los datos del pasajero deben ser correctos y coincidir con el documento de viaje que va a presentar la persona que viaja.
            El titular de la reserva responde por la veracidad de los datos que carga, incluidos los de sus acompañantes.</li>
          <li>El servicio contratado no incluye prestaciones no informadas al reservar (por ejemplo, comidas, entradas a parques o
            excursiones no incluidas).</li>
        </ul>

        <h2 id="pagos">4. Pagos</h2>
        <p>
          El pago se realiza por <strong>transferencia bancaria</strong> a la cuenta de La Araucana que se muestra en el detalle de tu
          reserva, y el comprobante se carga desde el enlace privado de la reserva.
        </p>
        <ul>
          <li>El importe a transferir es el que figura en el resumen de la reserva. Si el equipo acuerda otra modalidad (por ejemplo,
            pago en la oficina o en el punto de encuentro), se informa en la misma reserva antes del viaje.</li>
          <li>El sitio no procesa tarjetas ni almacena datos de tarjetas de crédito o débito.</li>
          <li>El pasajero debe conservar el comprobante de la transferencia. La carga del comprobante no implica la aprobación
            automática del pago: el equipo lo valida contra la acreditación bancaria.</li>
          <li>Si el pago no se acredita o el comprobante no se valida antes de la salida, la reserva puede quedar sin efecto, sin
            perjuicio de lo previsto en la sección 8.</li>
        </ul>

        <h2 id="salidas">5. Salidas, horarios y espera</h2>
        <p>
          El punto de encuentro y la hora se confirman con cada reserva y, en las salidas programadas, se informan en la ficha del
          recorrido. Para los servicios con horario fijo, <strong>el pasajero debe estar en el punto de encuentro a la hora
          acordada</strong>.
        </p>
        <ul>
          <li>Si vas a llegar tarde o tenés un inconveniente, <strong>avisá por WhatsApp</strong> al número que figura en el contacto
            antes de la hora acordada: se hace lo posible por acomodarte (sumarte a la salida si la operación lo permite o
            reprogramarte).</li>
          <li>La tolerancia de espera se informa al confirmar cada salida. Pasado ese plazo y sin aviso previo, la unidad puede
            continuar su recorrido y la reserva se considera no presentada.</li>
          <li>Si la demora es imputable a La Araucana, se ofrece reprogramación sin costo o la devolución del importe abonado, conforme
            a la Ley 24.240.</li>
          <li>Por seguridad y por respeto al resto de los pasajeros, la unidad no modifica su recorrido para buscar pasajeros fuera del
            punto de encuentro acordado.</li>
        </ul>

        <h2 id="vuelos">6. Servicios al aeropuerto</h2>
        <p>
          En los traslados entre San Martín de los Andes y el Aeropuerto Chapelco la reserva incluye el <strong>vuelo elegido</strong>,
          que es la referencia del servicio.
        </p>
        <ul>
          <li>El sistema muestra el estado de los vuelos del día (programado, demorado, aterrizado, cancelado o desviado) según la
            información que recibe de la aerolínea y del aeropuerto. Los horarios pueden cambiar sin intervención de La Araucana.</li>
          <li>Las salidas hacia el aeropuerto se programan para llegar con anticipación razonable al check-in. Si tu vuelo cambia de
            horario, avisanos por WhatsApp para reencuadrar la recogida.</li>
          <li>Si el vuelo se cancela o se desvía y el pasajero no llega, la reserva se reprograma sin costo o se devuelve el importe
            abonado, a elección del pasajero.</li>
          <li>El pasajero es responsable de estar listo en el domicilio o punto de recogida acordado y de mantener un teléfono de
            contacto disponible.</li>
        </ul>

        <h2 id="documentacion">7. Documentación y menores</h2>
        <ul>
          <li>Es responsabilidad exclusiva de cada pasajero contar con <strong>documentación personal vigente y habilitante</strong>
            para el servicio contratado. Para viajes y cruces a Chile se exige documento de identidad vigente y, según el caso,
            documentación adicional migratoria o sanitaria (por ejemplo, para el traslado de mascotas o de mercadería).</li>
          <li>Los <strong>menores de edad</strong> viajan acompañados por una persona mayor responsable y, en viajes al exterior,
            necesitan la autorización de viaje correspondiente. Consultá los requisitos con el equipo antes de reservar.</li>
          <li>La Araucana no puede prestar el servicio si el pasajero no cuenta con la documentación exigida; esa situación se
            resuelve como una cancelación imputable al pasajero.</li>
          <li>Informá con anticipación condiciones médicas, embarazo, discapacidad o necesidades especiales que requieran
            accesibilidad o cuidados durante el viaje, para coordinar el servicio con el vehículo y los tiempos adecuados.</li>
        </ul>

        <h2 id="cancelaciones">8. Cancelaciones y reprogramaciones</h2>
        <ul>
          <li>
            <strong>Cancelación por el pasajero:</strong> avisá lo antes posible por WhatsApp o al 02972 420285. Si avisás con la
            antelación suficiente para liberar el cupo, se devuelve el importe abonado descontando únicamente los costos reales de la
            operación bancaria de la transferencia. Si la cancelación es sobre la hora de salida, puede retenerse una parte del
            importe como compensación del cupo efectivamente reservado.
          </li>
          <li>
            <strong>Cancelación o suspensión por La Araucana</strong> por causas propias, climáticas, de seguridad, por cierre de
            caminos, falla mecánica o cantidad mínima de pasajeros insuficiente: se ofrece <strong>reprogramación sin costo o la
            devolución íntegra de lo abonado, a elección del pasajero</strong>, conforme a la Ley 24.240.
          </li>
          <li>
            <strong>Cambios de fecha</strong> solicitados por el pasajero: se reprograman sin cargo cuando hay cupo disponible en otra
            salida y el aviso es razonablemente previo; si la nueva fecha tiene un precio distinto, se ajusta la diferencia.
          </li>
          <li>
            Las devoluciones se realizan por transferencia a la cuenta que informes. Los plazos pueden depender de los tiempos
            bancarios.
          </li>
        </ul>
        <p>
          Si considerás que una retención o un plazo no refleja los costos reales del servicio, podés reclamar ante el equipo o ante la
          autoridad de defensa del consumidor de la Provincia del Neuquén.
        </p>

        <h2 id="responsabilidad">9. Responsabilidad</h2>
        <p>
          La Araucana presta los servicios con unidades habilitadas, conductores y guías con la experiencia requerida y los seguros
          correspondientes, y responde por los daños que le resulten imputables en los términos de la Ley 24.240.
        </p>
        <p>
          <strong>Estas condiciones no implican renuncia ni limitación de los derechos que la Ley 24.240 reconoce al
          consumidor.</strong> Ninguna cláusula de esta página puede interpretarse como una limitación de responsabilidad ni como
          aceptación por parte del pasajero de exenciones que la ley prohíbe.
        </p>
        <ul>
          <li>El equipaje y los objetos de valor que el pasajero transporta son de su responsabilidad. La Araucana custodia los bultos
            despachados en bodega durante el viaje.</li>
          <li>La Araucana no responde por retrasos o incumplimientos derivados de casos fortuitos o de fuerza mayor (cortes de ruta,
            condiciones climáticas extremas, controles o decisiones de autoridad, paros).</li>
          <li>Los servicios prestados por terceros que el pasajero contrate por su cuenta se rigen por las condiciones de esos terceros.</li>
        </ul>

        <h2 id="conducta">10. Conducta a bordo</h2>
        <p>
          Se viaja con las condiciones de seguridad que indica la unidad: cinturón colocado, sin fumar, sin consumo de alcohol ni
          sustancias, y siguiendo las indicaciones del conductor o guía. Quien ponga en riesgo la seguridad del viaje puede ser
          excluido del servicio, sin perjuicio de lo previsto en la sección 8.
        </p>

        <h2 id="datos">11. Datos personales</h2>
        <p>
          Los datos que dejás al reservar (nombre, apellido, email, teléfono, tipo y número de documento, nacionalidad, cantidad de
          pasajeros y, en los servicios al aeropuerto, el vuelo elegido) se tratan para gestionar la reserva, prestar el servicio y
          validar el pago. El tratamiento se rige por la <Link href="/privacidad">Política de privacidad</Link>, conforme a la Ley
          25.326.
        </p>

        <h2 id="cookies">12. Cookies y tecnologías</h2>
        <p>
          Este sitio no usa cookies de publicidad ni de seguimiento. La única cookie propia es la de sesión del portal interno; al
          iniciar sesión con Google intervienen cookies de ese proveedor. El detalle está en la{" "}
          <Link href="/privacidad#cookies">Política de privacidad</Link>.
        </p>

        <h2 id="portal">13. Portal interno</h2>
        <p>
          Además del sitio público, hay un portal de acceso para el personal y los prestadores autorizados. Estas condiciones también
          se aplican a ese portal:
        </p>
        <h3>Acceso autorizado</h3>
        <p>
          El portal está destinado a personas autorizadas por La Araucana para tareas de administración y operación. Iniciar sesión
          con Google verifica tu identidad, pero no concede por sí mismo acceso a funciones privadas. Las cuentas nuevas pueden
          permanecer pendientes hasta que un administrador las apruebe.
        </p>
        <h3>Uso de la cuenta</h3>
        <p>
          Usá únicamente una cuenta que tengas autorización para utilizar. Mantené segura tu cuenta de Google y no compartas sesiones
          ni credenciales. Avisá a La Araucana si detectás un acceso que no reconocés o un uso indebido del portal.
        </p>
        <h3>Permisos y disponibilidad</h3>
        <p>
          Las funciones disponibles dependen del rol asignado a tu cuenta. La Araucana puede modificar, suspender o revocar el acceso
          cuando sea necesario para proteger el portal o la operación. El servicio puede interrumpirse por mantenimiento, fallas
          técnicas u otras causas fuera de su control.
        </p>

        <h2 id="ley">14. Ley aplicable y jurisdicción</h2>
        <p>
          Estas condiciones se rigen por las leyes de la República Argentina. Para los reclamos, el consumidor puede presentarlos ante
          La Araucana, ante la autoridad de defensa del consumidor de la Provincia del Neuquén o ante los tribunales de San Martín de
          los Andes. Se aplica siempre la norma más favorable al consumidor.
        </p>

        <h2 id="contacto">15. Contacto</h2>
        <p>
          La Araucana Viajes E.V. y T. · Mariano Moreno 829, C.P. 8370, San Martín de los Andes, Neuquén, Argentina ·{" "}
          <a href="tel:+542972420285">02972 420285</a> · <a href="mailto:info@araucana.com.ar">info@araucana.com.ar</a> ·{" "}
          <a href="https://wa.me/5492944649049">WhatsApp</a>. Consultas sobre estas condiciones y reclamos: esos mismos canales.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
