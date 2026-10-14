import { NextResponse } from "next/server";
import { ApprovalRequiredError, AuthenticationError, AuthorizationError } from "@/lib/auth/service";

export type ApiErrorFields = Record<string, string>;

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public fields?: ApiErrorFields
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonError(code: string, message: string, status: number, fields?: ApiErrorFields) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(fields ? { fields } : {})
      }
    },
    { status }
  );
}

export function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return jsonError(error.code, error.message, error.status, error.fields);
  }

  if (error instanceof AuthenticationError) {
    return jsonError("AUTHENTICATION_FAILED", error.message, 401);
  }

  if (error instanceof ApprovalRequiredError) {
    return jsonError("PENDING_APPROVAL", error.message, 403);
  }

  if (error instanceof AuthorizationError) {
    return jsonError("FORBIDDEN", error.message, 403);
  }

  console.error(error);
  return jsonError("INTERNAL_SERVER_ERROR", "Error interno del servidor", 500);
}
