// Phase 17 : affichage immédiat au clic (squelette) pendant le chargement des
// données — le menu reste utilisable, la page arrive dès qu'elle est prête.
export default function Chargement() {
  return (
    <div className="flex flex-col gap-4 animate-pulse" aria-busy="true" aria-label="Chargement">
      <div className="h-28 rounded-2xl bg-[#dde6ef]" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="h-20 rounded-2xl bg-[#e9eef4]" />
        <div className="h-20 rounded-2xl bg-[#e9eef4]" />
        <div className="h-20 rounded-2xl bg-[#e9eef4]" />
        <div className="h-20 rounded-2xl bg-[#e9eef4]" />
      </div>
      <div className="h-64 rounded-2xl bg-[#eef2f6]" />
    </div>
  );
}
