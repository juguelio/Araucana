import type { PublicUser } from "@/lib/auth/session";

export type ReservationCreationContext =
  | { fromAdmin: true; creator: PublicUser }
  | { fromAdmin?: false; creator?: PublicUser | null };

type ReservationCreatorFields = {
  createdByName?: string | null;
  createdByRole?: string | null;
};

export function reservationCreatorData(creator?: PublicUser | null) {
  return {
    createdByUserId: creator?.id ?? null,
    createdByName: creator ? creator.name?.trim() || creator.email : null,
    createdByRole: creator?.role ?? "GUEST"
  };
}

export function reservationCreatorLabel({ createdByName, createdByRole }: ReservationCreatorFields) {
  if (createdByRole === "GUEST") return "Huésped";
  if (!createdByName) return "Sin registro";
  const roles: Record<string, string> = {
    ADMIN: "Administrador",
    SECRETARY: "Secretaría",
    DRIVER: "Chofer"
  };
  const role = roles[createdByRole ?? ""] ?? "Usuario";
  return `${createdByName} · ${role}`;
}

export const omitReservationCreator = {
  createdByUserId: true,
  createdByName: true,
  createdByRole: true
} as const;
