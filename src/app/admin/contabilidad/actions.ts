"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAccountingEntry, parseAccountingEntryInput } from "@/lib/accounting/service";
import { getCurrentAdminOrRedirect } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { errorState, type AdminFormState } from "../form-state";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function revalidateAccountingPaths() {
  revalidatePath("/admin");
  revalidatePath("/admin/contabilidad");
  revalidatePath("/admin/reportes");
}

function noticeRedirect(path: string, notice: string): never {
  redirect(`${path}?notice=${encodeURIComponent(notice)}`);
}

export async function createExpenseAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await getCurrentAdminOrRedirect();

  try {
    const input = parseAccountingEntryInput({
      category: value(formData, "category"),
      amount: value(formData, "amount"),
      occurredAt: value(formData, "occurredAt"),
      vehicleId: value(formData, "vehicleId"),
      notes: value(formData, "notes")
    });

    await createAccountingEntry(input, actor);
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "No pudimos guardar el egreso.");
  }

  revalidateAccountingPaths();
  noticeRedirect("/admin/contabilidad", "Egreso guardado con exito.");
}

export async function createSalaryPaymentAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await getCurrentAdminOrRedirect();

  try {
    const userId = value(formData, "userId");
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        role: {
          in: ["DRIVER", "SECRETARY"]
        },
        isActive: true
      },
      select: {
        id: true,
        role: true
      }
    });

    if (!user) {
      throw new Error("Elegí una secretaria o chofer activo.");
    }

    const input = parseAccountingEntryInput({
      category: user.role === "DRIVER" ? "DRIVER_SALARY" : "SECRETARY_SALARY",
      amount: value(formData, "amount"),
      occurredAt: value(formData, "occurredAt"),
      userId: user.id,
      salaryPeriod: value(formData, "salaryPeriod"),
      notes: value(formData, "notes")
    });

    await createAccountingEntry(input, actor);
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "No pudimos registrar el pago.");
  }

  revalidateAccountingPaths();
  noticeRedirect("/admin/contabilidad", "Pago de sueldo registrado con exito.");
}
