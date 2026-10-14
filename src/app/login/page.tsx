import { LoginForm } from "./login-form";
import { isGoogleLoginConfigured } from "@/lib/auth/google";

export default function LoginPage() {
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
          <LoginForm googleLoginEnabled={isGoogleLoginConfigured()} />
      </div>
    </main>
  );
}
