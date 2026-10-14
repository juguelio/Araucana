"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function RegisterPage() {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.get("name"), email: form.get("email"), password: form.get("password") })
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setError(payload?.error?.message ?? "No pudimos crear la cuenta.");
        return;
      }
      setDone(true);
    } catch {
      setError("No pudimos conectar. Intentá otra vez.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="page-shell section"><div className="split"><div><p className="eyebrow">Nueva cuenta</p><h1 className="section-title">Creá tu acceso a Araucana.</h1><p className="lead">Las cuentas nuevas quedan pendientes hasta que un administrador las apruebe.</p></div>
    {done ? <section className="form-panel"><p className="eyebrow">Registro recibido</p><h2>Cuenta pendiente de aprobación</h2><p className="muted">Un administrador tiene que habilitar el acceso. Después podés ingresar con tu email y contraseña.</p><Link className="button" href="/login">Ir al ingreso</Link></section> :
      <form className="form-panel" onSubmit={handleSubmit}><label>Nombre<input name="name" autoComplete="name" maxLength={120} /></label><label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label><label>Contraseña<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label><p className="muted">Usá al menos 12 caracteres y hasta 72 bytes.</p>{error ? <p className="error" role="alert">{error}</p> : null}<button className="button" type="submit" disabled={busy}>{busy ? "Creando cuenta..." : "Registrarme"}</button><p className="muted">¿Ya tenés cuenta? <Link href="/login">Ingresá</Link></p></form>}
  </div></main>;
}
