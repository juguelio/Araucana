import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./config";

export function createSupabaseAdminClient() {
  const { url } = getSupabasePublicConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("Falta configurar SUPABASE_SECRET_KEY para administrar cuentas.");
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
