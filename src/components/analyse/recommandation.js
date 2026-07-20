/**
 * Barème de décision à 4 niveaux (SPEC Moteur §2 / §4, `CreditRecommandation`).
 *
 * Ce module ne décide rien : il traduit un code serveur en libellé et en
 * couleur. Les seuils qui produisent ce code (score, DSCR, hors-plage) vivent
 * en base côté backend (principe 8) — aucun n'est reproduit ici.
 *
 * Un code inconnu n'est jamais deviné ni rattaché au niveau le plus proche :
 * il s'affiche tel quel, en neutre.
 */

export const RECOMMANDATION_CONFIG = {
  approbation: {
    label: 'Approbation recommandée',
    banner: 'bg-emerald-500/10 border-emerald-500/40',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
  },
  approbation_cond: {
    label: 'Approbation sous conditions',
    banner: 'bg-orange-500/10 border-orange-500/40',
    text: 'text-orange-300',
    dot: 'bg-orange-400',
  },
  revue: {
    label: 'Revue approfondie requise',
    banner: 'bg-yellow-500/10 border-yellow-500/40',
    text: 'text-yellow-300',
    dot: 'bg-yellow-400',
  },
  refus: {
    label: 'Refus recommandé',
    banner: 'bg-red-500/10 border-red-500/40',
    text: 'text-red-300',
    dot: 'bg-red-400',
  },
};

const INCONNU = {
  banner: 'bg-slate-500/10 border-slate-500/40',
  text: 'text-slate-300',
  dot: 'bg-slate-400',
};

/**
 * @param {string|null|undefined} code code renvoyé par le moteur
 * @returns {{label: string, banner: string, text: string, dot: string, known: boolean}}
 */
export function recommandationConfig(code) {
  const cfg = code ? RECOMMANDATION_CONFIG[code] : undefined;
  if (cfg) return { ...cfg, known: true };
  return {
    ...INCONNU,
    label: code ? `Recommandation non reconnue (${code})` : 'Recommandation absente',
    known: false,
  };
}
