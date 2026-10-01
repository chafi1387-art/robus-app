// Phase 17 : affichage immédiat au clic (squelette) pendant le chargement des
// données — l'écran réagit tout de suite au lieu de rester figé.
export default function Chargement() {
  return (
    <div className="flex flex-col gap-4 animate-pulse" aria-busy="true" aria-label="Chargement">
      <div className="h-24 rounded-2xl bg-[#e3e9f0]" />
      <div className="h-10 rounded-xl bg-[#e9eef4]" />
      <div className="h-32 rounded-2xl bg-[#eef2f6]" />
      <div className="h-32 rounded-2xl bg-[#eef2f6]" />
    </div>
  );
}
