import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { MapPin, Phone, ShieldCheck, ShieldOff } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { reglagesAcces } from "@/lib/acces-technicien";
import { chargerFicheAppareil, technicienConcerne } from "@/lib/fiche-appareil-technicien";
import { journaliser } from "@/lib/journal";
import { formatDate, formatDateTime } from "@/lib/format";
import { libelleCategorie } from "@/lib/documents";
import { TYPES_SIGNALEMENT, STATUTS_SIGNALEMENT } from "@/lib/signalements-types";
import { Card, Pill, StatutAppareilPill, StatutInterventionPill, TypeInterventionPill } from "@/components/ui";
import { GaleriePhotos } from "@/components/galerie-photos";

// Phase 22 : la fiche d'un appareil pour le technicien (QR code de la cabine
// ou recherche). Seuls les blocs autorisés par le bureau sont affichés.

const ETAT_FINAL: Record<string, string> = {
  en_service: "En service",
  sous_surveillance: "Sous surveillance",
  en_panne: "En panne",
  hors_service: "Hors service",
  en_travaux: "En travaux",
};
const TYPE_VISITE: Record<string, string> = { preventive: "Préventive", corrective: "Corrective", systematique: "Systématique" };

export default async function FicheAppareilTechnicienPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["technicien"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const reglages = await reglagesAcces();
  if (reglages.portee === "concernes" && !(await technicienConcerne(user.id, id))) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/technicien/appareils" className="text-xs text-blue font-semibold">&larr; Trouver un appareil</Link>
        <Card className="p-5 text-sm">Cet appareil ne fait pas partie de vos missions. Contactez le bureau si vous devez intervenir dessus.</Card>
      </div>
    );
  }
  const f = await chargerFicheAppareil(id, reglages, user.id);
  if (!f) notFound();
  const b = reglages.blocs;
  const a = f.appareil;
  const p = f.projetCourant;
  after(() => journaliser({ entite: "appareil", entiteId: id, action: "fiche_consultee_technicien", utilisateurId: user.id, details: a.numeroInterne }));
  const itineraire = p?.adresse ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.adresse)}` : null;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/technicien/appareils" className="text-xs text-blue font-semibold">&larr; Trouver un appareil</Link>

      <div className="-mx-4 px-5 py-5 bg-navy text-white rounded-3xl flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-display font-extrabold text-[24px]">{a.numeroInterne}</h1>
          {b.statut && <StatutAppareilPill statut={a.statut} />}
        </div>
        <div className="text-sm text-[#cfe3f5]">
          {[a.marque, a.modele, a.typeAppareil].filter(Boolean).join(" · ") || "Marque non renseignée"}
          {p?.client ? ` — ${p.client}` : ""}
        </div>
        {f.maMission && (
          <Link href={`/technicien/interventions/${f.maMission.id}`} className="mt-1 min-h-11 rounded-xl bg-white text-navy font-bold text-[14px] flex items-center justify-center">
            Ouvrir ma mission {f.maMission.dateProgrammee ? `du ${formatDateTime(f.maMission.dateProgrammee)}` : ""}
          </Link>
        )}
      </div>

      {b.statut && p && (
        <Card className="p-4 flex flex-col gap-2 text-sm">
          <h2 className="font-display font-bold text-sm">Adresse et accès</h2>
          {p.adresse && (
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 mt-0.5 text-blue shrink-0" /> <span>{p.adresse}</span>
            </div>
          )}
          {p.instructionsAcces && <p className="text-xs text-orange-ink bg-orange-fill rounded-lg px-3 py-2">{p.instructionsAcces}</p>}
          {p.contactNom && (
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-blue shrink-0" />
              <span>
                {p.contactNom}
                {p.contactTelephone && (
                  <>
                    {" — "}
                    <a href={`tel:${p.contactTelephone.replace(/[^+0-9]/g, "")}`} className="font-semibold text-blue">{p.contactTelephone}</a>
                  </>
                )}
              </span>
            </div>
          )}
          <div className="text-xs text-ink-soft">Projet {p.reference} — {p.titre}</div>
          {itineraire && (
            <a href={itineraire} target="_blank" rel="noreferrer" className="min-h-11 rounded-xl border border-[#cfd8e3] bg-white font-semibold text-[14px] flex items-center justify-center">
              Itinéraire
            </a>
          )}
        </Card>
      )}

      {(b.garantie || b.prochaine) && (
        <div className="grid grid-cols-2 gap-2.5">
          {b.garantie && (
            <Card className={`p-3.5 ${f.garantie ? "border-green/40" : ""}`}>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft">
                {f.garantie ? <ShieldCheck className="w-4 h-4 text-green-ink" /> : <ShieldOff className="w-4 h-4" />} Garantie
              </div>
              {f.garantie ? (
                <>
                  <div className="font-display font-bold text-green-ink mt-1">Sous garantie</div>
                  <div className="text-xs text-ink-soft">jusqu&apos;au {formatDate(f.garantie.fin)}</div>
                  {f.garantie.passagesTotal > 0 && <div className="text-xs mt-0.5">Passages : {f.garantie.passagesFaits}/{f.garantie.passagesTotal}</div>}
                </>
              ) : (
                <div className="font-display font-bold mt-1">Hors garantie</div>
              )}
            </Card>
          )}
          {b.prochaine && (
            <Card className="p-3.5">
              <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Prochaine visite</div>
              {f.prochaines[0] ? (
                <>
                  <div className="font-display font-bold text-navy mt-1">{formatDate(f.prochaines[0].date)}</div>
                  <div className="text-xs text-ink-soft">
                    {TYPE_VISITE[f.prochaines[0].type] ?? f.prochaines[0].type}
                    {f.prochaines[0].technicien ? ` · ${f.prochaines[0].technicien}` : ""}
                  </div>
                </>
              ) : (
                <div className="font-display font-bold mt-1 text-ink-soft">Aucune prévue</div>
              )}
            </Card>
          )}
        </div>
      )}

      {b.fiche && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Fiche technique</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Ligne k="N° interne" v={a.numeroInterne} />
            <Ligne k="N° de série" v={a.numeroSerie} />
            <Ligne k="Marque" v={a.marque} />
            <Ligne k="Modèle" v={a.modele} />
            <Ligne k="Type" v={a.typeAppareil} />
            <Ligne k="Année" v={a.anneeInstallation?.toString()} />
            <Ligne k="Charge" v={a.charge ? `${a.charge} kg` : null} />
            <Ligne k="Vitesse" v={a.vitesse ? `${a.vitesse} m/s` : null} />
            <Ligne k="Niveaux" v={a.niveaux?.toString()} />
            <Ligne k="Portes" v={a.typePortes} />
          </dl>
        </Card>
      )}

      {b.techniciens && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Techniciens déjà passés ({f.techniciens.length})</h2>
          <div className="flex flex-col divide-y divide-line">
            {f.techniciens.map((t) => (
              <div key={t.nom} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold">{t.nom}</span>
                <span className="text-xs text-ink-soft text-right">
                  {t.passages} passage{t.passages > 1 ? "s" : ""}
                  {t.dernier ? ` · dernier le ${formatDate(t.dernier)}` : ""}
                </span>
              </div>
            ))}
            {f.techniciens.length === 0 && <p className="text-sm text-ink-soft py-1">Aucun passage enregistré.</p>}
          </div>
        </Card>
      )}

      {b.historique && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Historique des interventions ({f.historique.length})</h2>
          <div className="flex flex-col divide-y divide-line">
            {f.historique.map((h) => (
              <details key={h.id} className="py-2.5 group">
                <summary className="list-none cursor-pointer flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{h.date ? formatDate(h.date) : "Sans date"}</span>
                    <StatutInterventionPill statut={h.statut} />
                  </div>
                  <div className="flex items-center gap-2 text-[12.5px] text-ink-soft flex-wrap">
                    <TypeInterventionPill type={h.type} />
                    <span>{h.technicien ?? "—"}</span>
                    {h.photos.length > 0 && <span>· 📷 {h.photos.length}</span>}
                    {h.pieces.length > 0 && <span>· 🔩 {h.pieces.length}</span>}
                  </div>
                  {h.travaux && <div className="text-[13px] line-clamp-2 group-open:line-clamp-none">{h.travaux}</div>}
                </summary>
                <div className="mt-2 flex flex-col gap-2 text-[13px]">
                  {h.description && <div><span className="text-ink-soft">Demande : </span>{h.description}</div>}
                  {h.observations && <div><span className="text-ink-soft">Observations : </span>{h.observations}</div>}
                  {h.etatFinal && <div><span className="text-ink-soft">État après : </span>{ETAT_FINAL[h.etatFinal] ?? h.etatFinal}</div>}
                  {h.pieces.length > 0 && (
                    <div>
                      <span className="text-ink-soft">Pièces : </span>
                      {h.pieces.map((x) => `${x.quantite} × ${x.nom} (${x.reference})`).join(", ")}
                    </div>
                  )}
                  {h.photos.length > 0 && <GaleriePhotos photos={h.photos.map((url) => ({ url }))} taille="sm" />}
                </div>
              </details>
            ))}
            {f.historique.length === 0 && <p className="text-sm text-ink-soft py-1">Aucune intervention terminée.</p>}
          </div>
        </Card>
      )}

      {b.signalements && (f.pannes.length > 0 || f.signalements.length > 0) && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Pannes et signalements</h2>
          <div className="flex flex-col divide-y divide-line">
            {f.pannes.map((d) => (
              <div key={d.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{d.type === "panne" ? "Panne signalée par le client" : "Demande d'intervention"}</span>
                  <span className="text-xs text-ink-soft">{formatDate(d.createdAt)}</span>
                </div>
                <div className="text-[13px] text-ink-soft line-clamp-2">{d.description}</div>
              </div>
            ))}
            {f.signalements.map((s) => (
              <div key={s.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{TYPES_SIGNALEMENT[s.type]?.icone} {TYPES_SIGNALEMENT[s.type]?.label ?? s.type}</span>
                  <Pill tone={STATUTS_SIGNALEMENT[s.statut]?.tone ?? "neutral"}>{STATUTS_SIGNALEMENT[s.statut]?.label ?? s.statut}</Pill>
                </div>
                <div className="text-xs text-ink-soft">{formatDate(s.createdAt)} · {s.technicien}</div>
                <div className="text-[13px] line-clamp-2">{s.description}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {b.documents && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Documents techniques ({f.documents.length})</h2>
          <div className="flex flex-col divide-y divide-line">
            {f.documents.map((d) => (
              <div key={d.id} className="py-2 flex items-center justify-between gap-3">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue truncate">📄 {d.titre}</a>
                ) : (
                  <span className="text-sm truncate">{d.titre}</span>
                )}
                <span className="text-[11px] text-ink-soft whitespace-nowrap">{libelleCategorie(d.categorie)}</span>
              </div>
            ))}
            {f.documents.length === 0 && <p className="text-sm text-ink-soft py-1">Aucun document pour cet appareil.</p>}
          </div>
        </Card>
      )}

      {b.notes && f.notes.length > 0 && (
        <Card className="p-4">
          <h2 className="font-display font-bold text-sm mb-2">Notes du bureau</h2>
          <div className="flex flex-col divide-y divide-line">
            {f.notes.map((n) => (
              <div key={n.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{n.type === "piece_manquante" ? `🔴 Pièce manquante${n.regleLe ? " (réglée)" : ""}` : "💬 Commentaire"}</span>
                  <span className="text-xs text-ink-soft">{formatDate(n.createdAt)}</span>
                </div>
                <div className="text-[13px]">{n.titre ?? n.texte}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Link
        href={`/technicien/signaler${f.maMission ? `?mission=${f.maMission.id}` : ""}`}
        className="rounded-xl bg-red-fill text-red-ink px-3.5 py-3 font-bold text-[14.5px] text-center"
      >
        ⚠️ Signaler un problème sur cet appareil
      </Link>
    </div>
  );
}

function Ligne({ k, v }: { k: string; v?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{k}</dt>
      <dd className="font-medium">{v || "—"}</dd>
    </div>
  );
}
