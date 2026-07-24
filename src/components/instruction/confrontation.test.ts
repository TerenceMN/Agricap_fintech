import { describe, it, expect } from 'vitest';
import {
  construireConfrontation, messageFiabilite, nombreOuNull,
} from './confrontation';
import type { CreditAnalyse } from '@/types/api';

/**
 * Les payloads ci-dessous sont recopiés de la sortie de
 * `credits/analyse.py::scorer_technique` (clés `parModule`, `modulesNonReferences`,
 * `ecartsHorsPlage`, `quantiteReference`, `uniteReference`). Rappel de
 * `vitest.config.js` : un test écrit sur une forme mal lue CIMENTE l'erreur — ces
 * clés ont été relues dans le moteur, pas devinées.
 */
function analyse(details: Record<string, unknown>, reste: Partial<CreditAnalyse> = {}): CreditAnalyse {
  return {
    id: 7,
    reference: 'CR-2026-0001',
    referentiel: 'AGRICAP_FIN_SIM_01_Cereales_Mais',
    parametres: {
      dureeMois: 8, differeMois: 5, tauxAnnuel: 18, modeDiffere: 'interets_seuls',
      capital: 1330, devise: 'USD',
    },
    scoreGlobal: 29.2,
    recommandation: 'revue',
    tarification: null,
    dscr: 0.636,
    dscrStress: 0.477,
    criteres: {
      technique: { score: 15.3, poids: 25, points: 3.8, details },
      dscr: { score: 7.1, poids: 20, points: 1.4, details: {} },
      stress: { score: 0, poids: 10, points: 0, details: {} },
      comportemental: { score: 50, poids: 30, points: 15, details: {} },
      garanties: { score: 60, poids: 15, points: 9, details: {} },
    },
    indicateursHorsPlage: [],
    justifications: [],
    echeancier: [],
    totaux: {
      totalInterets: 0, totalInteretsCapitalises: 0, totalCapital: 0,
      serviceDette: 0, crdFinal: 0, nbEcheances: 0,
    },
    devise: 'USD',
    referentielInfo: {
      code: 'AGRICAP_FIN_SIM_01_Cereales_Mais', filiere: 'Céréales — Maïs',
      source: 'indicatif', estIndicatif: true, nCasReels: 4, version: 1,
    },
    scoreLettre: 'D',
    lignage: { needsSourceId: 12, revision: 2, sha256: 'abc123' },
    poidsAppliques: { technique: 25, dscr: 20, stress: 10, comportemental: 30, garanties: 15 },
    executeLe: '2026-07-24T09:00:00Z',
    versionMoteur: '4.0',
    ...reste,
  } as CreditAnalyse;
}

const DETAILS_COMPLETS = {
  totalPlan: 1330,
  totalReferentiel: 1750,
  ecartMoyenPct: 32.4,
  referentiel: 'AGRICAP_FIN_SIM_01_Cereales_Mais',
  quantiteReference: 2.5,
  uniteReference: 'ha',
  superficieHa: 2.5,
  commentaire: 'Comparaison faite contre un référentiel indicatif (N = 4 dossiers réels).',
  parModule: [
    {
      indicateur: 'cout_module:semences', module: 'semences', valeur: 420, reference: 300,
      ecartPct: 40, horsPlage: false, message: 'semences : +40.0 % vs référentiel',
    },
    {
      indicateur: 'cout_module:main_oeuvre', module: 'main_oeuvre', valeur: 120, reference: 600,
      ecartPct: -80, horsPlage: true, message: 'main_oeuvre : -80.0 % vs référentiel',
    },
  ],
  modulesNonReferences: [{ module: 'transport', montant: 90 }],
  ecartsHorsPlage: [
    {
      indicateur: 'cout_module:main_oeuvre', module: 'main_oeuvre', valeur: 120, reference: 600,
      ecartPct: -80, message: 'main_oeuvre : -80.0 % vs référentiel',
    },
  ],
};

describe('nombreOuNull — une valeur absente n’est jamais 0 (§4.6)', () => {
  it('rend null pour undefined, null, chaîne vide et NaN', () => {
    for (const v of [undefined, null, '', ' ', 'abc', Number.NaN, {}, []]) {
      expect(nombreOuNull(v)).toBeNull();
    }
  });

  it('conserve un vrai zéro servi par le serveur', () => {
    expect(nombreOuNull(0)).toBe(0);
    expect(nombreOuNull('0')).toBe(0);
  });
});

describe('messageFiabilite — l’autorité d’une plage se dit (§4.6)', () => {
  it('annonce la fiabilité limitée et l’effectif quand le référentiel est indicatif', () => {
    const m = messageFiabilite(true, 4);
    expect(m).toContain('INDICATIF');
    expect(m).toContain('N = 4');
    expect(m).toContain('fiabilité limitée');
  });

  it('annonce l’effectif quand la plage est apprise, sans parler de fiabilité limitée', () => {
    const m = messageFiabilite(false, 212);
    expect(m).toContain('212');
    expect(m).not.toContain('fiabilité limitée');
  });
});

describe('construireConfrontation — lecture ligne à ligne', () => {
  it('sert TOUS les postes du référentiel, dans la plage comme hors plage', () => {
    const c = construireConfrontation(analyse(DETAILS_COMPLETS));
    expect(c.completude).toBe('totale');
    expect(c.calculable).toBe(true);
    const modules = c.lignes.map((l) => l.module);
    expect(modules).toEqual(['semences', 'main_oeuvre', 'transport']);
  });

  it('reprend le verdict hors plage du serveur, sans le recalculer', () => {
    const c = construireConfrontation(analyse(DETAILS_COMPLETS));
    // semences s'écarte de +40 % et reste DANS la plage (tol_sup du référentiel) :
    // un front qui comparerait à un seuil en dur le marquerait à tort.
    expect(c.lignes[0]).toMatchObject({ module: 'semences', ecartPct: 40, horsPlage: false });
    expect(c.lignes[1]).toMatchObject({ module: 'main_oeuvre', ecartPct: -80, horsPlage: true });
    expect(c.nbHorsPlage).toBe(1);
    expect(c.nbPostes).toBe(3);
  });

  it('n’ouvre le canal de justification que sur les indicateurs relevés par le moteur', () => {
    const c = construireConfrontation(analyse(DETAILS_COMPLETS));
    expect(c.lignes.map((l) => l.justifiable)).toEqual([false, true, false]);
    // Un poste hors référentiel n'a aucun indicateur : le serveur refuserait
    // (422 INDICATEUR_INCONNU).
    expect(c.lignes[2].indicateur).toBeNull();
  });

  it('marque les postes du classeur que le référentiel ne couvre pas', () => {
    const c = construireConfrontation(analyse(DETAILS_COMPLETS));
    const hors = c.lignes[2];
    expect(hors.origine).toBe('hors_referentiel');
    expect(hors.valeurDeclaree).toBe(90);
    expect(hors.reference).toBeNull();
    expect(hors.ecartPct).toBeNull();
  });

  it('rattache les justifications à leur indicateur', () => {
    const a = analyse(DETAILS_COMPLETS, {
      justifications: [
        { indicateur: 'cout_module:main_oeuvre', justification: 'Travail familial non rémunéré.', agent: 'sub-dg', date: '2026-07-24T10:00:00Z' },
        { indicateur: 'cout_module:autre', justification: 'Hors sujet.', agent: 'sub-dg', date: '2026-07-24T10:00:00Z' },
      ],
    });
    const c = construireConfrontation(a);
    expect(c.lignes[1].justifications).toHaveLength(1);
    expect(c.lignes[0].justifications).toHaveLength(0);
  });

  it('retombe sur les seuls écarts servis, et le DIT, quand parModule manque', () => {
    const { parModule, modulesNonReferences, ...sansParModule } = DETAILS_COMPLETS;
    void parModule; void modulesNonReferences;
    const c = construireConfrontation(analyse(sansParModule));
    expect(c.completude).toBe('ecarts_seulement');
    expect(c.lignes).toHaveLength(1);
    expect(c.lignes[0].horsPlage).toBe(true);
  });

  it('n’oublie aucun indicateur signalé à la racine de l’analyse', () => {
    const a = analyse(DETAILS_COMPLETS, {
      indicateursHorsPlage: [
        { indicateur: 'cout_module:main_oeuvre', message: 'déjà dans parModule' },
        { indicateur: 'cout_module:intrants', message: 'intrants : +90.0 % vs référentiel', ecartPct: 90 },
      ],
    });
    const c = construireConfrontation(a);
    const codes = c.lignes.map((l) => l.indicateur);
    expect(codes).toContain('cout_module:intrants');
    // Pas de doublon pour celui qui figure déjà dans le détail par module.
    expect(codes.filter((x) => x === 'cout_module:main_oeuvre')).toHaveLength(1);
  });

  it('déclare la comparaison NON calculable au lieu d’un tableau vide trompeur', () => {
    const c = construireConfrontation(analyse({
      commentaire: 'Dimension de référence absente du dossier : la comparaison n’est pas calculable.',
      quantiteReference: null,
      uniteReference: 'ha',
      superficieHa: null,
      ecartsHorsPlage: [],
    }));
    expect(c.calculable).toBe(false);
    expect(c.lignes).toHaveLength(0);
    expect(c.motifNonCalculable).toContain('Dimension de référence absente');
  });

  it('donne un motif explicite même si le serveur n’en a servi aucun', () => {
    const c = construireConfrontation(analyse({}));
    expect(c.calculable).toBe(false);
    expect(c.motifNonCalculable).not.toBe('');
  });

  it('survit à une analyse absente sans inventer de base', () => {
    const c = construireConfrontation(null);
    expect(c.calculable).toBe(false);
    expect(c.lignes).toEqual([]);
    expect(c.base.quantiteReference).toBeNull();
    expect(c.base.totalPlan).toBeNull();
  });

  it('porte la base de la comparaison : dimension, unité, totaux, effectif', () => {
    const { base } = construireConfrontation(analyse(DETAILS_COMPLETS));
    expect(base).toMatchObject({
      quantiteReference: 2.5,
      uniteReference: 'ha',
      totalPlan: 1330,
      totalReferentiel: 1750,
      ecartMoyenPct: 32.4,
      devise: 'USD',
      estIndicatif: true,
      nCasReels: 4,
      fiabilite: 'indicative',
    });
  });
});
