"use server";

import { revalidatePath } from "next/cache";
import { getAppUserFromToken } from "@/lib/auth/service";
import { ChapelcoError, createChapelcoReservation } from "@/lib/chapelco/repository";
import { chapelcoReservationSchema } from "@/lib/chapelco/validation";
import type { ChapelcoReservationInput } from "@/lib/chapelco/types";

type ChapelcoFieldErrors = Partial<
  Record<
    | "serviceDate"
    | "ascentSlot"
    | "passengerCount"
    | "pickupName"
    | "pickupAddress"
    | "pickupLatitude"
    | "pickupLongitude"
    | "firstName"
    | "lastName"
    | "email"
    | "phone"
    | "documentType"
    | "documentId"
    | "nationality",
    string
  >
>;

export type ChapelcoReservationActionResult =
  | {
      ok: true;
      code: string;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: ChapelcoFieldErrors;
    };

export async function createChapelcoReservationAction(
  input: ChapelcoReservationInput
): Promise<ChapelcoReservationActionResult> {
  const parsed = chapelcoReservationSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: ChapelcoFieldErrors = {};

    for (const issue of parsed.error.issues) {
      const [scope, field] = issue.path;
      const key = scope === "passenger" && typeof field === "string" ? field : scope;

      if (typeof key === "string" && !(key in fieldErrors)) {
        fieldErrors[key as keyof ChapelcoFieldErrors] = issue.message;
      }
    }

    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors
    };
  }

  try {
    const creator = await getAppUserFromToken();
    const reservation = await createChapelcoReservation(parsed.data, { creator });
    revalidatePath("/reservar/chapelco");

    return {
      ok: true,
      code: reservation.code
    };
  } catch (error) {
    if (error instanceof ChapelcoError && error.code === "CHAPELCO_CAPACITY_FULL") {
      return {
        ok: false,
        message: "No quedan cupos para ese dia y horario. Elegi otro horario."
      };
    }

    if (error instanceof ChapelcoError && error.code === "CHAPELCO_ROUTE_NOT_FOUND") {
      return {
        ok: false,
        message: "La ruta Chapelco no esta disponible para reservas."
      };
    }

    if (error instanceof ChapelcoError && error.code === "CHAPELCO_SERVICE_INACTIVE") {
      return {
        ok: false,
        message: "Chapelco no esta activo para esa fecha. Elegi una fecha dentro de la temporada."
      };
    }

    return {
      ok: false,
      message: "No pudimos crear la reserva. Intentalo nuevamente."
    };
  }
}
