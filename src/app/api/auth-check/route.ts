import { auth } from "@/auth";

// Vérification de session utilisée par nginx (auth_request) avant de servir
// un fichier de /uploads/ : 204 si l'utilisateur est connecté, 401 sinon.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  return new Response(null, {
    status: session?.user ? 204 : 401,
    headers: { "Cache-Control": "no-store" },
  });
}
