"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton({ label = "Salir" }: { label?: string }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(false);

  async function handleLogout() {
    setIsSubmitting(true);
    setError(false);
    try {
      const response = await fetch("/api/v1/auth/logout", { method: "POST" });
      if (!response.ok) {
        setError(true);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  return <>
    <button className="danger-button" type="button" onClick={handleLogout} disabled={isSubmitting}>
      {isSubmitting ? "Saliendo..." : label}
    </button>
    {error ? <p className="error" role="alert">No pudimos cerrar la sesión. Intentá de nuevo.</p> : null}
  </>;
}
