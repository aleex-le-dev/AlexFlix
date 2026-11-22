/**
 * Verrou du défilement de la page, partagé entre la fiche et le lecteur.
 * Compteur : la page redevient défilable quand le dernier verrou est relâché,
 * quel que soit l'ordre d'ouverture et de fermeture (fiche qui se ferme pendant que le lecteur s'ouvre).
 */
let locks = 0;

export function lockScroll(): () => void {
  locks++;
  document.body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0) document.body.style.overflow = '';
  };
}
