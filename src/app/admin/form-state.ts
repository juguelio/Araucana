import type { FleetConflict } from "@/lib/special-trips/conflicts";
import type { ZodError } from "zod";

export type AdminFieldErrors = Record<string, string>;

export type AdminFormState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors: AdminFieldErrors;
  conflicts?: FleetConflict[];
  confirmation?: string;
};

export const initialAdminFormState: AdminFormState = {
  status: "idle",
  message: "",
  fieldErrors: {}
};

export function successState(message: string): AdminFormState {
  return {
    status: "success",
    message,
    fieldErrors: {}
  };
}

export function errorState(message: string, fieldErrors: AdminFieldErrors = {}): AdminFormState {
  return {
    status: "error",
    message,
    fieldErrors
  };
}

export function fieldErrorsFromZodError(error: ZodError): AdminFieldErrors {
  const fieldErrors: AdminFieldErrors = {};

  for (const issue of error.issues) {
    const field = issue.path.at(-1);

    if (typeof field === "string" && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }

  return fieldErrors;
}

export function messageFromError(error: unknown, fallback = "No pudimos guardar los cambios. Intentalo nuevamente.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
