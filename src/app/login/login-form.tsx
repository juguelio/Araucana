"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getDefaultPathForRole, type AppRole } from "@/lib/auth/roles";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null;
        setError(payload?.error?.code === "PENDING_APPROVAL"
          ? "Tu cuenta está pendiente de aprobación."
          : "No pudimos iniciar sesión con esos datos.");
        return;
      }
      const payload = await response.json() as { user?: { role?: AppRole }; isActive?: boolean };
      router.push(payload.isActive ? getDefaultPathForRole(payload.user?.role ?? "USER") : "/acceso-pendiente");
      router.refresh();
    } catch {
      setError("No pudimos conectar. Intentá otra vez.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return <form className="form-panel" onSubmit={handleSubmit}>
    <p className="eyebrow">Acceso seguro</p>
    <h2>Ingresá a tu cuenta</h2>
    <p className="muted">Usá tu email y contraseña. Las cuentas nuevas necesitan aprobación para acceder al sistema.</p>
    <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>
    <label>Contraseña<input name="password" type="password" autoComplete="current-password" required maxLength={72} /></label>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <button className="button" type="submit" disabled={isSubmitting}>{isSubmitting ? "Ingresando..." : "Ingresar"}</button>
    <p className="muted">¿No tenés cuenta? <a href="/registro">Registrate</a></p>
  </form>;
}
