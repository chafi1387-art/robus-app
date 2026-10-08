import Link from "next/link";

// Phase 27 : kit visuel commun aux tableaux de bord (Parc, Planning, puis
// Projets) — mêmes compteurs, mêmes en-têtes de section, même pastille
// « EN COURS », même sélecteur de vue, même légende.

export type TonCompteur = "rouge-plein" | "rouge" | "orange" | "bleu" | "vert" | "neutre";

const TON: Record<TonCompteur, { carte: string; titre: string; valeur: string; sous: string }> = {
  "rouge-plein": { carte: "bg-red border-red", titre: "text-white/90", valeur: "text-white", sous: "text-white/90" },
  rouge: { carte: "bg-surface border-[#E7A39B] border-[1.5px]", titre: "text-red-ink", valeur: "text-red-ink", sous: "text-ink-soft" },
  orange: { carte: "bg-surface border-[#F0C9A5]", titre: "text-orange-ink", valeur: "text-orange-ink", sous: "text-ink-soft" },
  bleu: { carte: "bg-surface border-line", titre: "text-ink-soft", valeur: "text-blue", sous: "text-ink-soft" },
  vert: { carte: "bg-surface border-[#C9E8D4]", titre: "text-ink-soft", valeur: "text-green-ink", sous: "text-ink-soft" },
  neutre: { carte: "bg-surface border-line", titre: "text-ink-soft", valeur: "text-navy", sous: "text-ink-soft" },
};

export function Compteur({
  titre,
  valeur,
  sous,
  ton = "neutre",
  href,
  actif = false,
  point = false,
}: {
  titre: string;
  valeur: number | string;
  sous?: string;
  ton?: TonCompteur;
  href?: string;
  actif?: boolean;
  point?: boolean;
}) {
  const t = TON[ton];
  const contenu = (
    <>
      <span className={`text-xs font-semibold ${t.titre}`}>
        {point ? "● " : ""}
        {titre}
      </span>
      <span className={`font-display font-extrabold text-[30px] sm:text-[34px] leading-none ${t.valeur}`}>{valeur}</span>
      {sous && <span className={`text-xs ${t.sous}`}>{sous}</span>}
    </>
  );
  const classe = `rounded-2xl border p-3 sm:p-4 flex flex-col gap-1.5 min-w-0 ${t.carte} ${actif ? "ring-2 ring-navy ring-offset-2" : ""}`;
  return href ? (
    <Link href={href} aria-pressed={actif} className={`${classe} transition-shadow hover:shadow-md`}>
      {contenu}
    </Link>
  ) : (
    <div className={classe}>{contenu}</div>
  );
}

export function Section({
  titre,
  droite,
  children,
  id,
  className = "",
}: {
  titre: React.ReactNode;
  droite?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={`bg-surface border border-line rounded-2xl overflow-hidden scroll-mt-24 ${className}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 sm:px-5 py-3.5 border-b border-line">
        <h2 className="font-display font-extrabold text-[17px] text-navy">{titre}</h2>
        {droite}
      </div>
      {children}
    </section>
  );
}

/** Pastille « ● EN COURS » (rouge, point blanc) — partout la même. */
export function BadgeEnCours({ texte = "EN COURS", petit = false }: { texte?: string; petit?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-extrabold text-white bg-red rounded-full whitespace-nowrap ${petit ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1"}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
      {texte}
    </span>
  );
}

/** Sélecteur de vue segmenté (Jour / Semaine / Mois / Par projet…). */
export function SelecteurVue({ options, actif, label = "Vue" }: { options: { cle: string; label: string; href: string }[]; actif: string; label?: string }) {
  return (
    <div role="group" aria-label={label} className="flex bg-surface border border-line rounded-[10px] p-[3px] w-full sm:w-auto">
      {options.map((o) =>
        o.cle === actif ? (
          <span key={o.cle} aria-current="page" className="flex-1 sm:flex-none text-center px-3.5 py-[7px] rounded-lg text-[13px] font-bold bg-navy text-white whitespace-nowrap">
            {o.label}
          </span>
        ) : (
          <Link key={o.cle} href={o.href} className="flex-1 sm:flex-none text-center px-3.5 py-[7px] rounded-lg text-[13px] font-semibold text-ink-soft hover:text-navy hover:bg-blue-pale whitespace-nowrap">
            {o.label}
          </Link>
        )
      )}
    </div>
  );
}

export function Legende({ items }: { items: { classe: string; texte: string }[] }) {
  return (
    <div className="flex gap-x-4 gap-y-1.5 flex-wrap text-xs text-ink-soft">
      {items.map((i) => (
        <span key={i.texte} className="flex items-center gap-1.5">
          <span className={`w-3 h-3 rounded ${i.classe}`} aria-hidden="true" />
          {i.texte}
        </span>
      ))}
    </div>
  );
}

/** Puce de filtre (lien) — même style que le parc. */
export function PuceFiltre({ href, actif, children, ton = "neutre" }: { href: string; actif: boolean; children: React.ReactNode; ton?: "neutre" | "rouge" }) {
  return (
    <Link
      href={href}
      aria-pressed={actif}
      className={`h-[34px] inline-flex items-center px-3 rounded-full text-[13px] font-semibold whitespace-nowrap ${
        actif ? "bg-navy text-white" : `bg-surface border border-line hover:bg-blue-pale ${ton === "rouge" ? "text-red-ink" : "text-ink"}`
      }`}
    >
      {children}
    </Link>
  );
}
