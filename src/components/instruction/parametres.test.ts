import { describe, it, expect } from 'vitest';
import {
  MODES_DIFFERE, SAISIE_VIDE, libelleMode, parametresModifies, payloadReanalyse,
  saisieDepuisAnalyse, type SaisieParametres,
} from './parametres';
import type { CreditAnalyse } from '@/types/api';

const ANALYSE = {
  parametres: {
    dureeMois: 8, differeMois: 5, tauxAnnuel: 18, modeDiffere: 'interets_seuls',
    capital: 1330, devise: 'USD',
  },
} as CreditAnalyse;

const saisie = (p: Partial<SaisieParametres> = {}): SaisieParametres => ({
  ...SAISIE_VIDE, dureeMois: '8', differeMois: '5', tauxAnnuel: '18', ...p,
});

describe('MODES_DIFFERE — les deux modes du moteur, et rien d’autre', () => {
  it('reprend exactement `credits/echeancier.py::MODES`', () => {
    expect(MODES_DIFFERE.map((m) => m.value)).toEqual(['interets_seuls', 'franchise_totale']);
  });

  it('rend le code brut pour un mode inconnu plutôt que de deviner', () => {
    expect(libelleMode('mode_inexistant')).toBe('mode_inexistant');
    expect(libelleMode('franchise_totale')).toBe('Franchise totale');
  });
});

describe('saisieDepuisAnalyse', () => {
  it('pré-remplit avec les paramètres figés de l’analyse', () => {
    expect(saisieDepuisAnalyse(ANALYSE)).toEqual({
      dureeMois: '8', differeMois: '5', tauxAnnuel: '18', modeDiffere: 'interets_seuls',
    });
  });

  it('rend une saisie vide — pas des valeurs inventées — sans analyse', () => {
    expect(saisieDepuisAnalyse(null)).toEqual(SAISIE_VIDE);
  });
});

describe('payloadReanalyse — analyse syntaxique, jamais de règle métier', () => {
  it('construit le corps attendu par `POST .../reanalyser/`', () => {
    const r = payloadReanalyse(saisie());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload).toEqual({
        duree_mois: 8, differe_mois: 5, taux_annuel: 18, mode_differe: 'interets_seuls',
      });
    }
  });

  it('OMET les champs vides au lieu de les envoyer à 0', () => {
    // Un taux à 0 % n'est pas « pas de taux » : l'omission laisse le serveur
    // reprendre le taux de base de la filière.
    const r = payloadReanalyse(saisie({ differeMois: '', tauxAnnuel: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload).toEqual({ duree_mois: 8, mode_differe: 'interets_seuls' });
      expect('taux_annuel' in r.payload).toBe(false);
      expect('differe_mois' in r.payload).toBe(false);
    }
  });

  it('accepte un taux saisi à la française', () => {
    const r = payloadReanalyse(saisie({ tauxAnnuel: '18,5' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.taux_annuel).toBe(18.5);
  });

  it('refuse une durée absente ou non entière, avec un code exploitable', () => {
    const vide = payloadReanalyse(saisie({ dureeMois: '' }));
    expect(vide.ok).toBe(false);
    if (!vide.ok) expect(vide.erreurs[0].code).toBe('DUREE_REQUISE');

    const fractionnaire = payloadReanalyse(saisie({ dureeMois: '8,5' }));
    expect(fractionnaire.ok).toBe(false);
    if (!fractionnaire.ok) expect(fractionnaire.erreurs[0].code).toBe('DUREE_NON_ENTIERE');
  });

  it('collecte TOUTES les erreurs de la saisie, pas seulement la première', () => {
    const r = payloadReanalyse(saisie({ dureeMois: 'x', differeMois: 'y', tauxAnnuel: 'z' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.map((e) => e.code).sort()).toEqual(
        ['DIFFERE_NON_ENTIER', 'DUREE_NON_ENTIERE', 'TAUX_NON_NUMERIQUE'],
      );
    }
  });

  it('N’INVENTE AUCUNE BORNE MÉTIER : un différé ≥ durée part au serveur', () => {
    // C'est `credits/echeancier.py` qui tranche (422 PARAMETRES_INVALIDES) : un
    // second jeu de bornes dans le navigateur dériverait du premier en silence.
    const r = payloadReanalyse(saisie({ dureeMois: '6', differeMois: '9' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toMatchObject({ duree_mois: 6, differe_mois: 9 });
  });

  it('n’invente pas non plus de plafond de taux', () => {
    const r = payloadReanalyse(saisie({ tauxAnnuel: '400' }));
    expect(r.ok).toBe(true);
  });
});

describe('parametresModifies — l’écran ne colle jamais un échéancier à d’autres paramètres', () => {
  it('faux quand la saisie est celle de l’analyse affichée', () => {
    expect(parametresModifies(saisie(), ANALYSE)).toBe(false);
  });

  it('vrai dès qu’un levier bouge', () => {
    expect(parametresModifies(saisie({ dureeMois: '10' }), ANALYSE)).toBe(true);
    expect(parametresModifies(saisie({ differeMois: '3' }), ANALYSE)).toBe(true);
    expect(parametresModifies(saisie({ tauxAnnuel: '20' }), ANALYSE)).toBe(true);
    expect(parametresModifies(saisie({ modeDiffere: 'franchise_totale' }), ANALYSE)).toBe(true);
  });

  it('tolère l’écriture du nombre (18 vs 18,00) sans crier à la modification', () => {
    expect(parametresModifies(saisie({ tauxAnnuel: '18,00' }), ANALYSE)).toBe(false);
  });

  it('vrai quand aucune analyse n’est affichée : rien n’a encore été figé', () => {
    expect(parametresModifies(saisie(), null)).toBe(true);
  });
});
