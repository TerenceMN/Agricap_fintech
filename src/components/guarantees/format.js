/**
 * Formateur unique des montants, ratios et dates du module garanties/actifs.
 *
 * CLAUDE.md, standards frontend : « les montants s'affichent via un formateur
 * unique (devise, séparateurs fr-FR) ». Aucune de ces fonctions ne calcule un
 * chiffre métier — elles mettent en forme ce que l'API a déjà arrêté.
 */

const NULL_DISPLAY = '—';

/**
 * Met en forme un montant avec sa devise, séparateurs fr-FR.
 * @param {number|string|null|undefined} value montant retourné par l'API
 * @param {string} [currency='USD'] devise portée par la donnée (jamais devinée)
 * @param {{decimals?: number}} [options]
 * @returns {string}
 */
export function formatMontant(value, currency = 'USD', options = {}) {
  const { decimals = 2 } = options;
  if (value === null || value === undefined || value === '') return NULL_DISPLAY;
  const n = Number(value);
  if (!Number.isFinite(n)) return NULL_DISPLAY;
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
  return currency ? `${formatted} ${currency}` : formatted;
}

/**
 * Ratio de couverture tel que le backend le renvoie : un multiple, pas un
 * pourcentage recalculé côté client.
 * @param {number|null|undefined} ratio
 * @returns {string}
 */
export function formatRatio(ratio) {
  if (ratio === null || ratio === undefined) return NULL_DISPLAY;
  const n = Number(ratio);
  if (!Number.isFinite(n)) return NULL_DISPLAY;
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)} ×`;
}

/**
 * Date courte fr-FR à partir d'un ISO 8601.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function formatDateFr(iso) {
  if (!iso) return NULL_DISPLAY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NULL_DISPLAY;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export { NULL_DISPLAY };
