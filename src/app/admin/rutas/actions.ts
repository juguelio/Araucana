"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { getStopFares } from "@/lib/booking/stop-fares";
import { prisma } from "@/lib/db/prisma";
import { errorState, type AdminFieldErrors, type AdminFormState } from "../form-state";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function positiveNumber(formData: FormData, key: string) {
  const parsed = Number(value(formData, key));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

class FormValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: AdminFieldErrors
  ) {
    super(message);
  }
}

function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseStops(raw: string, route: { from: string; to: string; priceCents: number }): Prisma.InputJsonValue {
  const stops = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", km = "0", minutes = "0", note = "", price = ""] = line.split("|").map((item) => item.trim());

      const priceCents = Math.round(Number(price) * 100);
      if (price && (!/^\d+(\.\d{1,2})?$/.test(price) || !Number.isSafeInteger(priceCents) || priceCents <= 0 || priceCents >= route.priceCents)) {
        throw new FormValidationError(`La tarifa de ${name} debe ser mayor a cero y menor que la tarifa de la ruta completa.`, {});
      }
      return {
        name,
        ...(price ? { priceCents } : {}),
        km: Number(km) || 0,
        minutes: Number(minutes) || 0,
        note
      };
    })
    .filter((stop) => stop.name);

  if (getStopFares({ ...route, stops }).length !== stops.filter((stop) => stop.priceCents !== undefined).length) {
    throw new FormValidationError("Asigná tarifas a paradas intermedias con nombres distintos de hasta 160 caracteres.", {});
  }

  return stops;
}

function routeData(formData: FormData) {
  const from = value(formData, "from");
  const to = value(formData, "to");
  const via = value(formData, "via");
  const slug = value(formData, "slug") || slugify(`${from}-${to}-${via}`);
  const durationMin = positiveNumber(formData, "durationMin");
  const price = positiveNumber(formData, "price");
  const fieldErrors: AdminFieldErrors = {};

  if (!from) {
    fieldErrors.from = "Ingresa el origen de la ruta.";
  }

  if (!to) {
    fieldErrors.to = "Ingresa el destino de la ruta.";
  }

  if (!via) {
    fieldErrors.via = "Ingresa por que camino o via se realiza.";
  }

  if (!slug) {
    fieldErrors.slug = "Ingresa un slug publico o completa origen, destino y via para generarlo.";
  }

  if (!durationMin) {
    fieldErrors.durationMin = "Ingresa una duracion mayor a cero.";
  }

  if (!price) {
    fieldErrors.price = "Ingresa un precio mayor a cero.";
  }

  if (Object.keys(fieldErrors).length) {
    throw new FormValidationError("Revisa los campos marcados para guardar la ruta.", fieldErrors);
  }

  return {
    slug,
    from,
    to,
    via,
    durationMin,
    priceCents: Math.round(price * 100),
    currency: value(formData, "currency") || "ARS",
    category: value(formData, "category") || "Argentina",
    description: value(formData, "description"),
    featured: formData.get("featured") === "on",
    isActive: formData.get("isActive") === "on",
    stops: parseStops(value(formData, "stops"), { from, to, priceCents: Math.round(price * 100) })
  };
}

function routeErrorState(error: unknown) {
  if (error instanceof FormValidationError) {
    return errorState(error.message, error.fieldErrors);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  ) {
    return errorState("Ya existe una ruta con esos datos.", {
      slug: "El slug publico ya esta usado por otra ruta."
    });
  }

  return errorState("No pudimos guardar la ruta. Intentalo nuevamente.");
}

function revalidateRoutePaths(slug?: string) {
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/rutas");
  revalidatePath("/cruce-a-chile");
  revalidatePath("/rutas");

  if (slug) {
    revalidatePath(`/rutas/${slug}`);
    revalidatePath(`/reservar/${slug}`);
  }
}

export async function createRouteAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await getCurrentAdminOrRedirect();

  let data: ReturnType<typeof routeData>;
  try {
    data = routeData(formData);
    await prisma.travelRoute.create({ data });
  } catch (error) {
    return routeErrorState(error);
  }

  revalidateRoutePaths(data.slug);
  redirect(`/admin/rutas?notice=${encodeURIComponent("Ruta guardada con exito.")}`);
}

export async function updateRouteAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await getCurrentAdminOrRedirect();

  const id = value(formData, "id");
  if (!id) {
    return errorState("Falta la ruta a editar. Volve a abrirla desde el listado.");
  }

  const current = await prisma.travelRoute.findUnique({ where: { id }, select: { slug: true } });
  let data: ReturnType<typeof routeData>;
  try {
    data = routeData(formData);
    await prisma.travelRoute.update({ where: { id }, data });
  } catch (error) {
    return routeErrorState(error);
  }

  revalidateRoutePaths(current?.slug);
  revalidateRoutePaths(data.slug);
  redirect(`/admin/rutas?notice=${encodeURIComponent("Ruta guardada con exito.")}`);
}

export async function setRouteActiveAction(formData: FormData) {
  await getCurrentAdminOrRedirect();

  const id = value(formData, "id");
  const isActive = value(formData, "isActive") === "true";
  const route = await prisma.travelRoute.update({
    where: { id },
    data: { isActive },
    select: { slug: true }
  });
  revalidateRoutePaths(route.slug);
  redirect(`/admin/rutas?notice=${encodeURIComponent(isActive ? "Ruta activada con exito." : "Ruta inactivada con exito.")}`);
}

export async function deleteRouteAction(formData: FormData) {
  await getCurrentAdminOrRedirect();

  const id = value(formData, "id");
  const route = await prisma.travelRoute.findUnique({ where: { id }, select: { slug: true } });
  if (!route) {
    return;
  }

  const reservations = await prisma.reservation.count({
    where: {
      schedule: {
        routeId: id
      }
    }
  });

  let notice = "Ruta borrada con exito.";
  if (reservations > 0) {
    await prisma.$transaction([
      prisma.travelRoute.update({ where: { id }, data: { isActive: false } }),
      prisma.schedule.updateMany({ where: { routeId: id }, data: { status: "CLOSED" } })
    ]);
    notice = "Ruta archivada con exito porque ya tenia reservas.";
  } else {
    await prisma.travelRoute.delete({ where: { id } });
  }

  revalidateRoutePaths(route.slug);
  redirect(`/admin/rutas?notice=${encodeURIComponent(notice)}`);
}
