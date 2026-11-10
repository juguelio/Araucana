"use client";

import { startTransition, useActionState, type ReactNode } from "react";
import type { FleetConflict } from "@/lib/special-trips/conflicts";

type ConflictState = { error?: string; conflicts?: FleetConflict[]; confirmation?: string };

export function FleetConflictWarning({ conflicts, confirmation }: { conflicts?: FleetConflict[]; confirmation?: string }) {
  if (!conflicts?.length) return null;
  return <div className="form-alert error span-2" role="alert">
    <p>Revisá la ocupación de la nave.</p>
    <ul>{conflicts.map((conflict) => <li key={conflict.id}>
      <a href={conflict.href} target="_blank" rel="noreferrer">{conflict.possible ? "Posible cruce" : "Superposición"} · {conflict.label}</a>
    </li>)}</ul>
    <button className="ghost-button" name="confirmation" value={confirmation}>Confirmar y guardar con estos avisos</button>
  </div>;
}

export function FleetAssignmentForm({ action, children }: {
  action: (state: ConflictState, form: FormData) => Promise<ConflictState>;
  children: ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  return <form onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget, event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : undefined);
    startTransition(() => dispatch(data));
  }}>
    <fieldset className="inline-actions" disabled={pending}>
      {children}
      {state.error && <p role="alert">{state.error}</p>}
      <FleetConflictWarning conflicts={state.conflicts} confirmation={state.confirmation} />
    </fieldset>
  </form>;
}
