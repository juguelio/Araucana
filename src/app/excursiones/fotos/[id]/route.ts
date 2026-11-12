import { get } from "@vercel/blob";
import { getAppUserFromToken, getTokenFromRequest } from "@/lib/auth/service";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = await prisma.excursionPhoto.findUnique({ where: { id }, include: { excursion: { select: { isPublished: true } } } });
  if (!photo) return new Response("Foto no encontrada", { status: 404 });
  if (!photo.excursion.isPublished) {
    const user = await getAppUserFromToken(getTokenFromRequest(request));
    if (!user?.isActive || !["ADMIN", "SECRETARY"].includes(user.role)) return new Response("Foto no encontrada", { status: 404 });
  }
  try {
    const result = await get(photo.blobPathname, { access: "private" });
    if (!result || result.statusCode !== 200) return new Response("Foto no encontrada", { status: 404 });
    return new Response(result.stream, { headers: { "Content-Type": photo.contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  } catch {
    return new Response("Foto no disponible", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
