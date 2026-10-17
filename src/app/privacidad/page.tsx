import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";

// PENDIENTE CLIENTE: CUIT del titular (opcional en la política; hoy se publica razón social + domicilio + contacto).
// Si más adelante se agrega analítica o publicidad en el sitio, actualizar la sección "Cookies y tecnologías"
// y pedir consentimiento ANTES de activarla (hoy no hay ninguna tecnología no esencial).

export const metadata: Metadata = {
  title: "Política de privacidad | La Araucana Viajes",
  description:
    "Cómo trata La Araucana Viajes los datos personales de pasajeros, reservas y usuarios del portal, conforme a la Ley 25.326 de Protección de Datos Personales.",
  alternates: { canonical: "/privacidad" }
};

export default function PrivacyPage() {
  return (
    <>
      <main className="page-shell section legal-page">
        <Link className="legal-back" href="/">
          ← Volver al sitio
        </Link>
        <p className="eyebrow">La Araucana Viajes</p>
        <h1 className="section-title">Política de privacidad</h1>
        <p className="legal-updated">
          Última actualización: 16 de octubre de 2026 · Tratamiento de datos personales conforme a la Ley 25.326 de Protección de
          Datos Personales y su decreto reglamentario.
        </p>

        <div className="legal-note">
          <p>
            <strong>En resumen:</strong> usamos tus datos para gestionar la reserva, prestar el servicio, validar el pago y darte
            soporte. No vendemos ni cedemos datos con fines publicitarios. Podés pedir acceso, corrección, actualización o supresión de
            tus datos escribiendo a <a href="mailto:info@araucana.com.ar">info@araucana.com.ar</a>.
          </p>
        </div>

        <nav className="legal-toc" aria-label="Contenido">
          <b>Contenido</b>
          <a href="#responsable">1. Responsable del tratamiento</a>
          <a href="#datos">2. Qué datos tratamos</a>
          <a href="#finalidad">3. Para qué y con qué base</a>
          <a href="#obligatorio">4. Datos necesarios y consecuencias</a>
          <a href="#terceros">5. Con quién los compartimos</a>
          <a href="#conservacion">6. Cuánto tiempo los conservamos</a>
          <a href="#seguridad">7. Cómo los protegemos</a>
          <a href="#arco">8. Tus derechos</a>
          <a href="#menores">9. Menores de edad</a>
          <a href="#cookies">10. Cookies y tecnologías</a>
          <a href="#portal">11. Portal interno y Google</a>
          <a href="#cambios">12. Cambios en esta política</a>
          <a href="#contacto">13. Contacto</a>
        </nav>

        <h2 id="responsable">1. Responsable del tratamiento</h2>
        <p>
          <strong>La Araucana Viajes E.V. y T.</strong> · Mariano Moreno 829, C.P. 8370, San Martín de los Andes, Provincia del
          Neuquén, Argentina · <a href="tel:+542972420285">02972 420285</a> ·{" "}
          <a href="mailto:info@araucana.com.ar">info@araucana.com.ar</a> ·{" "}
          <a href="https://wa.me/5492944649049">WhatsApp</a>. Es quien decide cómo y para qué se tratan los datos personales que se
          recolectan en este sitio, en el portal interno y en la operación de los servicios.
        </p>

        <h2 id="datos">2. Qué datos tratamos</h2>
        <ul>
          <li>
            <strong>Datos de reserva de pasajeros:</strong> nombre y apellido, email, teléfono (con código de país), tipo y número de
            documento, nacionalidad y cantidad de pasajeros. En los servicios al aeropuerto se registra además el vuelo elegido (número
            de vuelo, horario y sentido) y, si corresponde, la dirección de recogida que indica el pasajero.
          </li>
          <li>
            <strong>Datos de la reserva:</strong> código de reserva, ruta o excursión, fecha y horario de la salida, asiento o lugar
            cuando corresponda, importe en pesos argentinos y estado de la reserva.
          </li>
          <li>
            <strong>Datos de pago:</strong> modalidad de pago, estado y el comprobante de transferencia que el pasajero sube (archivo
            PDF, JPG, PNG o WebP). No tratamos números de tarjetas de crédito o débito porque el sitio no procesa pagos con tarjeta.
          </li>
          <li>
            <strong>Comunicaciones:</strong> los mensajes, llamadas y datos de contacto necesarios para coordinar el servicio (por
            ejemplo, por WhatsApp o teléfono), incluidos los avisos de cambios de horario.
          </li>
          <li>
            <strong>Usuarios del portal interno:</strong> email, nombre, rol y permisos asignados, estado de la cuenta, registro de
            accesos y, cuando se usa “Continuar con Google”, el identificador de la cuenta de Google.
          </li>
          <li>
            <strong>Datos de personal y prestadores:</strong> los necesarios para la operación, la asignación de servicios y la
            liquidación (incluidas asignaciones salariales en el módulo de contabilidad).
          </li>
          <li>
            <strong>Datos de ubicación de vehículos y conductores:</strong> durante los servicios se registran posiciones del vehículo
            (coordenadas, velocidad estimada, estado de movimiento y marca de tiempo, y datos del dispositivo que reporta) para el
            seguimiento operativo y la seguridad del viaje.
          </li>
        </ul>
        <p>
          No recolectamos datos sensibles (por ejemplo, salud, origen étnico, convicciones) a través del sitio. Si el pasajero informa
          una condición médica o una necesidad de accesibilidad en forma voluntaria, la usamos únicamente para organizar el servicio y
          con su consentimiento.
        </p>

        <h2 id="finalidad">3. Para qué y con qué base</h2>
        <ul>
          <li><strong>Gestionar la reserva y prestar el servicio</strong> contratado (confirmación, cupos, punto de encuentro, horarios).</li>
          <li><strong>Validar y registrar el pago</strong>, emitir el billete o el comprobante y llevar la contabilidad del servicio.</li>
          <li><strong>Comunicarnos con el pasajero</strong> por cambios de horario, demoras de vuelo, cancelaciones, reprogramaciones y
            soporte posterior al viaje.</li>
          <li><strong>Operar el servicio con seguridad</strong> (asignación de unidades y conductores, seguimiento de ubicación,
            coordinación con el aeropuerto).</li>
          <li><strong>Controlar el acceso al portal interno</strong> y administrar los permisos según el rol de cada usuario.</li>
          <li><strong>Cumplir obligaciones legales</strong>, contables y fiscales, y atender reclamos o requerimientos de autoridad
            competente.</li>
        </ul>
        <p>
          La base del tratamiento es el <strong>consentimiento</strong> del titular (art. 5 de la Ley 25.326) y la ejecución de la
          relación contractual que se genera al reservar. Para el personal y los prestadores, el tratamiento deriva de la relación
          laboral o comercial y de las obligaciones legales aplicables.
        </p>

        <h2 id="obligatorio">4. Datos necesarios y consecuencias</h2>
        <p>
          Los datos de reserva son <strong>necesarios</strong> para prestar el servicio: sin el nombre, el documento, un contacto y la
          cantidad de pasajeros no podemos emitir el billete, ocupar el cupo ni comunicarnos ante un cambio de horario. Los datos que
          no se señalan como obligatorios en el formulario son <strong>facultativos</strong> y su ausencia no impide la reserva. El
          comprobante de pago es necesario para validar la transferencia cuando se abona por ese medio.
        </p>

        <h2 id="terceros">5. Con quién los compartimos</h2>
        <p>
          <strong>No vendemos datos personales</strong> ni los cedemos con fines publicitarios. Para operar el sitio y los servicios
          trabajamos con proveedores que tratan datos por cuenta de La Araucana:
        </p>
        <ul>
          <li><strong>Neon</strong> — base de datos donde se almacenan reservas, pasajeros y usuarios del portal.</li>
          <li><strong>Vercel</strong> — alojamiento de la aplicación y del almacenamiento privado de los comprobantes de pago.</li>
          <li><strong>Google</strong> — inicio de sesión del portal interno cuando el usuario elige “Continuar con Google”.</li>
          <li><strong>WhatsApp / Meta</strong> — canal de contacto con el pasajero, cuando la comunicación se realiza por esa vía.</li>
          <li>
            <strong>Fuentes de información de vuelos</strong> (aerolíneas, tablero del Aeropuerto Chapelco y servicios de datos de
            vuelos): consultamos horarios y estados de vuelo para los traslados al aeropuerto. Estas consultas no incluyen datos
            personales de los pasajeros.
          </li>
        </ul>
        <p>
          También podemos informar datos cuando exista una obligación legal, una orden de autoridad competente o un requerimiento de un
          organismo de control.
        </p>

        <h2 id="conservacion">6. Cuánto tiempo los conservamos</h2>
        <ul>
          <li>Datos de reserva, del servicio prestado y comprobantes de pago: mientras sean necesarios para la operación y para cumplir
            obligaciones contables, fiscales y de defensa ante reclamos.</li>
          <li>Datos de ubicación de vehículos y conductores: por el plazo acotado necesario para el seguimiento operativo y la
            trazabilidad del servicio.</li>
          <li>Datos de usuarios del portal: mientras la cuenta esté activa y por el tiempo necesario para dejar registro de los accesos.</li>
        </ul>
        <p>
          Cuando los datos dejan de ser necesarios o se solicita su supresión, se eliminan o se anonimizan, salvo que exista una
          obligación legal de conservarlos.
        </p>

        <h2 id="seguridad">7. Cómo los protegemos</h2>
        <ul>
          <li>Acceso por roles y por persona: cada usuario del portal ve sólo lo que su rol habilita, y las sesiones pueden revocarse.</li>
          <li>Los comprobantes de pago se almacenan en un espacio <strong>privado</strong>, no accesible por enlace público.</li>
          <li>Cada reserva tiene un código <strong>privado</strong> que funciona como credencial; los enlaces de confirmación no se
            indexan en buscadores y las respuestas con datos de reserva no se almacenan en cachés compartidas.</li>
          <li>Las contraseñas del portal se guardan con hash y el acceso con Google se valida a través del proveedor de identidad.</li>
          <li>Las comunicaciones con el sitio viajan cifradas (HTTPS).</li>
        </ul>
        <p>
          Ningún sistema es infalible. Si detectamos un incidente que afecte datos personales, lo evaluamos y notificamos según
          corresponda.
        </p>

        <h2 id="arco">8. Tus derechos</h2>
        <p>
          Como titular de los datos podés ejercer los derechos de <strong>acceso, rectificación, actualización y supresión</strong>{" "}
          (arts. 14 y 16 de la Ley 25.326), y oponerte a un tratamiento cuando corresponda. Para ejercerlos escribí a{" "}
          <a href="mailto:info@araucana.com.ar">info@araucana.com.ar</a> o por{" "}
          <a href="https://wa.me/5492944649049">WhatsApp</a>, indicando tu nombre, un dato de contacto y qué solicitud querés hacer.
        </p>
        <ul>
          <li>Los pedidos de acceso y de rectificación o supresión se responden en los plazos que fija la ley (10 días corridos para el
            acceso y 5 días hábiles para rectificar, actualizar o suprimir).</li>
          <li>Podemos pedirte que acredites tu identidad antes de responder, para no entregar datos a terceros.</li>
          <li>
            Si considerás que tu reclamo no fue resuelto, podés presentar una denuncia ante la <strong>Agencia de Acceso a la
            Información Pública (AAIP)</strong>, órgano de control de la Ley 25.326 —{" "}
            <a href="https://www.argentina.gob.ar/aaip" target="_blank" rel="noopener noreferrer">
              argentina.gob.ar/aaip
            </a>.
          </li>
        </ul>

        <h2 id="menores">9. Menores de edad</h2>
        <p>
          Los datos de pasajeros menores de edad se tratan con el consentimiento de la madre, el padre o la persona mayor responsable
          que realiza la reserva, y sólo con la finalidad de prestar el servicio, emitir el billete y cumplir los requisitos de viaje
          (incluidas las autorizaciones que exija la autoridad migratoria). El adulto responsable garantiza la veracidad de los datos
          que declara.
        </p>

        <h2 id="cookies">10. Cookies y tecnologías</h2>
        <p>
          Este sitio <strong>no usa cookies de publicidad ni de análisis de tráfico</strong>. Hoy sólo intervienen:
        </p>
        <ul>
          <li>
            <strong>Cookie de sesión del portal interno:</strong> propia, firmada, <code>httpOnly</code> (no accesible desde
            JavaScript en el navegador) y con duración limitada; sirve para mantener la sesión de los usuarios autorizados y se elimina
            al cerrar la sesión o al vencer. Sin ella no es posible usar el portal.
          </li>
          <li>
            <strong>Cookies de Google</strong> durante el inicio de sesión con Google: las gestiona el proveedor de identidad con sus
            propias políticas.
          </li>
          <li>
            <strong>Almacenamiento técnico del hosting y la red de entrega</strong> (Vercel), necesario para servir el sitio.
          </li>
        </ul>
        <p>
          Como no hay tecnologías no esenciales activas, no se muestra un banner de consentimiento: pedirlo no reflejaría la realidad
          del sitio. Si en el futuro incorporamos analítica o publicidad, actualizaremos esta política y pediremos consentimiento antes
          de activarlas.
        </p>

        <h2 id="portal">11. Portal interno y Google</h2>
        <p>
          Si sos usuario del portal interno y elegís “Continuar con Google”, Google comparte con el portal tu{" "}
          <strong>dirección de correo electrónico verificada, tu nombre visible y un identificador único</strong> de tu cuenta. El
          portal solicita únicamente los permisos básicos de identidad, correo electrónico y perfil: <strong>no solicita acceso a
          Gmail, contactos, archivos ni otros servicios de Google</strong>.
        </p>
        <ul>
          <li>Usamos esos datos para identificarte, iniciar sesión, asociar tu cuenta de Google con una cuenta existente y determinar
            si tenés autorización para usar las funciones del portal. Las cuentas nuevas quedan pendientes de aprobación.</li>
          <li>El identificador de Google, el correo y el nombre pueden almacenarse en la base de datos del portal alojada por Neon.
            Vercel presta el alojamiento de la aplicación y Google el servicio de autenticación.</li>
          <li>Para mantener la sesión, el portal guarda una cookie de autenticación protegida, de duración limitada y no accesible desde
            JavaScript en el navegador.</li>
          <li>
            Conservamos los datos de acceso mientras la cuenta sea necesaria para operar el portal. Podés solicitar acceso, corrección
            o eliminación de los datos vinculados al inicio de sesión escribiendo a{" "}
            <a href="mailto:info@araucana.com.ar">info@araucana.com.ar</a>. La solicitud puede requerir validar tu identidad y
            considerar obligaciones legales o de seguridad aplicables.
          </li>
        </ul>

        <h2 id="cambios">12. Cambios en esta política</h2>
        <p>
          Esta política puede actualizarse cuando cambien los servicios, los proveedores o la normativa. La versión vigente es siempre
          la publicada en esta página, con su fecha de última actualización. Si el cambio es sustancial, lo comunicamos por los canales
          de contacto habituales.
        </p>

        <h2 id="contacto">13. Contacto</h2>
        <p>
          La Araucana Viajes E.V. y T. · Mariano Moreno 829, C.P. 8370, San Martín de los Andes, Neuquén, Argentina. Consultas sobre
          datos personales: <a href="mailto:info@araucana.com.ar">info@araucana.com.ar</a> ·{" "}
          <a href="tel:+542972420285">02972 420285</a> · <a href="https://wa.me/5492944649049">WhatsApp</a>. Ver también los{" "}
          <Link href="/terminos">términos y condiciones</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
