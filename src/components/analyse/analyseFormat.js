/**
 * Mise en forme des sorties du moteur d'analyse (onglet Analyse, staff).
 *
 * Aucune de ces fonctions ne calcule un chiffre métier : elles habillent des
 * valeurs que le serveur a déjà arrêtées (CLAUDE.md §5, « zéro chiffre métier
 * calculé côté client »). Les montants passent par le formateur unique du
 * module garanties — on ne recrée pas un second formateur de devise.
 */
import { formatMontant, formatDateFr, NULL_DISPLAY } from '@/components/guarantees/format';

export { formatMontant, formatDateFr, NULL_DISPLAY };

/** Nombre fr-FR à décimales fixes, ou « — » si la valeur n'est pas exploitable. */
function nombre(value, min, max) {
  if (value === null || value === undefined || value === '') return NULL_DISPLAY;
  const n = Number(value);
  if (!Number.isFinite(n)) return NULL_DISPLAY;
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(n);
}

/** Score d'un critère sur 100 — 1 décimale, comme le renvoie le moteur. */
export function formatScore(value) {
  return nombre(value, 1, 1);
}

/** Points obtenus (score × poids / 100) — arrêtés par le serveur. */
export function formatPoints(value) {
  return nombre(value, 1, 1);
}

/** Poids d'un critère, en pourcentage entier. */
export function formatPoids(value) {
  const n = nombre(value, 0, 1);
  return n === NULL_DISPLAY ? n : `${n} %`;
}

/**
 * DSCR — ratio à 3 décimales côté serveur (`quantize(0.001)`, principe 4).
 * On n'arrondit pas à 2 décimales : la 3e est porteuse d'information près des
 * seuils (0,999 n'est pas 1,00).
 */
export function formatDscr(value) {
  return nombre(value, 2, 3);
}

/** Écart relatif signé, en pourcentage — le signe porte le sens de l'écart. */
export function formatEcartPct(value) {
  if (value === null || value === undefined || value === '') return NULL_DISPLAY;
  const n = Number(value);
  if (!Number.isFinite(n)) return NULL_DISPLAY;
  const signe = n > 0 ? '+' : '';
  return `${signe}${nombre(n, 1, 1)} %`;
}

/** Taux annuel nominal tel que paramétré sur l'analyse. */
export function formatTaux(value) {
  const n = nombre(value, 2, 2);
  return n === NULL_DISPLAY ? n : `${n} %`;
}

/** Horodatage complet fr-FR — une analyse est datée, c'est une pièce probante. */
export function formatDateTimeFr(iso) {
  if (!iso) return NULL_DISPLAY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NULL_DISPLAY;
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Libellé lisible d'un code d'indicateur (`cout_module:semences` → « semences »).
 * Purement cosmétique : le code canonique reste affiché à côté, c'est lui qui
 * est envoyé au serveur (principe 6 — une seule nomenclature).
 */
export function libelleIndicateur(code) {
  if (!code) return NULL_DISPLAY;
  const sep = String(code).indexOf(':');
  return sep === -1 ? String(code) : String(code).slice(sep + 1);
}
