"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Minus, Plus, Search, X } from "lucide-react";
import { creerAppareilRapide, creerClientRapide, creerProjetComplet } from "./actions";

export type DonneesAssistant = {
  clients: { id: string; nom: string; type: string }[];
  appareils: { id: string; numero: string; marque: string | null; modele: string | null; type: string | null; niveaux: number | null; clientIds: string[] }[];
  techniciens: { id: string; nom: string; statutRh: string; poste: string | null; specialites: string | null; habilitations: string[]; missionsEnCours: number }[];
  formules: { id: string; nom: string; dureeMois: number; visites: number; prix: string; extension: boolean }[];
  catalogue: { id: string; nom: string; categorie: string; prix: string | null }[];
};

const ETAPES = ["Projet", "Client", "Appareils", "Équipe", "Garantie", "Prestations", "Récap"] as const;
const TYPES = [
  { id: "installation", label: "Installation", hint: "Ascenseur neuf" },
  { id: "maintenance", label: "Maintenance", hint: "Contrat d'entretien" },
  { id: "modernisation", label: "Modernisation", hint: "Mise à niveau" },
  { id: "reparation", label: "Réparation", hint: "Intervention ponctuelle" },
] as const;
const TYPE_CLIENT: Record<string, string> = {
  copropriete: "Copropriété",
  entreprise: "Entreprise",
  particulier: "Particulier",
  syndicat: "Syndicat",
  sous_traitance: "Sous-traitance",
};
const CAT: Record<string, string> = { installation: "Installation", reparation: "Réparation", maintenance: "Maintenance", autre: "Autre" };
const STATUT_RH: Record<string, { label: string; ok: boolean }> = {
  actif: { label: "Disponible", ok: true },
  en_conge: { label: "En congé", ok: false },
  arret_maladie: { label: "Absent", ok: false },
  en_formation: { label: "En formation", ok: false },
  suspendu: { label: "Suspendu", ok: false },
};

const euro = (v: string | number | null | undefined) =>
  v == null || v === "" ? "—" : new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(v));
const input = "w-full rounded-xl border border-[#cfd8e3] bg-white px-3.5 py-2.5 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-accent/40 focus:border-blue";
const carte = (on: boolean) =>
  `text-left rounded-xl p-4 transition-all cursor-pointer ${on ? "border-2 border-blue bg-[#f0f7fd] shadow-sm" : "border border-line bg-white hover:border-[#b9c6d6]"}`;

function Champ({ label, children, aide }: { label: string; children: React.ReactNode; aide?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-ink-soft">{label}</span>
      {children}
      {aide && <span className="text-xs text-ink-soft">{aide}</span>}
    </label>
  );
}

function Recherche({ valeur, onChange, placeholder }: { valeur: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[#cfd8e3] bg-white px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-blue-accent/40">
      <Search className="w-4 h-4 text-ink-soft" />
      <input value={valeur} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="flex-1 bg-transparent text-[15px] focus:outline-none" />
      {valeur && (
        <button type="button" onClick={() => onChange("")} aria-label="Effacer" className="text-ink-soft">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export function AssistantProjet({ donnees }: { donnees: DonneesAssistant }) {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  const [etape, setEtape] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);

  // Étape 1
  const [titre, setTitre] = useState("");
  const [typeProjet, setTypeProjet] = useState<string>("installation");
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [adresse, setAdresse] = useState("");
  const [acces, setAcces] = useState("");
  const [contactNom, setContactNom] = useState("");
  const [contactTel, setContactTel] = useState("");
  const [description, setDescription] = useState("");
  // Étape 2
  const [clients, setClients] = useState(donnees.clients);
  const [clientId, setClientId] = useState<string | null>(null);
  const [rechClient, setRechClient] = useState("");
  const [nouveauClient, setNouveauClient] = useState<{ nom: string; type: string } | null>(null);
  // Étape 3
  const [appareils, setAppareils] = useState(donnees.appareils);
  const [appSel, setAppSel] = useState<string[]>([]);
  const [rechApp, setRechApp] = useState("");
  const [nouvelApp, setNouvelApp] = useState<{ numero: string; marque: string; modele: string; type: string } | null>(null);
  // Étape 4
  const [equipe, setEquipe] = useState<{ id: string; role: string }[]>([]);
  const [envoyerOrdre, setEnvoyerOrdre] = useState(true);
  // Étape 5
  const [formuleId, setFormuleId] = useState<string | null>(null);
  // Étape 6
  const [qte, setQte] = useState<Record<string, number>>({});

  const client = clients.find((c) => c.id === clientId) ?? null;
  const formule = donnees.formules.find((f) => f.id === formuleId) ?? null;

  const clientsFiltres = useMemo(() => {
    const q = rechClient.trim().toLowerCase();
    return clients.filter((c) => !q || c.nom.toLowerCase().includes(q)).slice(0, 60);
  }, [clients, rechClient]);

  const appareilsTries = useMemo(() => {
    const q = rechApp.trim().toLowerCase();
    const liste = appareils.filter(
      (a) => !q || [a.numero, a.marque, a.modele, a.type].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
    const duClient = (a: (typeof appareils)[number]) => (clientId && a.clientIds.includes(clientId) ? 0 : 1);
    return liste.sort((a, b) => duClient(a) - duClient(b) || a.numero.localeCompare(b.numero)).slice(0, 90);
  }, [appareils, rechApp, clientId]);

  const lignesPresta = Object.entries(qte).filter(([, n]) => n > 0);
  const totalPresta = lignesPresta.reduce((s, [id, n]) => s + Number(donnees.catalogue.find((c) => c.id === id)?.prix ?? 0) * n, 0);

  function valider(e: number): string | null {
    if (e === 0) {
      if (titre.trim().length < 2) return "Donnez un nom au projet.";
      if (adresse.trim().length < 3) return "L'adresse d'intervention est obligatoire.";
      if (dateDebut && dateFin && dateFin < dateDebut) return "La date de fin est avant la date de début.";
    }
    if (e === 1 && !clientId) return "Choisissez un client (ou créez-le).";
    return null;
  }

  function aller(cible: number) {
    for (let e = 0; e < Math.min(cible, 2); e++) {
      const err = valider(e);
      if (err) {
        setEtape(e);
        setErreur(err);
        return;
      }
    }
    setErreur(null);
    setEtape(cible);
  }

  function creerClient() {
    if (!nouveauClient) return;
    startTransition(async () => {
      const r = await creerClientRapide({ raisonSociale: nouveauClient.nom, type: nouveauClient.type });
      if (!r.ok) return setErreur(r.erreur);
      setClients((l) => [...l, { id: r.client.id, nom: r.client.raisonSociale, type: r.client.type }].sort((a, b) => a.nom.localeCompare(b.nom)));
      setClientId(r.client.id);
      setNouveauClient(null);
      setErreur(null);
    });
  }

  function creerAppareil() {
    if (!nouvelApp) return;
    startTransition(async () => {
      const r = await creerAppareilRapide({ numeroInterne: nouvelApp.numero, marque: nouvelApp.marque, modele: nouvelApp.modele, typeAppareil: nouvelApp.type });
      if (!r.ok) return setErreur(r.erreur);
      setAppareils((l) => [{ id: r.appareil.id, numero: r.appareil.numeroInterne, marque: r.appareil.marque, modele: r.appareil.modele, type: nouvelApp.type || null, niveaux: null, clientIds: clientId ? [clientId] : [] }, ...l]);
      setAppSel((s) => [...s, r.appareil.id]);
      setNouvelApp(null);
      setErreur(null);
    });
  }

  function creerProjet() {
    for (let e = 0; e < 2; e++) {
      const err = valider(e);
      if (err) return aller(e);
    }
    setErreur(null);
    startTransition(async () => {
      const r = await creerProjetComplet({
        titre,
        typeProjet,
        description: description || undefined,
        dateDebutPrevue: dateDebut || undefined,
        dateFinPrevue: dateFin || undefined,
        adresse,
        instructionsAcces: acces || undefined,
        contactNom: contactNom || undefined,
        contactTelephone: contactTel || undefined,
        clientId,
        appareilIds: appSel,
        techniciens: equipe,
        envoyerOrdre,
        formuleId,
        prestations: lignesPresta.map(([catalogueId, quantite]) => ({ catalogueId, quantite })),
      });
      if (!r.ok) return setErreur(r.erreur);
      router.push(`/responsable/projets/${r.id}?tab=missions&cree=1`);
    });
  }

  const recap: [string, string][] = [
    ["Client", client?.nom ?? "—"],
    ["Appareils", appSel.length ? `${appSel.length} appareil(s)` : "—"],
    ["Équipe", equipe.length ? `${equipe.length} technicien(s)` : "—"],
    ["Garantie", formule ? formule.nom : "Aucune"],
    ["Prestations", lignesPresta.length ? `${lignesPresta.length} ligne(s) · ${euro(totalPresta)}` : "—"],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[13px] text-ink-soft">
            <Link href="/responsable/projets" className="hover:text-blue">Projets</Link> <span className="text-[#9aa4b1]">/</span>{" "}
            <span className="text-ink font-semibold">Nouveau projet</span>
          </div>
          <h1 className="text-[28px] font-extrabold font-display text-[#0b2545] mt-1">Nouveau projet</h1>
          <p className="text-sm text-ink-soft">Client, appareils, équipe, garantie et prestations : tout se règle ici. Tout reste modifiable ensuite.</p>
        </div>
      </div>

      <ol className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
        {ETAPES.map((label, i) => {
          const actif = i === etape;
          const fait = i < etape;
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => aller(i)}
                className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 border transition-all ${
                  actif ? "border-blue bg-white text-navy shadow-[0_0_0_3px_rgba(0,85,164,0.12)]" : fait ? "border-line bg-[#f0f7fd] text-ink-soft" : "border-line bg-white text-ink-soft hover:border-[#b9c6d6]"
                }`}
              >
                <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${actif ? "bg-blue text-white" : fait ? "bg-green-ink text-white" : "bg-[#eef2f6] text-ink-soft"}`}>
                  {fait ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </span>
                <span className="text-[13px] font-semibold truncate">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          {erreur && (
            <div role="alert" className="rounded-xl bg-red-fill text-red-ink px-4 py-3 text-sm font-medium">
              {erreur}
            </div>
          )}
          <section className="bg-white border border-line rounded-2xl p-7 shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col gap-5 min-h-[420px]">
            {etape === 0 && (
              <>
                <h2 className="font-display font-bold text-[19px]">Le projet</h2>
                <Champ label="Nom du projet *">
                  <input className={input} value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Ex. Résidence Les Tilleuls — modernisation" autoFocus />
                </Champ>
                <div className="flex flex-col gap-2">
                  <span className="text-[12.5px] font-semibold text-ink-soft">Type de projet</span>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {TYPES.map((t) => (
                      <button key={t.id} type="button" onClick={() => setTypeProjet(t.id)} className={carte(typeProjet === t.id)}>
                        <div className="font-bold text-[14.5px]">{t.label}</div>
                        <div className="text-xs text-ink-soft">{t.hint}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Champ label="Début prévu">
                    <input type="date" className={input} value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
                  </Champ>
                  <Champ label="Fin prévue">
                    <input type="date" className={input} value={dateFin} min={dateDebut || undefined} onChange={(e) => setDateFin(e.target.value)} />
                  </Champ>
                </div>
                <Champ label="Adresse d'intervention *">
                  <input className={input} value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="Rue, numéro, code postal, ville" />
                </Champ>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Champ label="Instructions d'accès">
                    <input className={input} value={acces} onChange={(e) => setAcces(e.target.value)} placeholder="Code, clé, badge…" />
                  </Champ>
                  <Champ label="Contact sur place">
                    <input className={input} value={contactNom} onChange={(e) => setContactNom(e.target.value)} placeholder="Nom" />
                  </Champ>
                  <Champ label="Téléphone du contact">
                    <input className={input} value={contactTel} onChange={(e) => setContactTel(e.target.value)} inputMode="tel" placeholder="+32 …" />
                  </Champ>
                </div>
                <Champ label="Description (facultatif)">
                  <textarea className={input} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
                </Champ>
              </>
            )}

            {etape === 1 && (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h2 className="font-display font-bold text-[19px]">Client</h2>
                  {!nouveauClient && (
                    <button type="button" onClick={() => setNouveauClient({ nom: rechClient, type: "copropriete" })} className="rounded-xl border border-dashed border-blue text-blue px-3.5 py-2 text-[13px] font-semibold hover:bg-[#f0f7fd]">
                      + Nouveau client
                    </button>
                  )}
                </div>
                {nouveauClient && (
                  <div className="rounded-xl border border-blue/40 bg-[#f7fbfe] p-4 flex flex-col gap-3">
                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_200px] gap-3">
                      <Champ label="Nom / raison sociale">
                        <input className={input} value={nouveauClient.nom} onChange={(e) => setNouveauClient({ ...nouveauClient, nom: e.target.value })} autoFocus />
                      </Champ>
                      <Champ label="Type">
                        <select className={input} value={nouveauClient.type} onChange={(e) => setNouveauClient({ ...nouveauClient, type: e.target.value })}>
                          {Object.entries(TYPE_CLIENT).map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                      </Champ>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" disabled={enCours} onClick={creerClient} className="rounded-xl bg-blue text-white px-4 py-2 text-sm font-bold disabled:opacity-60">
                        Créer et sélectionner
                      </button>
                      <button type="button" onClick={() => setNouveauClient(null)} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold">Annuler</button>
                    </div>
                  </div>
                )}
                <Recherche valeur={rechClient} onChange={setRechClient} placeholder="Tapez un nom de client…" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {clientsFiltres.map((c) => (
                    <button key={c.id} type="button" onClick={() => setClientId(c.id)} className={`${carte(clientId === c.id)} flex items-center gap-3`}>
                      <span className="w-10 h-10 shrink-0 rounded-xl bg-blue-pale text-blue flex items-center justify-center font-display font-bold">{c.nom.charAt(0).toUpperCase()}</span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-[14.5px] truncate">{c.nom}</span>
                        <span className="block text-xs text-ink-soft">{TYPE_CLIENT[c.type] ?? c.type}</span>
                      </span>
                      {clientId === c.id && <Check className="w-5 h-5 text-blue ml-auto shrink-0" />}
                    </button>
                  ))}
                  {clientsFiltres.length === 0 && <p className="text-sm text-ink-soft">Aucun client trouvé — créez-le avec « + Nouveau client ».</p>}
                </div>
              </>
            )}

            {etape === 2 && (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h2 className="font-display font-bold text-[19px]">Appareils</h2>
                  {!nouvelApp && (
                    <button type="button" onClick={() => setNouvelApp({ numero: "", marque: "", modele: "", type: "" })} className="rounded-xl border border-dashed border-blue text-blue px-3.5 py-2 text-[13px] font-semibold hover:bg-[#f0f7fd]">
                      + Ajouter un appareil
                    </button>
                  )}
                </div>
                <p className="text-sm text-ink-soft -mt-2">Les appareils déjà liés à {client?.nom ?? "ce client"} apparaissent en premier. Facultatif : vous pouvez en ajouter plus tard.</p>
                {nouvelApp && (
                  <div className="rounded-xl border border-blue/40 bg-[#f7fbfe] p-4 flex flex-col gap-3">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <Champ label="N° interne *">
                        <input className={input} value={nouvelApp.numero} onChange={(e) => setNouvelApp({ ...nouvelApp, numero: e.target.value })} placeholder="ASC-012" autoFocus />
                      </Champ>
                      <Champ label="Marque">
                        <input className={input} value={nouvelApp.marque} onChange={(e) => setNouvelApp({ ...nouvelApp, marque: e.target.value })} />
                      </Champ>
                      <Champ label="Modèle">
                        <input className={input} value={nouvelApp.modele} onChange={(e) => setNouvelApp({ ...nouvelApp, modele: e.target.value })} />
                      </Champ>
                      <Champ label="Type">
                        <input className={input} value={nouvelApp.type} onChange={(e) => setNouvelApp({ ...nouvelApp, type: e.target.value })} placeholder="Électrique, hydraulique…" />
                      </Champ>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" disabled={enCours} onClick={creerAppareil} className="rounded-xl bg-blue text-white px-4 py-2 text-sm font-bold disabled:opacity-60">
                        Créer et sélectionner
                      </button>
                      <button type="button" onClick={() => setNouvelApp(null)} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold">Annuler</button>
                    </div>
                  </div>
                )}
                <Recherche valeur={rechApp} onChange={setRechApp} placeholder="Numéro, marque, modèle…" />
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {appareilsTries.map((a) => {
                    const on = appSel.includes(a.id);
                    const lie = clientId && a.clientIds.includes(clientId);
                    return (
                      <button key={a.id} type="button" onClick={() => setAppSel((s) => (on ? s.filter((x) => x !== a.id) : [...s, a.id]))} className={carte(on)}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-display font-extrabold text-[15px]">{a.numero}</span>
                          <span className={`w-5 h-5 rounded-md flex items-center justify-center ${on ? "bg-blue text-white" : "border-[1.5px] border-[#cfd8e3]"}`}>{on && <Check className="w-3.5 h-3.5" />}</span>
                        </div>
                        <div className="text-[13px] mt-1">{[a.marque, a.modele].filter(Boolean).join(" ") || "—"}</div>
                        <div className="text-xs text-ink-soft">{[a.type, a.niveaux ? `${a.niveaux} niveaux` : null, lie ? "Déjà chez ce client" : null].filter(Boolean).join(" · ") || " "}</div>
                      </button>
                    );
                  })}
                  {appareilsTries.length === 0 && <p className="text-sm text-ink-soft">Aucun appareil trouvé.</p>}
                </div>
              </>
            )}

            {etape === 3 && (
              <>
                <h2 className="font-display font-bold text-[19px]">Équipe</h2>
                <div className="flex flex-col gap-2.5">
                  {donnees.techniciens.map((t) => {
                    const membre = equipe.find((e) => e.id === t.id);
                    const rh = STATUT_RH[t.statutRh] ?? STATUT_RH.actif;
                    return (
                      <div key={t.id} className={`flex items-center gap-3.5 rounded-xl px-4 py-3 flex-wrap ${membre ? "border-2 border-blue bg-[#f0f7fd]" : "border border-line bg-white"}`}>
                        <span className="w-10 h-10 shrink-0 rounded-full bg-navy text-white flex items-center justify-center text-[13px] font-bold">
                          {t.nom.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
                        </span>
                        <div className="flex-1 min-w-[180px]">
                          <div className="font-semibold text-[14.5px]">{t.nom}</div>
                          <div className="text-xs text-ink-soft">
                            {[t.poste, t.habilitations.length ? `Habilitations : ${t.habilitations.slice(0, 3).join(", ")}` : null, t.specialites].filter(Boolean).join(" · ") || "Technicien"}
                          </div>
                        </div>
                        <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${rh.ok ? "bg-green-fill text-green-ink" : "bg-orange-fill text-orange-ink"}`}>{rh.label}</span>
                        <span className="text-xs text-ink-soft w-28 text-right">{t.missionsEnCours} mission(s) en cours</span>
                        {membre && (
                          <select
                            aria-label="Rôle"
                            value={membre.role}
                            onChange={(e) => setEquipe((l) => l.map((x) => (x.id === t.id ? { ...x, role: e.target.value } : x)))}
                            className="rounded-lg border border-[#cfd8e3] bg-white px-2 py-1.5 text-[13px]"
                          >
                            <option value="">Technicien</option>
                            <option value="Chef de mission">Chef de mission</option>
                            <option value="Renfort">Renfort</option>
                          </select>
                        )}
                        <button
                          type="button"
                          onClick={() => setEquipe((l) => (membre ? l.filter((x) => x.id !== t.id) : [...l, { id: t.id, role: l.length === 0 ? "Chef de mission" : "" }]))}
                          className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold ${membre ? "border border-[#cfd8e3] bg-white" : "bg-blue text-white"}`}
                        >
                          {membre ? "Retirer" : "Ajouter"}
                        </button>
                      </div>
                    );
                  })}
                  {donnees.techniciens.length === 0 && <p className="text-sm text-ink-soft">Aucun technicien actif.</p>}
                </div>
                <label className="flex items-center gap-3 rounded-xl bg-bg px-4 py-3 text-sm">
                  <input type="checkbox" checked={envoyerOrdre} onChange={(e) => setEnvoyerOrdre(e.target.checked)} className="w-4 h-4" />
                  Envoyer l&apos;ordre de mission par email aux techniciens à la création
                </label>
              </>
            )}

            {etape === 4 && (
              <>
                <h2 className="font-display font-bold text-[19px]">Garantie</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  <button type="button" onClick={() => setFormuleId(null)} className={`${carte(formuleId === null)} flex flex-col gap-1`}>
                    <span className="font-display font-extrabold text-base">Aucune garantie</span>
                    <span className="text-[13px] text-ink-soft">Garantie légale uniquement — ajoutable plus tard.</span>
                  </button>
                  {donnees.formules.map((f) => (
                    <button key={f.id} type="button" onClick={() => setFormuleId(f.id)} className={`${carte(formuleId === f.id)} flex flex-col gap-1`}>
                      <span className="font-display font-extrabold text-base">{f.nom}</span>
                      <span className="text-[13px]">{f.dureeMois} mois · {f.visites} visite(s) incluse(s)</span>
                      {f.extension && <span className="text-xs text-ink-soft">Extension possible</span>}
                      <span className="text-lg font-bold text-navy mt-1">{euro(f.prix)}</span>
                    </button>
                  ))}
                </div>
                {formule && formule.visites > 0 && (
                  <p className="text-[13px] text-ink-soft">
                    Les {formule.visites} visites incluses seront planifiées automatiquement{appSel.length ? "" : " dès qu'un appareil sera ajouté au projet"}.
                  </p>
                )}
              </>
            )}

            {etape === 5 && (
              <>
                <h2 className="font-display font-bold text-[19px]">Prestations</h2>
                {donnees.catalogue.length === 0 ? (
                  <p className="text-sm text-ink-soft">Le catalogue est vide. <Link className="text-blue font-semibold" href="/responsable/prestations-catalogue">Ajouter des prestations au catalogue</Link></p>
                ) : (
                  <div className="rounded-xl border border-line overflow-hidden">
                    {donnees.catalogue.map((c) => {
                      const n = qte[c.id] ?? 0;
                      return (
                        <div key={c.id} className={`flex items-center gap-4 px-4 py-3 border-b border-[#eef2f6] last:border-0 ${n > 0 ? "bg-[#f7fbfe]" : ""}`}>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-[14.5px] truncate">{c.nom}</div>
                            <div className="text-xs text-ink-soft">{CAT[c.categorie] ?? c.categorie}</div>
                          </div>
                          <div className="text-[13px] text-ink-soft w-24 text-right tabular">{euro(c.prix)}</div>
                          <div className="flex items-center rounded-lg border border-[#cfd8e3] bg-white">
                            <button type="button" aria-label="Moins" onClick={() => setQte((q) => ({ ...q, [c.id]: Math.max(0, n - 1) }))} className="w-9 h-9 flex items-center justify-center"><Minus className="w-4 h-4" /></button>
                            <span className="w-8 text-center font-bold tabular">{n}</span>
                            <button type="button" aria-label="Plus" onClick={() => setQte((q) => ({ ...q, [c.id]: n + 1 }))} className="w-9 h-9 flex items-center justify-center"><Plus className="w-4 h-4" /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-ink-soft">Les ventes de pièces (avec sortie de stock) se font depuis la fiche du projet.</p>
              </>
            )}

            {etape === 6 && (
              <>
                <h2 className="font-display font-bold text-[19px]">Tout est prêt</h2>
                <p className="text-sm text-ink-soft">Vérifiez le récapitulatif. En cliquant sur « Créer le projet » :</p>
                <ul className="flex flex-col gap-2.5 text-[14.5px]">
                  <li className="flex gap-2.5"><Check className="w-5 h-5 text-green-ink shrink-0" /> la référence PRJ-{new Date().getFullYear()}-xxxx est générée</li>
                  {equipe.length > 0 && envoyerOrdre && <li className="flex gap-2.5"><Check className="w-5 h-5 text-green-ink shrink-0" /> {equipe.length} technicien(s) reçoivent leur ordre de mission par email</li>}
                  {formule && formule.visites > 0 && appSel.length > 0 && <li className="flex gap-2.5"><Check className="w-5 h-5 text-green-ink shrink-0" /> les {formule.visites} visites de garantie sont planifiées</li>}
                  <li className="flex gap-2.5"><Check className="w-5 h-5 text-green-ink shrink-0" /> vous arrivez sur la fiche du projet, onglet Missions</li>
                </ul>
              </>
            )}
          </section>

          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => aller(Math.max(0, etape - 1))} disabled={etape === 0} className="inline-flex items-center gap-1.5 rounded-xl border border-[#cfd8e3] bg-white px-5 py-3 text-sm font-semibold disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" /> Retour
            </button>
            <span className="text-[13px] text-ink-soft hidden md:block">Étape {etape + 1} sur {ETAPES.length}</span>
            {etape < ETAPES.length - 1 ? (
              <button type="button" onClick={() => aller(etape + 1)} className="inline-flex items-center gap-1.5 rounded-xl bg-blue hover:bg-blue-light text-white px-6 py-3 text-sm font-bold">
                Continuer <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button type="button" onClick={creerProjet} disabled={enCours} className="inline-flex items-center gap-2 rounded-xl bg-green-ink text-white px-6 py-3 text-sm font-bold disabled:opacity-60">
                <Check className="w-4 h-4" /> {enCours ? "Création…" : "Créer le projet"}
              </button>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-3.5 xl:sticky xl:top-24">
          <div className="rounded-2xl bg-navy text-white p-5 flex flex-col gap-1.5">
            <span className="text-[11px] tracking-[0.12em] font-semibold text-[#9fd3ee]">RÉCAPITULATIF</span>
            <span className="font-display text-lg font-extrabold leading-snug">{titre || "Projet sans nom"}</span>
            <span className="text-[13px] text-[#cfe3f5]">
              {TYPES.find((t) => t.id === typeProjet)?.label}
              {dateDebut ? ` · ${dateDebut.split("-").reverse().join("/")}` : ""}
              {dateFin ? ` → ${dateFin.split("-").reverse().join("/")}` : ""}
            </span>
          </div>
          <div className="rounded-2xl bg-white border border-line p-5 flex flex-col gap-3 text-[13.5px]">
            {recap.map(([k, v], i) => (
              <div key={k} className={`flex justify-between gap-3 ${i ? "pt-3 border-t border-[#eef2f6]" : ""}`}>
                <span className="text-ink-soft">{k}</span>
                <span className="font-semibold text-right">{v}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-blue-pale text-navy px-4 py-3 text-[12.5px] leading-relaxed">
            Seuls le nom, l&apos;adresse et le client sont obligatoires. Le reste peut être complété depuis la fiche du projet.
          </div>
        </aside>
      </div>
    </div>
  );
}
