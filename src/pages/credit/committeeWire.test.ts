/**
 * Écran comité — libellés de vote, couleur de lettre, projection de l'analyse.
 *
 * Le point sensible est `toMoteur` : une PROJECTION, jamais un calcul. Le comité
 * doit voir la lettre et la recommandation FIGÉES PAR L'ANALYSE (`scoreLettre`
 * est arrêté au moment du scoring et ne bouge plus si le barème est recalibré
 * ensuite). Si `toMoteur` se mettait un jour à dériver la lettre du score, deux
 * membres du comité regardant le même dossier à deux mois d'intervalle
 * pourraient lire deux lettres différentes — et c'est exactement la divergence
 * 50/55, `>`/`>=` qui a déjà eu lieu ailleurs dans ce front.
 */
import { describe, expect, it } from 'vitest';
import type { CreditAnalyse, CreditAnalyseCritere } from '@/types/api';
import {
  DECISION_LABELS,
  LETTRE_CLASSES,
  decisionLabel,
  lettreClass,
  toMoteur,
} from '@/pages/credit/committeeWire';

const critere: CreditAnalyseCritere = { score: 80, poids: 0.2, points: 16, details: {} };

/** Analyse serveur complète — aucun champ deviné, tous issus de `CreditAnalyse`. */
function analyse(over: Partial<CreditAnalyse> = {}): CreditAnalyse {
  return {
    id: 42,
    reference: 'AN-2026-0042',
    referentiel: 'MAIS-v3',
    parametres: {
      dureeMois: 8, differeMois: 5, tauxAnnuel: 0.18,
      modeDiffere: 'interets_seuls', capital: 1330, devise: 'USD',
    },
    scoreGlobal: 62,
    recommandation: 'revue',
    // Bloc servi par `serialiser_analyse_staff` depuis l'unification du moteur.
    // `null` = analyse antérieure à la grille unique, cas le plus neutre pour
    // ce fixture : le comité y lit la lettre et la recommandation, pas le taux.
    tarification: null,
    dscr: 1.12,
    dscrStress: 0.87,
    criteres: {
      technique: critere, dscr: critere, stress: critere,
      comportemental: critere, garanties: critere,
    },
    indicateursHorsPlage: [],
    justifications: [],
    echeancier: [],
    totaux: {
      totalInterets: 139.65, totalInteretsCapitalises: 0, totalCapital: 1330,
      serviceDette: 1469.65, crdFinal: 0, nbEcheances: 8,
    },
    devise: 'USD',
    referentielInfo: {
      code: '01', filiere: 'Maïs', source: 'indicatif',
      estIndicatif: true, nCasReels: 12, version: 3,
    },
    scoreLettre: 'C',
    lignage: { needsSourceId: 7, revision: 2, sha256: 'abc123' },
    poidsAppliques: { technique: 0.2 },
    executeLe: '2026-03-09T10:30:00Z',
    versionMoteur: '1.4.0',
    ...over,
  };
}

describe('decisionLabel', () => {
  it('libelle les deux seuls sens de vote acceptés par `cast_vote`', () => {
    expect(Object.keys(DECISION_LABELS).sort()).toEqual(['approve', 'reject']);
    expect(decisionLabel('approve').label).toBe("Pour l'approbation");
    expect(decisionLabel('reject').label).toBe('Pour le rejet');
  });

  it('affiche un sens inconnu tel quel, sans le rattacher à un des deux', () => {
    // Un « abstain » ajouté côté serveur ne doit surtout pas se lire « rejet ».
    const inconnu = decisionLabel('abstain');

    expect(inconnu.label).toBe('abstain');
    expect(inconnu.label).not.toBe('Pour le rejet');
  });

  it('affiche un tiret sur un vote absent', () => {
    expect(decisionLabel(null).label).toBe('—');
    expect(decisionLabel(undefined).label).toBe('—');
    expect(decisionLabel('').label).toBe('—');
  });
});

describe('lettreClass', () => {
  it('colore les quatre lettres du moteur', () => {
    for (const lettre of ['A', 'B', 'C', 'D']) {
      expect(LETTRE_CLASSES[lettre]).toBeTruthy();
      expect(lettreClass(lettre)).toBe(LETTRE_CLASSES[lettre]);
    }
  });

  it('donne des couleurs distinctes à A et D', () => {
    expect(lettreClass('A')).not.toBe(lettreClass('D'));
  });

  it('reste neutre sur une lettre inconnue ou absente', () => {
    expect(lettreClass('E')).toBe('text-slate-300 bg-white/10');
    expect(lettreClass(null)).toBe('text-slate-400 bg-white/10');
    expect(lettreClass(undefined)).toBe('text-slate-400 bg-white/10');
  });
});

describe('toMoteur — projection, jamais recalcul', () => {
  it('recopie exactement les six champs affichés', () => {
    const m = toMoteur(analyse());

    expect(m).toEqual({
      scoreGlobal: 62,
      scoreLettre: 'C',
      recommandation: 'revue',
      dscr: 1.12,
      dscrStress: 0.87,
      executeLe: '2026-03-09T10:30:00Z',
    });
  });

  it('n’emporte AUCUN référentiel chiffré vers l’écran (principe 7)', () => {
    const m: Record<string, unknown> = { ...toMoteur(analyse()) };

    // Le comité voit la recommandation, pas le barème : ni poids, ni critères,
    // ni plages, ni lignage n'ont à transiter par cette projection.
    for (const interdit of ['criteres', 'poidsAppliques', 'referentielInfo',
      'indicateursHorsPlage', 'lignage', 'parametres', 'echeancier', 'totaux']) {
      expect(Object.prototype.hasOwnProperty.call(m, interdit), interdit).toBe(false);
    }
    expect(Object.keys(m).sort()).toEqual([
      'dscr', 'dscrStress', 'executeLe', 'recommandation', 'scoreGlobal', 'scoreLettre',
    ]);
  });

  it('reprend la lettre SERVIE, même si elle contredit une grille locale', () => {
    // Score 90 et lettre C : incohérent au regard de la grille du simulateur,
    // et pourtant c'est la lettre figée à l'analyse qui fait foi. La recalculer
    // ferait varier l'affichage d'un dossier déjà instruit.
    const m = toMoteur(analyse({ scoreGlobal: 90, scoreLettre: 'C' }));

    expect(m.scoreLettre).toBe('C');
    expect(m.scoreGlobal).toBe(90);
  });

  it('préserve un DSCR absent au lieu de le remplacer par 0', () => {
    // 0 se lirait « aucune capacité de remboursement » ; null se lit « pas
    // calculable ». Un comité ne décide pas pareil sur les deux.
    const m = toMoteur(analyse({ dscr: null, dscrStress: null }));

    expect(m.dscr).toBeNull();
    expect(m.dscrStress).toBeNull();
  });

  it('préserve un DSCR nul comme un chiffre, pas comme une absence', () => {
    const m = toMoteur(analyse({ dscr: 0, dscrStress: 0 }));

    expect(m.dscr).toBe(0);
    expect(m.dscrStress).toBe(0);
  });
});
