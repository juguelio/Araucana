"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function InitializeAdminPage() {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/v1/auth/bootstrap-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password"), token: form.get("token") })
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setError(payload?.error?.message ?? "No se pudo inicializar el administrador.");
        return;
      }
      setDone(true);
    } catch {
      setError("No pudimos conectar. Intentá otra vez.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="page-shell section"><div className="split"><div><p className="eyebrow">Configuración inicial</p><h1 className="section-title">Activá el acceso administrador.</h1><p className="lead">Este paso permite crear la primera contraseña para un administrador existente.</p></div>
    {done ? <section className="form-panel"><h2>Administrador listo</h2><p className="muted">Ahora podés ingresar con tu email y la contraseña que elegiste.</p><Link className="button" href="/login">Ir al ingreso</Link></section> :
      <form className="form-panel" onSubmit={handleSubmit}><label>Email de una cuenta administradora<input name="email" type="email" autoComplete="username" required maxLength={254} /></label><label>Nueva contraseña<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><label>Token de inicialización<input name="token" type="password" autoComplete="off" minLength={32} maxLength={256} required /></label><p className="muted">Usá al menos 12 caracteres. Este token se habilita solo para inicializar las cuentas administradoras que todavía no tengan contraseña.</p>{error ? <p className="error" role="alert">{error}</p> : null}<button className="button" type="submit" disabled={busy}>{busy ? "Configurando..." : "Crear contraseña de administrador"}</button></form>}
  </div></main>;
}
