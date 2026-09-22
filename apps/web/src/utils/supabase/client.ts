import { createBrowserClient } from "@supabase/ssr";
import { createDemoBrowserClient, isDemoFallback } from "@/lib/demo-fallback";

export function createClient() {
  if (isDemoFallback()) {
    return createDemoBrowserClient() as unknown as ReturnType<typeof createBrowserClient>;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createBrowserClient(supabaseUrl, supabaseKey);
}
