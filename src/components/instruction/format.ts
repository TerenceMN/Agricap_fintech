/**
 * Mise en forme de l'écran d'instruction DG.
 *
 * AUCUNE fonction de ce module ne calcule un chiffre métier (CLAUDE.md §5,
 * « zéro chiffre métier calculé côté client ») : elles habillent des valeurs que
 * le moteur a déjà arrêtées en `Decimal` côté serveur. Pas de multiplication, pas
 * de division, pas de somme — l'anti-modèle du projet est un simulateur qui
 * multipliait un taux par 12 dans le navigateur pour alimenter le moteur.
 *
 * Le formateur de MONTANT n'est pas réécrit ici : c'est celui du module
 * garanties, formateur unique du projet (principe 6 — une seule nomenclature par
 * concept, y compris pour écrire une somme d'argent).
 *
 * Règle §4.6 tenue partout : une valeur absente s'affiche « — », jamais « 0 ».
 * Un zéro affiché est un zéro que le serveur a dit.
 */
import { formatMontant, NULL_DISPLAY } from '@/components/guarantees/format';

export { formatMontant, NULL_DISPLAY };

/** `true` si la valeur est un nombre exploitable — `null`, `''` et `NaN` ne le sont pas. */
export function estNombre(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Nombre fr-FR à décimales fixes, ou « — ».
 *
 * Volontairement PRIVÉ : chaque grandeur du moteur a sa propre précision
 * (score au dixième, ratio au millième, montant au centime) et l'exposer nu
 * inviterait à choisir la précision à l'affichage, donc à masquer une décimale
 * porteuse d'information (0,999 n'est pas 1,00 devant un seuil DSCR).
 */
function nombreFr(value: unknown, min: number, max: number): string {
  if (value === null || value === undefined || value === '') return NULL_DISPLAY;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return NULL_DISPLAY;
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(n);
}

/** Score sur 100 — une décimale, comme le sert le moteur (`quantize(0.1)`). */
export function formatScore(value: unknown): string {
  return nombreFr(value, 1, 1);
}

/** Points d'un critère (`score × poids / 100`), arrêtés par le serveur. */
export function formatPoints(value: unknown): string {
  return nombreFr(value, 1, 1);
}

/** Poids d'un critère, en pourcentage. */
export function formatPoids(value: unknown): string {
  const n = nombreFr(value, 0, 1);
  return n === NULL_DISPLAY ? n : `${n} %`;
}

/**
 * DSCR — ratio au millième côté serveur (`quantize(0.001)`, principe 4).
 * On garde la 3e décimale : elle porte l'information près du plancher de 1,0.
 */
export function formatDscr(value: unknown): string {
  return nombreFr(value, 2, 3);
}

/** Écart relatif SIGNÉ, en pourcentage — le signe porte le sens de l'écart. */
export function formatEcartPct(value: unknown): string {
  if (!estNombre(value)) return NULL_DISPLAY;
  const signe = value > 0 ? '+' : '';
  return `${signe}${nombreFr(value, 1, 1)} %`;
}

/** Pourcentage non signé (choc de stress, part). */
export function formatPourcent(value: unknown): string {
  const n = nombreFr(value, 0, 2);
  return n === NULL_DISPLAY ? n : `${n} %`;
}

/** Taux annuel nominal, en points de taux. */
export function formatTaux(value: unknown): string {
  const n = nombreFr(value, 2, 2);
  return n === NULL_DISPLAY ? n : `${n} %`;
}

/** Durée en mois — « 8 mois », « 1 mois », « — » si le serveur n'a rien dit. */
export function formatMois(value: unknown): string {
  if (!estNombre(value)) return NULL_DISPLAY;
  const n = nombreFr(value, 0, 0);
  return `${n} ${Math.abs(value) > 1 ? 'mois' : 'mois'}`;
}

/** Entier nu (nombre d'échéances, effectif de dossiers). */
export function formatEntier(value: unknown): string {
  return nombreFr(value, 0, 0);
}

/** Horodatage complet fr-FR — une analyse est datée, c'est une pièce probante. */
export function formatDateTimeFr(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return NULL_DISPLAY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NULL_DISPLAY;
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Libellé lisible d'un code d'indicateur (`cout_module:semences` → « semences »).
 * Purement cosmétique : le code canonique reste affiché à côté et c'est LUI qui
 * repart au serveur (principe 6).
 */
export function libelleIndicateur(code: unknown): string {
  if (typeof code !== 'string' || !code) return NULL_DISPLAY;
  const sep = code.indexOf(':');
  return sep === -1 ? code : code.slice(sep + 1);
}

/** SHA-256 abrégé pour l'affichage — la comparaison entre révisions reste serveur. */
export function abregerSha(sha: unknown): string {
  if (typeof sha !== 'string' || !sha) return NULL_DISPLAY;
  return sha.length <= 16 ? sha : `${sha.slice(0, 12)}…${sha.slice(-4)}`;
}
