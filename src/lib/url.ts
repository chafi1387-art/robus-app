/** Ajoute ?erreur=… ou ?ok=… à une URL interne (en gardant ses paramètres et son ancre). */
export function avecMessage(url: string, cle: "erreur" | "ok", message: string) {
  const [sansAncre, ancre] = url.split("#");
  const sep = sansAncre.includes("?") ? "&" : "?";
  return `${sansAncre}${sep}${cle}=${encodeURIComponent(message)}${ancre ? `#${ancre}` : ""}`;
}
