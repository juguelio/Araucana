import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const initialError = params?.error === "account"
    ? "No pudimos vincular tu cuenta. Contactá a un administrador de Araucana."
    : params?.error === "oauth"
      ? "No se pudo completar el acceso con Google. Intentá otra vez."
      : "";
  return (
    <main className="page-shell section">
      <div className="split">
        <div>
          <p className="eyebrow">Administracion</p>
          <h1 className="section-title">Entrar a la cabina Araucana.</h1>
            <p className="lead">
              Gestion de rutas, horarios, reservas y pasajeros para una empresa
              de turismo y transporte. La web y las apps usan la misma API.
            </p>
        </div>
        <LoginForm initialError={initialError} />
      </div>
    </main>
  );
}
