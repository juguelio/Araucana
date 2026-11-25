import { afterEach, expect, it, vi } from "vitest";
import { leerTokenDeOrden, rutaDeLaOrden, vencimientoDelLink } from "@/lib/airport/service-order-link";
import { readSpecialTripOrderLink, specialTripOrderPath } from "./service-order-link";

afterEach(() => vi.unstubAllEnvs());

it("limita el enlace al viaje especial y lo mantiene vigente durante todos sus días", () => {
  vi.stubEnv("AUTH_JWT_SECRET", "clave-local-de-prueba-para-orden-de-viaje-especial");
  const trip = { id: "especial-1", serviceDate: new Date("2032-04-21"), endDate: new Date("2032-04-25") };
  const now = new Date("2032-04-24T19:00Z");
  const token = specialTripOrderPath(trip, now)!.split("/").at(-1)!;
  expect(readSpecialTripOrderLink(token, now)).toEqual({ tripId: trip.id, lastDay: "2032-04-25" });
  expect(leerTokenDeOrden(token, now)).toBeNull();
  const airport = rutaDeLaOrden("2032-04-25", trip.id).split("/").at(-1)!;
  expect(readSpecialTripOrderLink(airport, now)).toBeNull();
  const expired = new Date(vencimientoDelLink("2032-04-25") * 1000);
  expect(readSpecialTripOrderLink(token, expired)).toBeNull();
  expect(specialTripOrderPath(trip, expired)).toBeNull();
});
