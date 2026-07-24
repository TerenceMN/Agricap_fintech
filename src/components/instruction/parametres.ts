/**
 * Paramètres d'instruction saisis par la direction : durée, différé (et son
 * mode), taux annuel.
 *
 * ─── AUCUNE RÈGLE MÉTIER ICI ─────────────────────────────────────────────────
 *
 * Ce module ne fait que deux choses, et refuse d'en faire une troisième :
 *
 *   1. LIRE la saisie (chaînes d'un formulaire) et la convertir en corps de
 *      requête. C'est de l'analyse syntaxique, pas du métier.
 *   2. DIRE si la saisie affichée diffère encore des paramètres de l'analyse
 *      affichée en dessous — pour que l'écran n'accole jamais un échéancier à
 *      des paramètres qui ne l'ont pas produit.
 *
 * Ce qu'il NE fait PAS : vérifier qu'un différé est inférieur à la durée, qu'un
 * taux est plausible, qu'une durée tient dans le cycle de la filière. Ces règles
 * vivent dans `credits/echeancier.py` et se recalibrent en base (principe 8) ;
 * les recopier ici créerait un second jeu de bornes dans le navigateur, qui
 * dériverait du premier sans que rien ne le signale. Le serveur tranche et
 * répond 422 `PARAMETRES_INVALIDES`, l'écran déplie ses `{code, message}`.
 */
import type { CreditAnalyse } from '@/types/api';

export type ModeDiffere = 'interets_seuls' | 'franchise_totale';

/** Les deux modes que `credits/echeancier.py::MODES` connaît. Aucun autre. */
export const MODES_DIFFERE: ReadonlyArray<{ value: ModeDiffere; label: string; aide: string }> = [
  {
    value: 'interets_seuls',
    label: 'Intérêts seuls',
    aide: 'Pendant le différé, le client paie les intérêts ; le capital ne s’amortit pas encore.',
  },
  {
    value: 'franchise_totale',
    label: 'Franchise totale',
    aide: 'Pendant le différé, rien n’est payé : les intérêts sont capitalisés et grossissent le capital dû.',
  },
];

export interface SaisieParametres {
  dureeMois: string;
  differeMois: string;
  tauxAnnuel: string;
  modeDiffere: ModeDiffere;
}

export const SAISIE_VIDE: SaisieParametres = {
  dureeMois: '',
  differeMois: '',
  tauxAnnuel: '',
  modeDiffere: 'interets_seuls',
};

export interface ErreurSaisie {
  code: string;
  message: string;
}

export interface PayloadReanalyse {
  duree_mois: number;
  differe_mois?: number;
  taux_annuel?: number;
  mode_differe: ModeDiffere;
}

export type ResultatPayload =
  | { ok: true; payload: PayloadReanalyse }
  | { ok: false; erreurs: ErreurSaisie[] };

/** Pré-remplit le formulaire avec les paramètres de l'analyse affichée. */
export function saisieDepuisAnalyse(analyse: CreditAnalyse | null): SaisieParametres {
  const p = analyse?.parametres;
  if (!p) return { ...SAISIE_VIDE };
  const mode: ModeDiffere = p.modeDiffere === 'franchise_totale' ? 'franchise_totale' : 'interets_seuls';
  return {
    dureeMois: typeof p.dureeMois === 'number' ? String(p.dureeMois) : '',
    differeMois: typeof p.differeMois === 'number' ? String(p.differeMois) : '',
    tauxAnnuel: typeof p.tauxAnnuel === 'number' ? String(p.tauxAnnuel) : '',
    modeDiffere: mode,
  };
}

const ENTIER = /^\d+$/;

/**
 * Décimale saisie à la française ou à l'anglaise (`18,5` comme `18.5`).
 * Conversion de SAISIE, pas de calcul : la valeur repart telle quelle au serveur,
 * qui la reprend en `Decimal`.
 */
function decimale(brut: string): number | null {
  const normalise = brut.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalise)) return null;
  const n = Number(normalise);
  return Number.isFinite(n) ? n : null;
}

/**
 * Corps de `POST /credits/applications/<code>/reanalyser/`.
 *
 * Les champs vides sont OMIS, jamais envoyés à 0 : le serveur a ses propres
 * valeurs de repli (cycle de la filière pour la durée, taux de base de la
 * filière pour le taux) et les envoyer à 0 les écraserait — un taux à 0 % n'est
 * pas « pas de taux ».
 */
export function payloadReanalyse(saisie: SaisieParametres): ResultatPayload {
  const erreurs: ErreurSaisie[] = [];
  const duree = saisie.dureeMois.trim();
  const differe = saisie.differeMois.trim();
  const taux = saisie.tauxAnnuel.trim();

  if (!duree) {
    erreurs.push({
      code: 'DUREE_REQUISE',
      message: 'Indiquez la durée du crédit, en mois : sans elle, aucun échéancier n’est constructible.',
    });
  } else if (!ENTIER.test(duree)) {
    erreurs.push({
      code: 'DUREE_NON_ENTIERE',
      message: 'La durée s’exprime en nombre entier de mois (le moteur construit une ligne par mois).',
    });
  }

  if (differe && !ENTIER.test(differe)) {
    erreurs.push({
      code: 'DIFFERE_NON_ENTIER',
      message: 'Le différé s’exprime en nombre entier de mois.',
    });
  }

  let tauxNum: number | null = null;
  if (taux) {
    tauxNum = decimale(taux);
    if (tauxNum === null) {
      erreurs.push({
        code: 'TAUX_NON_NUMERIQUE',
        message: 'Le taux annuel s’exprime en points de taux (18 ou 18,5 pour 18 %/an et 18,5 %/an).',
      });
    }
  }

  if (erreurs.length > 0) return { ok: false, erreurs };

  const payload: PayloadReanalyse = {
    duree_mois: Number(duree),
    mode_differe: saisie.modeDiffere,
  };
  if (differe) payload.differe_mois = Number(differe);
  if (tauxNum !== null) payload.taux_annuel = tauxNum;
  return { ok: true, payload };
}

/**
 * La saisie diffère-t-elle des paramètres de l'analyse affichée ?
 *
 * C'est le garde-fou d'honnêteté de l'écran : tant que ce prédicat est vrai,
 * l'échéancier et le DSCR affichés dessous appartiennent à d'AUTRES paramètres
 * que ceux à l'écran. Les afficher côte à côte sans le dire laisserait croire
 * qu'ils s'y rapportent — le front ne peut pas les recalculer, et ne doit pas
 * faire semblant.
 */
export function parametresModifies(saisie: SaisieParametres, analyse: CreditAnalyse | null): boolean {
  if (!analyse?.parametres) return true;
  const reference = saisieDepuisAnalyse(analyse);
  const memeNombre = (a: string, b: string): boolean => {
    const na = decimale(a);
    const nb = decimale(b);
    if (na === null || nb === null) return a.trim() === b.trim();
    return na === nb;
  };
  return !(
    memeNombre(saisie.dureeMois, reference.dureeMois)
    && memeNombre(saisie.differeMois, reference.differeMois)
    && memeNombre(saisie.tauxAnnuel, reference.tauxAnnuel)
    && saisie.modeDiffere === reference.modeDiffere
  );
}

/** Libellé d'un mode de différé, ou le code brut s'il est inconnu du front. */
export function libelleMode(mode: unknown): string {
  const trouve = MODES_DIFFERE.find((m) => m.value === mode);
  return trouve ? trouve.label : String(mode ?? '');
}
