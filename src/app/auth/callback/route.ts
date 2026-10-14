import { NextResponse } from "next/server";
import { getDefaultPathForRole } from "@/lib/auth/roles";
import { syncSignedInSupabaseUser } from "@/lib/auth/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const supabase = await createSupabaseServerClient();

  if (!code) return NextResponse.redirect(new URL("/login?error=oauth", origin));

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=oauth", origin));

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.redirect(new URL("/login?error=oauth", origin));

  try {
    const user = await syncSignedInSupabaseUser(data.user);
    const destination = user.isActive ? getDefaultPathForRole(user.role) : "/acceso-pendiente";
    return NextResponse.redirect(new URL(destination, origin));
  } catch {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=account", origin));
  }
}
