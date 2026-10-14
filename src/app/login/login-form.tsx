"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function LoginForm({ initialError = "" }: { initialError?: string }) {
  const [error, setError] = useState(initialError);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function signInWithGoogle() {
    setError("");
    setIsSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` }
      });
      if (authError) throw authError;
    } catch {
      setError("No pudimos iniciar con Google. Revisa la configuracion e intenta otra vez.");
      setIsSubmitting(false);
    }
  }

  return (
    <section className="form-panel">
      <p className="eyebrow">Acceso seguro</p>
      <h2>Ingresá o registrate</h2>
      <p className="muted">Usá tu cuenta de Google. Las cuentas nuevas necesitan aprobación para acceder al sistema.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="button" type="button" onClick={signInWithGoogle} disabled={isSubmitting}>
        {isSubmitting ? "Conectando con Google..." : "Continuar con Google"}
      </button>
    </section>
  );
}
