import { z } from "zod";
import { passengerSchema } from "@/lib/booking/validation";
import { chapelcoAscentSlots, chapelcoManifestStatuses, chapelcoRunDirections } from "./constants";

const chapelcoFareCounter = z.number().int().min(0, "La cantidad no puede ser negativa.").max(60).default(0);

export const chapelcoReservationSchema = z.object({
  routeId: z.string().min(1, "Selecciona la ruta Chapelco."),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Selecciona una fecha valida."),
  ascentSlot: z.enum(chapelcoAscentSlots),
  passengerCount: z.number().int().min(1, "Ingresa al menos una persona.").max(60, "La reserva supera el maximo permitido."),
  halfFareCount: chapelcoFareCounter,
  freeFareCount: chapelcoFareCounter,
  pickupName: z.string().min(2, "Ingresa el nombre del hotel o lugar.").max(120),
  pickupAddress: z.string().min(4, "Ingresa la direccion.").max(180),
  pickupLatitude: z.number().min(-90).max(90),
  pickupLongitude: z.number().min(-180).max(180),
  pickupNotes: z.string().max(240).nullable().optional(),
  passenger: passengerSchema
});

export const operationDaySchema = z.object({
  routeId: z.string().min(1),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.string().min(1).default("OPEN")
});

export const vehicleDutySchema = z.object({
  operationDayId: z.string().min(1),
  vehicleId: z.string().min(1),
  driverId: z.string().min(1).nullable().optional(),
  capacity: z.number().int().min(1).max(80),
  notes: z.string().max(240).nullable().optional()
});

export const runSchema = z.object({
  operationDayId: z.string().min(1),
  vehicleDutyId: z.string().min(1),
  direction: z.enum(chapelcoRunDirections),
  ascentSlot: z.enum(chapelcoAscentSlots).nullable().optional()
});

export const stopStatusSchema = z.object({
  stopId: z.string().min(1),
  status: z.enum(chapelcoManifestStatuses)
});

export type ChapelcoReservationParsedInput = z.infer<typeof chapelcoReservationSchema>;
