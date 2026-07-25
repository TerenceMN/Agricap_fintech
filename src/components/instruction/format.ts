/**
 * Mise en forme de l'écran d'instruction — **adaptateur, pas implémentation**.
 *
 * ─── CE MODULE N'ÉCRIT AUCUN FORMATEUR QUI EXISTE DÉJÀ ───────────────────────
 *
 * Règle « le code validé se consomme, il ne se réécrit pas » : les formateurs du
 * module crédit vivent dans `@/components/analyse/analyseFormat` (score, écart,
 * horodatage, DSCR, taux, poids…), eux-mêmes adossés au formateur de montants
 * unique du projet (`@/components/guarantees/format::formatMontant`). Cet écran
 * les IMPORTE et leur donne des signatures typées : deux rendus d'un même écart
 * dans deux onglets voisins seraient un défaut visible par l'analyste.
 *
 * N'est AJOUTÉ ici que ce qui n'existait nulle part : entier nu et empreinte
 * abrégée. Les deux sont justifiés sur place.
 *
 * Ne figurent plus ici les adaptateurs devenus inutiles quand la restitution du
 * moteur (recommandation, critères, DSCR, échéancier) a été rendue aux
 * composants `analyse/` qui la servaient déjà : ils formatent eux-mêmes, avec
 * les mêmes fonctions.
 *
 * ─── DEUX FORMATEURS ÉCARTÉS, ET POURQUOI ────────────────────────────────────
 *
 * `@/lib/utils::formatCurrency` est inutilisable pour des montants d'instruction,
 * non par goût mais pour trois défauts vérifiables :
 *   1. `Number(amount) || 0` transforme une valeur ABSENTE en zéro — l'inverse
 *      exact de la règle §4.6 que cet écran doit tenir ;
 *   2. il rend l'USD à `maximumFractionDigits: 0` : sur des montants quantizés
 *      au centime, un écart de 0,004 s'afficherait « 0 $ » ;
 *   3. il formate l'USD en `en-US` là où le standard front impose fr-FR.
 * `formatMontant` (fr-FR, deux décimales, « — » sur l'absence) n'a aucun de ces
 * trois défauts et sert déjà dans une trentaine de fichiers.
 *
 * `@/lib/investorSpaceWire::formatPercent` produit exactement le rendu de
 * `analyseFormat::formatTaux` : deux noms pour un comportement, dans deux
 * domaines. On garde celui du module crédit, celui qu'utilise l'onglet Analyse
 * voisin. Attention en revanche à `rateToPercent` du même module : il multiplie
 * par 100 les taux exprimés en FRACTION, alors que le moteur crédit sert les
 * siens en POINTS (18 = 18 %/an) — l'appeler ici afficherait 1 800 %.
 */
import { formatMontant, NULL_DISPLAY } from '@/components/guarantees/format';
import {
  formatDateTimeFr as formatDateTimeFrBrut,
  formatEcartPct as formatEcartPctBrut,
  formatScore as formatScoreBrut,
} from '@/components/analyse/analyseFormat';

export { formatMontant, NULL_DISPLAY };

// ── Formateurs existants, re-typés à l'identique ─────────────────────────────
//
// Les signatures `unknown` ne sont pas cosmétiques : ces valeurs arrivent de
// blocs `details` typés `[k: string]: unknown` côté contrat. Sans ce typage,
// chaque appel exigerait un `as` — une affirmation non vérifiée sur une forme
// que rien ne garantit.

/** Score sur 100 — une décimale, comme le sert le moteur (`quantize(0.1)`). */
export const formatScore = (v: unknown): string => formatScoreBrut(v);

/** Écart relatif SIGNÉ — le signe porte le sens de l'écart. */
export const formatEcartPct = (v: unknown): string => formatEcartPctBrut(v);

/** Horodatage complet fr-FR — une analyse est datée, c'est une pièce probante. */
export const formatDateTimeFr = (v: unknown): string => formatDateTimeFrBrut(v);

// ── Ajouts : rien de tout cela n'existait ────────────────────────────────────

/** `true` si la valeur est un nombre exploitable — `null`, `''` et `NaN` ne le sont pas. */
export function estNombre(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Entier nu — nombre de postes, effectif de dossiers, révision, version.
 * Aucun formateur du projet ne rendait un entier SANS unité ni symbole : les
 * existants ajoutent tous « % », une devise ou une décimale.
 */
export function formatEntier(value: unknown): string {
  if (!estNombre(value)) return NULL_DISPLAY;
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
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
