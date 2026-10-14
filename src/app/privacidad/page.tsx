import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacidad | La Araucana",
  description: "Información sobre los datos utilizados para iniciar sesión con Google en La Araucana."
};

export default function PrivacyPage() {
  return (
    <main className="page-shell section legal-page">
      <p className="eyebrow">La Araucana Viajes</p>
      <h1 className="section-title">Política de privacidad</h1>
      <p className="lead">Última actualización: 14 de octubre de 2026. Esta página describe el uso de datos en el acceso al portal de La Araucana con Google.</p>

      <h2>Datos que recibimos de Google</h2>
      <p>Al elegir “Continuar con Google”, Google comparte con el portal tu dirección de correo electrónico verificada, tu nombre visible y un identificador único de tu cuenta de Google. El portal solicita únicamente los permisos básicos de identidad, correo electrónico y perfil. No solicita acceso a Gmail, contactos, archivos ni otros servicios de Google.</p>

      <h2>Para qué los usamos</h2>
      <p>Usamos esos datos para identificarte, iniciar sesión, asociar tu cuenta de Google con una cuenta existente y determinar si tenés autorización para usar las funciones del portal. Las cuentas nuevas quedan pendientes de aprobación antes de acceder a funciones privadas.</p>

      <h2>Almacenamiento y proveedores</h2>
      <p>El identificador de Google, el correo y el nombre pueden almacenarse en la base de datos del portal alojada por Neon. Vercel presta el alojamiento de la aplicación y Google presta el servicio de autenticación. Para mantener la sesión, el portal guarda una cookie de autenticación protegida, de duración limitada, que no es accesible desde JavaScript en el navegador.</p>

      <h2>Conservación, acceso y eliminación</h2>
      <p>Conservamos los datos de acceso mientras la cuenta sea necesaria para operar el portal. Podés solicitar acceso, corrección o eliminación de los datos vinculados al inicio de sesión escribiendo a <a href="mailto:info@araucana.com.ar">info@araucana.com.ar</a>. La solicitud puede requerir validar tu identidad y considerar obligaciones legales o de seguridad aplicables.</p>

      <h2>Contacto</h2>
      <p>La Araucana Viajes E.V. y T. · Mariano Moreno 829, San Martín de los Andes, Neuquén, Argentina. Consultas: <a href="mailto:info@araucana.com.ar">info@araucana.com.ar</a>.</p>
    </main>
  );
}
