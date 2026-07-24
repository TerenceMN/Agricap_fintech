/**
 * Mise en forme de l'écran d'instruction — **adaptateur, pas implémentation**.
 *
 * ─── CE MODULE N'ÉCRIT AUCUN FORMATEUR QUI EXISTE DÉJÀ ───────────────────────
 *
 * Principe 6, règle « le code validé se consomme, il ne se réécrit pas » : les
 * formateurs du module crédit vivent dans `@/components/analyse/analyseFormat`
 * (score, points, poids, DSCR, écart, taux, horodatage, libellé d'indicateur),
 * eux-mêmes adossés au formateur de montants unique du projet
 * (`@/components/guarantees/format::formatMontant`). Cet écran les IMPORTE et se
 * contente de leur donner des signatures typées : deux rendus d'un même DSCR
 * dans deux onglets voisins seraient un défaut visible par l'analyste.
 *
 * N'est AJOUTÉ ici que ce qui n'existait pas : entier nu, durée en mois,
 * empreinte abrégée, garde de type. Chaque ajout est justifié sur place.
 *
 * ─── DEUX FORMATEURS ÉCARTÉS, ET POURQUOI ────────────────────────────────────
 *
 * `@/lib/utils::formatCurrency` est inutilisable pour un échéancier, non par
 * goût mais pour trois défauts vérifiables :
 *   1. `Number(amount) || 0` transforme une valeur ABSENTE en zéro — l'inverse
 *      exact de la règle §4.6 que cet écran doit tenir ;
 *   2. il rend l'USD à `maximumFractionDigits: 0` : sur un échéancier quantizé
 *      au centime, un capital restant dû de 0,004 s'afficherait « 0 $ » et
 *      passerait pour l'invariant respecté ;
 *   3. il formate l'USD en `en-US` là où le standard front impose fr-FR.
 * `formatMontant` (fr-FR, deux décimales, « — » sur l'absence) n'a aucun de ces
 * trois défauts et sert déjà dans une trentaine de fichiers.
 *
 * `@/lib/investorSpaceWire::formatPercent` produit exactement le même rendu que
 * `analyseFormat.formatTaux` (deux décimales, virgule, symbole) : ce sont deux
 * noms pour un seul comportement, dans deux domaines. On garde celui du module
 * crédit, celui que l'onglet Analyse voisin utilise déjà. Les unifier est un
 * chantier transverse, pas un effet de bord de cet écran — et sans divergence
 * visible en attendant. Attention en revanche à `rateToPercent` du même module :
 * il multiplie par 100 les taux exprimés en FRACTION, alors que le moteur crédit
 * sert ses taux en POINTS (18 = 18 %/an) ; l'appeler ici donnerait 1 800 %.
 */
import { formatMontant, NULL_DISPLAY } from '@/components/guarantees/format';
import {
  formatDateTimeFr as formatDateTimeFrBrut,
  formatDscr as formatDscrBrut,
  formatEcartPct as formatEcartPctBrut,
  formatPoids as formatPoidsBrut,
  formatPoints as formatPointsBrut,
  formatScore as formatScoreBrut,
  formatTaux as formatTauxBrut,
  libelleIndicateur as libelleIndicateurBrut,
} from '@/components/analyse/analyseFormat';

export { formatMontant, NULL_DISPLAY };

// ── Formateurs existants, re-typés à l'identique ─────────────────────────────
//
// Les signatures `unknown` ne sont pas cosmétiques : ces valeurs arrivent de
// blocs `details` typés `[k: string]: unknown` côté contrat. Sans ce typage,
// chaque appel exigerait un `as` — c'est-à-dire une affirmation non vérifiée sur
// une forme que rien ne garantit.

/** Score sur 100 — une décimale, comme le sert le moteur (`quantize(0.1)`). */
export const formatScore = (v: unknown): string => formatScoreBrut(v);

/** Points d'un critère (`score × poids / 100`), arrêtés par le serveur. */
export const formatPoints = (v: unknown): string => formatPointsBrut(v);

/** Poids d'un critère, en pourcentage. */
export const formatPoids = (v: unknown): string => formatPoidsBrut(v);

/** DSCR — ratio au millième : la 3e décimale porte l'information près du plancher de 1,0. */
export const formatDscr = (v: unknown): string => formatDscrBrut(v);

/** Écart relatif SIGNÉ — le signe porte le sens de l'écart. */
export const formatEcartPct = (v: unknown): string => formatEcartPctBrut(v);

/** Taux annuel nominal, en points de taux. */
export const formatTaux = (v: unknown): string => formatTauxBrut(v);

/** Horodatage complet fr-FR — une analyse est datée, c'est une pièce probante. */
export const formatDateTimeFr = (v: unknown): string => formatDateTimeFrBrut(v);

/** `cout_module:semences` → « semences ». Le code canonique reste affiché à côté. */
export const libelleIndicateur = (v: unknown): string => libelleIndicateurBrut(v);

/**
 * Pourcentage non signé (amplitude d'un choc de stress).
 *
 * Même rendu qu'un poids — c'est volontaire : on ne crée pas un SECOND rendu de
 * pourcentage, seulement un nom qui dit ce que la valeur mesure au point d'appel.
 * Un « choc » affiché par une fonction nommée `formatPoids` se relit mal.
 */
export const formatPourcent = (v: unknown): string => formatPoidsBrut(v);

// ── Ajouts : rien de tout cela n'existait ────────────────────────────────────

/** `true` si la valeur est un nombre exploitable — `null`, `''` et `NaN` ne le sont pas. */
export function estNombre(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Entier nu — numéro de mois, nombre d'échéances, effectif de dossiers, révision.
 * Aucun formateur du projet ne rendait un entier SANS unité ni symbole : les
 * existants ajoutent tous « % », une devise ou une décimale.
 */
export function formatEntier(value: unknown): string {
  if (!estNombre(value)) return NULL_DISPLAY;
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

/** Durée en mois — la grandeur la plus manipulée de cet écran, sans équivalent existant. */
export function formatMois(value: unknown): string {
  if (!estNombre(value)) return NULL_DISPLAY;
  return `${formatEntier(value)} mois`;
}

/**
 * SHA-256 abrégé. La comparaison entre révisions reste serveur : cette forme
 * courte sert à RECONNAÎTRE une empreinte d'un coup d'œil, pas à en juger
 * l'égalité — d'où le début ET la fin conservés.
 */
export function abregerSha(sha: unknown): string {
  if (typeof sha !== 'string' || !sha) return NULL_DISPLAY;
  return sha.length <= 16 ? sha : `${sha.slice(0, 12)}…${sha.slice(-4)}`;
}
