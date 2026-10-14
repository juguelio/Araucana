import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Condiciones del portal | La Araucana",
  description: "Condiciones de uso del portal de acceso de La Araucana."
};

export default function TermsPage() {
  return (
    <main className="page-shell section legal-page">
      <p className="eyebrow">La Araucana Viajes</p>
      <h1 className="section-title">Condiciones de uso del portal</h1>
      <p className="lead">Última actualización: 14 de octubre de 2026. Estas condiciones se aplican al acceso al portal interno de La Araucana.</p>

      <h2>Acceso autorizado</h2>
      <p>El portal está destinado a personas autorizadas por La Araucana para tareas de administración y operación. Iniciar sesión con Google verifica tu identidad, pero no concede por sí mismo acceso a funciones privadas. Las cuentas nuevas pueden permanecer pendientes hasta que un administrador las apruebe.</p>

      <h2>Uso de la cuenta</h2>
      <p>Usá únicamente una cuenta que tengas autorización para utilizar. Mantené segura tu cuenta de Google y no compartas sesiones ni credenciales. Avisá a La Araucana si detectás un acceso que no reconocés o un uso indebido del portal.</p>

      <h2>Permisos y disponibilidad</h2>
      <p>Las funciones disponibles dependen del rol asignado a tu cuenta. La Araucana puede modificar, suspender o revocar el acceso cuando sea necesario para proteger el portal o la operación. El servicio puede interrumpirse por mantenimiento, fallas técnicas u otras causas fuera de su control.</p>

      <h2>Alcance</h2>
      <p>Estas condiciones regulan el uso del portal de acceso y administración. No reemplazan ni modifican las condiciones particulares de reservas, traslados, excursiones u otros servicios de viaje.</p>

      <h2>Contacto</h2>
      <p>Consultas sobre estas condiciones: <a href="mailto:info@araucana.com.ar">info@araucana.com.ar</a>.</p>
    </main>
  );
}
