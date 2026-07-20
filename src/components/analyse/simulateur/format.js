/**
 * Mise en forme des sorties du moteur d'analyse (vue analyste).
 *
 * Règle du module : ce fichier NE CALCULE AUCUN chiffre métier. Les montants
 * réutilisent le formateur unique déjà en place (`components/guarantees/format.js`)
 * plutôt que d'en créer un second ; on n'ajoute ici que ce qui lui manque pour
 * l'analyse (ratios bruts type DSCR, horodatage, écart entre deux analyses).
 *
 * Seule exception assumée : `ecartEntre()` fait une soustraction entre DEUX
 * valeurs déjà arrêtées par le serveur, pour afficher une variation. Ce n'est pas
 * un recalcul de DSCR — la variation n'existe que dans l'affichage et disparaît
 * dès qu'on ne compare plus.
 */

import { formatMontant, formatDateFr, NULL_DISPLAY } from '@/components/guarantees/format';

export { formatMontant, formatDateFr, NULL_DISPLAY };

/**
 * Ratio brut servi par le moteur (DSCR, DSCR stressé) — affiché tel quel,
 * sans conversion en pourcentage ni arrondi métier.
 * @param {number|null|undefined} value
 * @param {number} [decimals=2]
 * @returns {string}
 */
export function formatRatio2(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return NULL_DISPLAY;
  const n = Number(value);
  if (!Number.isFinite(n)) return NULL_DISPLAY;
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/**
 * Pourcentage servi par le serveur (taux annuel, score global).
 * @param {number|null|undefined} value
 * @param {number} [decimals=2]
 * @returns {string}
 */
export function formatPourcent(value, decimals = 2) {
  const s = formatRatio2(value, decimals);
  return s === NULL_DISPLAY ? s : `${s} %`;
}

/**
 * Horodatage complet — une analyse est un acte daté, la date seule ne suffit pas
 * à distinguer deux essais du même jour.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function formatDateHeureFr(iso) {
  if (!iso) return NULL_DISPLAY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NULL_DISPLAY;
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Écart entre deux valeurs servies par le serveur, pour l'affichage « avant /
 * après ». Retourne `null` si l'une des deux manque : on n'invente pas un delta
 * contre une valeur absente.
 *
 * @param {number|null|undefined} apres
 * @param {number|null|undefined} avant
 * @param {number} [decimals=2]
 * @returns {{delta: number, texte: string, sens: 'hausse'|'baisse'|'stable'}|null}
 */
export function ecartEntre(apres, avant, decimals = 2) {
  if (apres === null || apres === undefined || avant === null || avant === undefined) return null;
  const a = Number(apres);
  const b = Number(avant);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const delta = a - b;
  const abs = formatRatio2(Math.abs(delta), decimals);
  // Le seuil ci-dessous est un seuil d'AFFICHAGE (en deçà, l'écart n'est pas
  // visible au nombre de décimales montré) — ce n'est pas un seuil métier.
  const invisible = Math.abs(delta) < 0.5 / 10 ** decimals;
  if (invisible) return { delta, texte: '=', sens: 'stable' };
  return {
    delta,
    texte: `${delta > 0 ? '+' : '−'}${abs}`,
    sens: delta > 0 ? 'hausse' : 'baisse',
  };
}

/* ── Barème de recommandation — source unique ────────────────────────────────
 *
 * Ces deux tables étaient définies ici ET dans `../recommandation.js`, avec des
 * valeurs DIVERGENTES : `approbation_cond` en lime d'un côté, orange de l'autre,
 * et « Revue manuelle » vs « Revue approfondie requise ».
 *
 * Sur un bandeau de décision de crédit, le lime se lit comme un feu vert — deux
 * analystes regardant le même dossier depuis deux écrans n'y auraient pas vu la
 * même urgence. Écart de sens, pas de nuance (principe 6).
 *
 * `recommandation.js` fait foi ; ce module se contente d'en dériver les formes
 * dont le simulateur a besoin.
 */
import { RECOMMANDATION_CONFIG } from '../recommandation';

export const RECOMMANDATION_LABEL = Object.fromEntries(
  Object.entries(RECOMMANDATION_CONFIG).map(([code, cfg]) => [code, cfg.label]),
);

export const RECOMMANDATION_CLASS = Object.fromEntries(
  Object.entries(RECOMMANDATION_CONFIG).map(([code, cfg]) => [
    code, `${cfg.text} ${cfg.banner}`,
  ]),
);

/** Libellés des modes de différé (SPEC annexe A.1). */
export const MODE_DIFFERE_LABEL = {
  interets_seuls: 'Intérêts seuls',
  franchise_totale: 'Franchise totale',
};

/** Ce que chaque mode fait réellement pendant le différé — annexe A.1. */
export const MODE_DIFFERE_AIDE = {
  interets_seuls:
    "Pendant le différé, seuls les intérêts sont payés : le capital restant dû ne bouge pas. "
    + "Mode standard AGRICAP.",
  franchise_totale:
    "Pendant le différé, rien n'est payé : les intérêts sont capitalisés et le capital restant dû "
    + "augmente chaque mois. À ne proposer que si les flux de trésorerie sont nuls avant récolte.",
};
