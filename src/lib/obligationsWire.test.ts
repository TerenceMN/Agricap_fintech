/**
 * Ce que ces tests protègent : la **constante de brochure** qui contredit le serveur.
 *
 * `pages/Obligations.jsx` annonçait « Rendement 9 %/an » et « Taux Annuel 9 % »
 * depuis un `const ANNUAL_RATE = 0.09`, sur la même page — et jusque dans la même
 * ligne de tableau — que le `p.rate` réellement servi. Deux taux contradictoires
 * côte à côte. Ces constantes étaient les `default=` du modèle
 * `ObligationPosition` ; le backend les a supprimées en écrivant « les termes ne
 * s'inventent pas », le front en gardait la copie.
 *
 * Quatre défauts sont figés ici :
 *
 * 1. **Le terme de produit fabriqué.** Les termes affichés viennent des offres
 *    OUVERTES, offre par offre. Aucune offre ouverte → liste vide, jamais un
 *    repli sur 250 $ / 9 % / 24 mois.
 *
 * 2. **La projection financière locale.** « Valeur Maturité Est. » valait
 *    `montant × 1,09 ^ années` — une capitalisation COMPOSÉE sur un produit à
 *    coupon SIMPLE (`obligations.coupon_periodique`). Aucune fonction de ce
 *    module ne produit de valeur à maturité ; c'est un `DataGap` nommé.
 *
 * 3. **Les deux conventions d'unité du module.** `rate` d'une position est en
 *    points de pourcentage, `penaltyRate` d'un retrait est une fraction. Deux
 *    tests figent les deux, car les confondre affiche 900 % ou 0,02 %.
 *
 * 4. **La provenance perdue.** Une position antérieure au rattachement
 *    obligatoire à une offre porte des termes sans auteur : elle le DIT
 *    (`termsOrphaned`) au lieu de se présenter comme les autres.
 *
 * Les charges utiles sont écrites d'après `backend/investments/serializers.py`
 * (`obligation_row`, `OBLIGATION_RATE_UNITS`, `WITHDRAWAL_RATE_UNITS`) et
 * `backend/investments/views.py::obligation_withdrawals`.
 */
import { describe, expect, it } from 'vitest';
import type { BondWithdrawal, ObligationPosition, OpenOfferSummary } from '@/types/api';
import {
  BOND_SAVINGS_PLAN_GAP,
  MATURITY_VALUE_GAP,
  OBLIGATION_GAPS,
  WITHDRAWAL_NET_GAP,
  bondFlowStatusLabel,
  buildBondOfferTerms,
  buildObligationRows,
  buildWithdrawalRows,
  obligationStatusLabel,
  readMaturity,
  subscriptionAmount,
  totalBondsActive,
  totalInvestedActive,
} from '@/lib/obligationsWire';

/** `obligation_row` d'une position rattachée à son offre. Taux en POINTS de
 *  pourcentage : `OBLIGATION_RATE_UNITS = {"rate": "percent"}`. */
const POSITION_RATTACHEE: ObligationPosition = {
  id: 7,
  name: 'Souscription Maïs Kongo',
  couponAmount: 250,
  investedAmount: 1000,
  rate: 9,
  termMonths: 24,
  status: 'ACTIF',
  dateCreated: '2026-03-04T09:00:00Z',
  offerId: 3,
  offerCode: 'OFF-003',
  projectCode: 'PRJ-012',
  paymentFrequency: 'QUARTERLY',
  subscriptionId: 41,
  settledAmount: 1000,
  termsSource: 'investments.Offer',
  units: { rate: 'percent' },
};

/** Position antérieure au rattachement obligatoire — termes sans auteur. */
const POSITION_ORPHELINE: ObligationPosition = {
  id: 2,
  name: 'Position héritée',
  couponAmount: 250,
  investedAmount: 500,
  rate: 9,
  termMonths: 24,
  status: 'MATURE',
  dateCreated: '2025-01-10T09:00:00Z',
  offerId: null,
  offerCode: null,
  projectCode: null,
  paymentFrequency: null,
  subscriptionId: null,
  settledAmount: null,
  termsSource: 'AUCUNE (position antérieure au rattachement obligatoire à une offre)',
  units: { rate: 'percent' },
};

/** `obligation_withdrawals` : `penaltyRate` en FRACTION (0,02 = 2 %). */
const RETRAIT: BondWithdrawal = {
  id: 11,
  positionId: 7,
  amount: 300,
  penaltyRate: 0.02,
  reason: 'Urgence médicale',
  status: 'EN_ATTENTE',
  date: '2026-05-02T10:00:00Z',
  units: { penaltyRate: 'fraction' },
};

/** `open_offers_summary` : `couponRate` en POINTS de pourcentage. */
const OFFRE_OUVERTE = {
  offerId: 3,
  offerCode: 'OFF-003',
  projectCode: 'PRJ-012',
  title: 'Maïs Kongo Central',
  sector: 'Céréales',
  location: 'Kongo Central',
  fundedAmount: 4000,
  reservedAmount: 500,
  fundingGoal: 20000,
  minFundingAmount: 8000,
  minTicket: 250,
  couponRate: 11.5,
  maturityMonths: 18,
  paymentFrequency: 'QUARTERLY',
  bondUnitValue: 250,
  availableBonds: 60,
  minBonds: 1,
  maxBonds: 40,
  subscriptionDeadline: '2026-09-30',
  oversubscriptionPolicy: 'PRORATA',
  units: { couponRate: 'percent' },
} as unknown as OpenOfferSummary;

describe('buildObligationRows — les termes servis, avec leur provenance', () => {
  it('lit le taux du titre en POINTS de pourcentage, selon l’unité déclarée', () => {
    const [row] = buildObligationRows([POSITION_RATTACHEE]);
    // 9 doit rester 9 : traité en fraction, il s'afficherait « 900 % ».
    expect(row.ratePercent).toBe(9);
  });

  it('reconstitue le nombre de titres par division EXACTE du produit servi', () => {
    const [row] = buildObligationRows([POSITION_RATTACHEE]);
    expect(row.bonds).toBe(4); // 1000 / 250 — la règle de prix de `souscrire`
  });

  it('ne produit AUCUNE valeur à maturité', () => {
    const [row] = buildObligationRows([POSITION_RATTACHEE]);
    // Le fabriqué valait 1000 × 1,09² = 1188,10 — composé, sur un coupon simple.
    expect(Object.keys(row)).not.toContain('maturityValue');
    expect(JSON.stringify(row)).not.toContain('1188');
  });

  it('signale une position dont les termes ne viennent d’aucune offre', () => {
    const [orpheline] = buildObligationRows([POSITION_ORPHELINE]);
    expect(orpheline.termsOrphaned).toBe(true);
    expect(orpheline.termsSource).toContain('AUCUNE');
    const [rattachee] = buildObligationRows([POSITION_RATTACHEE]);
    expect(rattachee.termsOrphaned).toBe(false);
    expect(rattachee.offerCode).toBe('OFF-003');
  });

  it('ne divise pas par zéro sur une valeur unitaire absente', () => {
    const [row] = buildObligationRows([{ ...POSITION_RATTACHEE, couponAmount: 0 }]);
    expect(row.bonds).toBe(0);
    expect(Number.isFinite(row.bonds)).toBe(true);
  });

  it('rend un statut inconnu TEL QUEL', () => {
    expect(obligationStatusLabel('ACTIF')).toBe('Actif');
    expect(obligationStatusLabel('LIQUIDE')).toBe('LIQUIDE');
    expect(bondFlowStatusLabel('PAYE')).toBe('Payé');
    expect(bondFlowStatusLabel('SEQUESTRE')).toBe('SEQUESTRE');
  });
});

describe('totaux — additionner n’est pas dériver', () => {
  it('ne compte que les positions ACTIVES', () => {
    const rows = buildObligationRows([POSITION_RATTACHEE, POSITION_ORPHELINE]);
    expect(totalInvestedActive(rows)).toBe(1000); // la position MATURE est exclue
    expect(totalBondsActive(rows)).toBe(4);
  });
});

describe('readMaturity — une date, jamais une valeur', () => {
  it('compte des mois CALENDAIRES, pas des tranches de 30 jours', () => {
    // Souscrit le 04/03/2026 sur 24 mois → échéance 04/03/2028.
    const m = readMaturity('2026-03-04T09:00:00Z', 24, new Date('2027-03-04T09:00:00Z'));
    expect(m.maturityDate.getFullYear()).toBe(2028);
    expect(m.monthsRemaining).toBe(12);
  });

  it('ne rend jamais un nombre de mois négatif sur une position échue', () => {
    const m = readMaturity('2020-01-01T00:00:00Z', 12, new Date('2026-07-24T00:00:00Z'));
    expect(m.monthsRemaining).toBe(0);
    expect(m.elapsedPercent).toBe(100);
  });

  it('borne l’avancement à [0, 100] et ne divise pas par une durée nulle', () => {
    const m = readMaturity('2026-03-04T09:00:00Z', 0, new Date('2026-03-04T09:00:00Z'));
    expect(m.elapsedPercent).toBe(0);
    expect(Number.isFinite(m.elapsedPercent)).toBe(true);
  });

  it('ne produit AUCUN montant', () => {
    const m = readMaturity('2026-03-04T09:00:00Z', 24, new Date('2027-03-04T09:00:00Z'));
    expect(Object.keys(m).sort()).toEqual(['elapsedPercent', 'maturityDate', 'monthsRemaining']);
  });
});

describe('buildWithdrawalRows — la pénalité est une donnée de LIGNE', () => {
  it('lit `penaltyRate` en FRACTION et l’affiche en pourcents', () => {
    const [row] = buildWithdrawalRows([RETRAIT]);
    // 0,02 traité en points de pourcentage s'afficherait « 0,02 % ».
    expect(row.penaltyPercent).toBeCloseTo(2, 10);
  });

  it('affiche la pénalité RÉELLE d’une ligne qui s’écarte du défaut', () => {
    const [row] = buildWithdrawalRows([{ ...RETRAIT, penaltyRate: 0.05 }]);
    expect(row.penaltyPercent).toBeCloseTo(5, 10);
  });

  it('ne calcule aucun net à recevoir', () => {
    const [row] = buildWithdrawalRows([RETRAIT]);
    // Le fabriqué valait 300 × 0,98 = 294 : une promesse sans auteur.
    expect(JSON.stringify(row)).not.toContain('294');
  });
});

describe('buildBondOfferTerms — le produit se lit sur l’offre, pas sur une brochure', () => {
  it('sert la valeur unitaire, le coupon et la maturité de l’OFFRE', () => {
    const [terms] = buildBondOfferTerms([OFFRE_OUVERTE]);
    // Aucune trace des constantes supprimées : 250/9/24 ne sont plus la règle.
    expect(terms.bondUnitValue).toBe(250);
    expect(terms.couponRatePercent).toBe(11.5);
    expect(terms.maturityMonths).toBe(18);
  });

  it('rend une liste VIDE quand aucune offre n’est ouverte — jamais un repli', () => {
    expect(buildBondOfferTerms([])).toEqual([]);
  });

  it('écarte une offre de CAPITAL — `souscrire` la refuserait (OFFER_NOT_A_BOND)', () => {
    const action = { ...OFFRE_OUVERTE, typeOfTitle: 'ACTION' } as unknown as OpenOfferSummary;
    expect(buildBondOfferTerms([action])).toEqual([]);
  });

  it('CONSERVE une offre dont la typologie n’est pas déclarée', () => {
    // Masquer sur une supposition retirerait un produit vendable ; le serveur,
    // lui, tranche à la souscription avec un code explicite.
    const terms = buildBondOfferTerms([OFFRE_OUVERTE]);
    expect(terms).toHaveLength(1);
    expect(terms[0].titleType).toBeNull();
  });

  it('applique la règle de prix de `souscrire` : titres × valeur unitaire', () => {
    const [terms] = buildBondOfferTerms([OFFRE_OUVERTE]);
    expect(subscriptionAmount(terms, 4)).toBe(1000);
  });

  it('ne produit aucun montant sans offre ni sur une quantité non valide', () => {
    const [terms] = buildBondOfferTerms([OFFRE_OUVERTE]);
    expect(subscriptionAmount(null, 4)).toBeNull();
    expect(subscriptionAmount(terms, 0)).toBeNull();
    expect(subscriptionAmount(terms, Number.NaN)).toBeNull();
  });
});

describe('les trous nommés plutôt que comblés', () => {
  it('expose les trois manques du produit obligataire', () => {
    expect(Object.keys(OBLIGATION_GAPS).sort())
      .toEqual(['bondSavingsPlan', 'maturityValue', 'withdrawalNet']);
  });

  it('chaque trou nomme le contrat serveur qui le comblerait', () => {
    for (const gap of [MATURITY_VALUE_GAP, WITHDRAWAL_NET_GAP, BOND_SAVINGS_PLAN_GAP]) {
      expect(gap.whatIsMissing.length).toBeGreaterThan(0);
      expect(gap.serverContract.length).toBeGreaterThan(0);
      expect(gap.question).not.toBe('');
    }
  });
});
