import { auth } from "@/auth";
import { abonner, appareilsObservateur, demarrerEcoute, type Changement } from "@/lib/temps-reel";

// Phase 25 : flux « temps réel » (Server-Sent Events) d'un écran connecté.
// L'écran reçoit un petit signal à chaque changement qui le concerne et
// recharge sa page. Un « ping » toutes les 20 s garde la connexion ouverte
// (nginx, réseaux mobiles).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return new Response("Non connecté", { status: 401 });
  await demarrerEcoute();

  const role = String(user.role ?? "");
  let appareils = role === "observateur" ? await appareilsObservateur(user.id) : undefined;
  const enc = new TextEncoder();
  let fermer = () => {};

  const flux = new ReadableStream<Uint8Array>({
    start(ctrl) {
      let ouvert = true;
      const ecrire = (txt: string) => {
        if (!ouvert) return;
        try {
          ctrl.enqueue(enc.encode(txt));
        } catch {
          fermer();
        }
      };
      ecrire(`retry: 3000\nevent: pret\ndata: {}\n\n`);
      const desabonner = abonner({
        role,
        userId: user.id!,
        get appareils() {
          return appareils;
        },
        envoyer: (c: Changement) => {
          // Droits d'un observateur modifiés : on relit ses appareils.
          if (role === "observateur" && (c.t === "observateurs" || c.t === "observateur_appareils")) {
            void appareilsObservateur(user.id!).then((a) => (appareils = a));
          }
          ecrire(`data: ${JSON.stringify({ t: c.t, i: c.i ?? null, a: c.a ?? null })}\n\n`);
        },
      });
      const ping = setInterval(() => ecrire(`: ping\n\n`), 20000);
      fermer = () => {
        if (!ouvert) return;
        ouvert = false;
        clearInterval(ping);
        desabonner();
        try {
          ctrl.close();
        } catch {
          /* déjà fermé */
        }
      };
      req.signal.addEventListener("abort", fermer);
    },
    cancel() {
      fermer();
    },
  });

  return new Response(flux, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform : pas de compression (sinon les signaux resteraient bloqués)
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx : ne pas mettre le flux en mémoire tampon
      "X-Accel-Buffering": "no",
    },
  });
}
