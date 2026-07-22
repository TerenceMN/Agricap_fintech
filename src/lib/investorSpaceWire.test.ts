/**
 * Espace investisseur — ce que ces tests protègent.
 *
 * Trois classes de défaut, toutes déjà survenues sur ce produit :
 *
 * 1. **La fuite d'asymétrie.** Une souscription d'un autre investisseur affichée
 *    dans l'espace personnel. Le serveur filtre, mais un front qui rend tout ce
 *    qu'on lui donne transforme n'importe quelle régression serveur en fuite.
 *    `buildPositions` doit rejeter ces lignes ET les compter.
 *
 * 2. **La confusion des rendements.** Réalisé, latent et attendu sont trois
 *    grandeurs de nature différente. Un seul chiffre, ou deux additionnés, et
 *    l'investisseur croit avoir gagné ce qu'il n'a pas touché.
 *
 * 3. **L'erreur d'unité.** `realizedReturn` arrive en fraction (0,12),
 *    `expectedCouponRate` en pourcents (12,5). Traiter les deux pareil affiche
 *    « 0,12 % » ou « 1 250 % ». Les tests figent la dissymétrie exacte.
 *
 * Les charges utiles sont écrites d'après `backend/investments/serializers.py` et
 * `backend/investments/metrics.py` — champ pour champ, sans champ inventé.
 */
import { describe, expect, it } from 'vitest';
import type {
  InvestmentMovement,
  InvestmentOffer,
  InvestmentPipeline,
  InvestmentProject,
  InvestmentSubscription,
  InvestorMetrics,
  OpenOfferSummary,
  ValuationPosition,
} from '@/types/api';
import {
  buildExposureBars,
  buildOpenOfferCards,
  buildPipelineStages,
  buildPositions,
  buildReturnColumns,
  describeHistoryCoverage,
  movementTypeLabel,
  positionsInDefault,
  projectStatusLabel,
  rateToPercent,
  rateUnit,
  subscriptionStatusLabel,
  titleTypeLabel,
  unmeasurableFrom,
  valuationMethodLabel,
} from '@/lib/investorSpaceWire';

// ── Fixtures fidèles aux sérialiseurs serveur ────────────────────────────────

function subscription(over: Partial<InvestmentSubscription> = {}): InvestmentSubscription {
  return {
    id: 1,
    investorId: 7,
    offerId: 100,
    amount: 5000,
    allocatedAmount: 5000,
    settledAmount: 5000,
    refundedAmount: 0,
    bonds: 50,
    queueRank: null,
    status: 'ACTIVE',
    paymentStatus: 'PAID',
    couponRate: 12.5,
    subscriptionDate: '2026-01-15',
    reservedAt: '2026-01-15T09:00:00Z',
    settledAt: '2026-01-20T09:00:00Z',
    refundedAt: null,
    nextPaymentDate: '2026-04-20',
    totalReceived: 156.25,
    subPortfolioId: null,
    ...over,
  };
}

function offer(over: Partial<InvestmentOffer> = {}): InvestmentOffer {
  return {
    id: 100,
    code: 'OFF-0001',
    projectId: 10,
    typeOfTitle: 'OBLIGATION',
    couponRate: 12.5,
    maturityMonths: 24,
    minTicket: 500,
    bondUnitValue: 100,
    minBonds: 5,
    maxBonds: 200,
    availableBonds: 150,
    fundingGoal: 50000,
    reservedAmount: 12000,
    fundedAmount: 10000,
    minFundingAmount: 30000,
    oversubscriptionPolicy: 'REJECT',
    subscriptionDeadline: '2026-06-30',
    closedAt: null,
    status: 'OUVERT',
    ...over,
  };
}

function project(over: Partial<InvestmentProject> = {}): InvestmentProject {
  return {
    id: 10,
    code: 'PRJ-0010',
    title: 'Rizière de Bukavu',
    sector: 'Riz',
    location: 'Sud-Kivu',
    promoter: 'COOP RIZ',
    status: 'P09',
    fundingTarget: 50000,
    fundedAmount: 10000,
    progressPercent: 20,
    disbursedAmount: 10000,
    returnedAmount: 0,
    distributedAmount: 0,
    riskScore: 4,
    globalScore: 72,
    managerName: 'A. Mwamba',
    managerSub: 'sub-mgr',
    isInvestable: false,
    ...over,
  };
}

/**
 * Réponse de `GET /investments/metrics/mine`, champ pour champ.
 *
 * Les taux sont en FRACTION et `units` le DÉCLARE : c'est la convention unique
 * du module depuis que `expectedCouponRate` a cessé de sortir en points de
 * pourcentage. Le fixture porte `units` parce que la réponse le porte — un
 * fixture qui l'omettrait testerait un serveur qui n'existe pas.
 */
function metrics(over: Partial<InvestorMetrics> = {}): InvestorMetrics {
  return {
    totalInvested: 5000,
    totalSettled: 5000,
    totalRefunded: 0,
    totalDistributed: 156.25,
    totalValue: 5054.15,
    positionsCount: 1,
    realizedReturn: 0.1234,
    realizedReturnUnavailableReason: null,
    expectedCouponRate: 0.125,
    expectedCouponBasis: 5000,
    expectedCouponPositions: 1,
    valuation: {
      capitalOutstanding: 4843.75,
      positions: [valuationPosition()],
      latentGain: 210.4,
      latentGainIsLatent: true,
      totalValue: 5054.15,
      positionsCount: 1,
      byMethod: { PAIR: { positionsCount: 1, amount: 4843.75 } },
      methodNotes: [],
      method: 'Dette saine valorisée au pair ; intérêts courus non échus prorata temporis.',
    },
    defaultRates: {
      byValue: 0, byCount: 0, defaultedValue: 0, defaultedProjects: 0,
      totalProjects: 1, totalValue: 5000, alertThreshold: 0.05, alert: false,
    },
    concentration: {
      exposureBySector: [{ key: 'Riz', amount: 5000, share: 1 }],
      exposureByLocation: [{ key: 'Sud-Kivu', amount: 5000, share: 1 }],
      herfindahlSector: 1, herfindahlGeography: 1, herfindahlRetained: 1,
      retainedAxis: 'sector', threshold: 0.25, highConcentration: true,
      largestExposureShare: 1, largestExposureProject: 'PRJ-0010',
      largestSector: 'Riz', largestSectorShare: 1,
      largestLocation: 'Sud-Kivu', largestLocationShare: 1,
      projectsCount: 1, sectorsCount: 1, locationsCount: 1, basisAmount: 5000,
    },
    lateProjects: {
      share: 0, lateProjects: 0, totalProjects: 1, projectsWithSchedule: 1,
      scheduleCoverageWarning: null,
    },
    health: {
      score: 62.5, rawScore: 62.5, clamped: false,
      formula: '100 − a×taux_défaut − b×max(0, H−h₀)×100 − c×part_projets_en_retard',
      parameters: { a: 4, b: 50, c: 1, h0: 0.25 },
      inputs: { defaultRate: 0, herfindahl: 1, lateShare: 0 },
      penalties: { default: 0, concentration: 37.5, late: 0 },
    },
    nextPayment: {
      nextPaymentDate: '2026-04-20', nextPaymentSource: 'repayment_schedule',
      upcomingCount: 2, offersWithSchedule: 1, offersCount: 1, unavailableReason: null,
    },
    nextPaymentDate: '2026-04-20',
    period: {
      from: '2026-01-20', to: '2026-07-22', flowsCount: 2,
      basis: 'Flux datés réels : encaissements de souscriptions et distributions.',
    },
    units: {
      realizedReturn: 'fraction',
      expectedCouponRate: 'fraction',
      'defaultRates.byValue': 'fraction',
      'defaultRates.byCount': 'fraction',
      'defaultRates.alertThreshold': 'fraction',
      'concentration.largestExposureShare': 'fraction',
      'lateProjects.share': 'fraction',
      'health.score': 'points_sur_100',
      'valuation.positions[].recoveryRate': 'fraction',
    },
    currency: 'USD',
    currenciesObserved: ['USD'],
    conversionRate: null,
    mixedCurrency: false,
    mixedCurrencyWarning: null,
    asOf: '2026-07-22',
    scope: 'Portefeuille de cet investisseur uniquement.',
    ...over,
  };
}

function valuationPosition(over: Partial<ValuationPosition> = {}): ValuationPosition {
  return {
    subscriptionId: 1,
    offerCode: 'OFF-0001',
    projectCode: 'PRJ-0010',
    projectStatus: 'P09',
    typeOfTitle: 'OBLIGATION',
    sector: 'Riz',
    location: 'Sud-Kivu',
    settledAmount: 5000,
    capitalRepaid: 156.25,
    couponsReceived: 0,
    principalAtPar: 4843.75,
    capitalOutstanding: 4843.75,
    latentGain: 210.4,
    valuationMethod: 'PAIR',
    recoveryRate: null,
    impairment: 0,
    valuationNote: 'Dette saine au pair, intérêts courus non échus nets des coupons déjà versés.',
    ...over,
  };
}

// ── 1. Asymétrie d'information ───────────────────────────────────────────────

describe('buildPositions — SON argent, jamais celui d’un autre', () => {
  it('écarte et compte toute souscription d’un autre investisseur', () => {
    // Cas de la régression serveur : `/subscriptions/mine` se met à renvoyer
    // large. L'écran de l'investisseur 7 ne doit rien laisser passer du 99.
    const autre = subscription({
      id: 2, investorId: 99, offerId: 100, amount: 999999, settledAmount: 999999,
    });

    const { positions, foreignRowsRejected } = buildPositions(
      [subscription(), autre], [offer()], [project()], 7,
    );

    expect(foreignRowsRejected).toBe(1);
    expect(positions).toHaveLength(1);
    expect(positions.map((p) => p.investorId)).toEqual([7]);
    // Aucune trace du montant de l'autre, sous aucune forme.
    const serialise = JSON.stringify(positions);
    expect(serialise).not.toContain('999999');
    expect(serialise).not.toContain('"investorId":99');
  });

  it('ne garde rien quand aucune ligne n’appartient à l’investisseur', () => {
    const { positions, foreignRowsRejected } = buildPositions(
      [subscription({ investorId: 42 }), subscription({ id: 3, investorId: 43 })],
      [offer()], [project()], 7,
    );

    expect(positions).toEqual([]);
    expect(foreignRowsRejected).toBe(2);
  });

  it('ne signale aucune anomalie sur un jeu propre', () => {
    const { foreignRowsRejected } = buildPositions(
      [subscription(), subscription({ id: 2 })], [offer()], [project()], 7,
    );

    expect(foreignRowsRejected).toBe(0);
  });
});

describe('buildPipelineStages — le tuyau en compteurs, jamais en dossiers', () => {
  const pipeline: InvestmentPipeline = {
    stages: [
      { stage: 'P03', label: 'Due diligence', count: 4, aggregateTarget: 220000 },
      { stage: 'P04', label: "Comité d'investissement", count: 1, aggregateTarget: 80000 },
    ],
    // Le serveur sert `[]` à un client. On simule ici la régression qui le
    // remplirait : l'écran investisseur doit rester muet malgré tout.
    projects: [project({ id: 55, code: 'PRJ-SECRET', title: 'Dossier en due diligence' })],
  };

  it('ne laisse fuir ni le nom, ni le code, ni le promoteur d’un dossier P01→P05', () => {
    const stages = buildPipelineStages(pipeline);

    const serialise = JSON.stringify(stages);
    expect(serialise).not.toContain('PRJ-SECRET');
    expect(serialise).not.toContain('Dossier en due diligence');
    expect(serialise).not.toContain('COOP RIZ');
  });

  it('conserve exactement les quatre champs d’une étape', () => {
    const stages = buildPipelineStages(pipeline);

    expect(stages).toHaveLength(2);
    expect(Object.keys(stages[0]).sort()).toEqual(['aggregateTarget', 'count', 'label', 'stage']);
    expect(stages[0]).toEqual({
      stage: 'P03', label: 'Due diligence', count: 4, aggregateTarget: 220000,
    });
  });

  it('rend un tableau vide sur une réponse absente', () => {
    expect(buildPipelineStages(null)).toEqual([]);
  });
});

// ── 2. Les trois colonnes de rendement ───────────────────────────────────────

describe('buildReturnColumns — trois grandeurs, jamais un chiffre unique', () => {
  it('rend toujours les trois colonnes, dans l’ordre réalisé / latent / attendu', () => {
    const colonnes = buildReturnColumns(metrics());

    expect(colonnes.map((c) => c.key)).toEqual(['realized', 'latent', 'expected']);
  });

  it('étiquette le gain latent comme latent et publie sa méthode', () => {
    const colonnes = buildReturnColumns(metrics());
    const latent = colonnes.find((c) => c.key === 'latent')!;

    expect(latent.isLatent).toBe(true);
    expect(latent.amount).toBe(210.4);
    // La méthode affichée est celle SERVIE, pas une phrase du front.
    expect(latent.detail).toContain('valorisée au pair');
    // Une seule colonne porte l'étiquette latente.
    expect(colonnes.filter((c) => c.isLatent)).toHaveLength(1);
  });

  it('n’additionne jamais le réalisé et le latent', () => {
    const colonnes = buildReturnColumns(metrics());
    const realise = colonnes.find((c) => c.key === 'realized')!;
    const latent = colonnes.find((c) => c.key === 'latent')!;

    // Le réalisé est un taux, le latent un montant : aucune fusion possible.
    expect(realise.unit).toBe('percent');
    expect(latent.unit).toBe('amount');
    expect(realise.amount).toBeNull();
    expect(latent.rate).toBeNull();
  });

  it('affiche le motif servi quand le XIRR n’existe pas, au lieu d’un 0 %', () => {
    // 0 % se lirait « vous n'avez rien gagné » ; le motif dit « rien n'a encore
    // été distribué ». Un investisseur ne réagit pas pareil aux deux.
    const motif = 'Tous les flux vont dans le même sens : le rendement n’existe pas encore.';
    const colonnes = buildReturnColumns(metrics({
      realizedReturn: null, realizedReturnUnavailableReason: motif,
    }));
    const realise = colonnes.find((c) => c.key === 'realized')!;

    expect(realise.rate).toBeNull();
    expect(realise.unavailableReason).toBe(motif);
  });

  it('fournit un motif de repli si le serveur en oublie un', () => {
    const colonnes = buildReturnColumns(metrics({
      realizedReturn: null, realizedReturnUnavailableReason: null,
    }));

    expect(colonnes[0].unavailableReason).toBeTruthy();
  });

  it('préserve un rendement réalisé négatif — une perte se montre', () => {
    const colonnes = buildReturnColumns(metrics({ realizedReturn: -0.4 }));

    expect(colonnes[0].rate).toBeCloseTo(-40, 10);
    expect(colonnes[0].unavailableReason).toBeNull();
  });
});

describe('unités — lues dans `units`, jamais supposées', () => {
  it('convertit les deux taux depuis la fraction, la convention unique du module', () => {
    const colonnes = buildReturnColumns(metrics({
      realizedReturn: 0.1234, expectedCouponRate: 0.125,
    }));

    expect(colonnes.find((c) => c.key === 'realized')!.rate).toBeCloseTo(12.34, 10);
    // 0,125 → 12,5 % : surtout pas 0,125 % (non converti) ni 1 250 % (converti deux fois).
    expect(colonnes.find((c) => c.key === 'expected')!.rate).toBeCloseTo(12.5, 10);
  });

  it('respecte une unité DÉCLARÉE différente plutôt que de convertir d’office', () => {
    // Si le serveur revenait un jour aux points de pourcentage pour un champ, il
    // le déclarerait — et l’écran ne doit alors PAS multiplier par 100. C’est
    // toute la raison d’être de `units` : ce front a déjà vécu la bascule
    // inverse, et ne l’a pas vue parce qu’il codait l’unité en dur.
    const colonnes = buildReturnColumns(metrics({
      expectedCouponRate: 12.5,
      units: { realizedReturn: 'fraction', expectedCouponRate: 'percent' },
    }));

    expect(colonnes.find((c) => c.key === 'expected')!.rate).toBe(12.5);
  });

  it('retombe sur la fraction quand le champ n’est pas déclaré', () => {
    expect(rateUnit(metrics({ units: {} }), 'realizedReturn')).toBe('fraction');
    expect(rateUnit(metrics(), 'defaultRates.byValue')).toBe('fraction');
    expect(rateUnit(metrics(), 'health.score')).toBe('points_sur_100');
  });

  it('distingue un taux nul d’un taux absent', () => {
    expect(rateToPercent(0)).toBe(0);
    expect(rateToPercent(null)).toBeNull();
    expect(rateToPercent(undefined)).toBeNull();
  });

  it('n’applique aucune conversion à une unité inconnue', () => {
    // Mieux vaut un chiffre visiblement non converti qu’une multiplication
    // appliquée à l’aveugle sur une unité qu’on n’a pas comprise.
    expect(rateToPercent(42, 'points_sur_100')).toBe(42);
    expect(rateToPercent(42, 'unite_inventee')).toBe(42);
  });
});

// ── 3. Le risque se montre quand il naît ─────────────────────────────────────

describe('positionsInDefault — P12 visible le jour même', () => {
  it('marque la position dès que SON projet passe en défaut', () => {
    const { positions } = buildPositions(
      [subscription()], [offer()], [project({ status: 'P12' })], 7,
    );

    expect(positions[0].isInDefault).toBe(true);
    expect(positions[0].projectStatusLabel).toBe('Défaut');
    expect(positionsInDefault(positions)).toHaveLength(1);
  });

  it('ne marque rien sur un projet sain', () => {
    const { positions } = buildPositions([subscription()], [offer()], [project()], 7);

    expect(positions[0].isInDefault).toBe(false);
    expect(positionsInDefault(positions)).toEqual([]);
  });
});

// ── Position : typologie, montants servis, aucun calcul ──────────────────────

describe('buildPositions — typologie et montants', () => {
  it('reprend la typologie dette / capital de l’offre', () => {
    const { positions } = buildPositions(
      [subscription()], [offer({ typeOfTitle: 'ACTION' })], [project()], 7,
    );

    expect(positions[0].titleType).toBe('ACTION');
    expect(positions[0].titleTypeLabel).toBe('Capital — action');
  });

  it('sépare réservé, alloué, encaissé et remboursé — quatre champs, quatre sens', () => {
    const { positions } = buildPositions(
      [subscription({ amount: 5000, allocatedAmount: 3000, settledAmount: 3000, refundedAmount: 500 })],
      [offer()], [project()], 7,
    );

    expect(positions[0].reservedAmount).toBe(5000);
    expect(positions[0].allocatedAmount).toBe(3000);
    expect(positions[0].settledAmount).toBe(3000);
    expect(positions[0].refundedAmount).toBe(500);
  });

  it('distingue une réservation d’un placement', () => {
    const { positions } = buildPositions(
      [subscription({ status: 'RESERVED', settledAt: null, settledAmount: 0 })],
      [offer()], [project()], 7,
    );

    expect(positions[0].isSettled).toBe(false);
    expect(positions[0].statusLabel).toBe('Réservée (non encaissée)');
  });

  it('nomme la position par son offre quand le projet n’est pas joignable', () => {
    // Cas réel : le projet est sorti du périmètre visible du client.
    const { positions } = buildPositions([subscription()], [offer()], [], 7);

    expect(positions[0].projectTitle).toBe('Offre OFF-0001');
    expect(positions[0].projectStatus).toBeNull();
    expect(positions[0].projectStatusLabel).toBe('—');
  });
});

// ── Libellés : traduire sans deviner ─────────────────────────────────────────

describe('libellés', () => {
  it('traduit les codes connus', () => {
    expect(projectStatusLabel('P06')).toBe('Levée de fonds');
    expect(titleTypeLabel('OBLIGATION')).toBe('Dette — obligation');
    expect(subscriptionStatusLabel('WAITLISTED')).toBe("Liste d'attente");
    expect(movementTypeLabel('SETTLEMENT')).toBe('Encaissement souscription');
  });

  it('affiche un code inconnu tel quel plutôt que de le ranger', () => {
    expect(projectStatusLabel('P42')).toBe('P42');
    expect(titleTypeLabel('WARRANT')).toBe('WARRANT');
    expect(movementTypeLabel('SWAP')).toBe('SWAP');
  });

  it('affiche un tiret sur un code absent', () => {
    expect(projectStatusLabel(null)).toBe('—');
    expect(subscriptionStatusLabel(undefined)).toBe('—');
  });
});

// ── Offres ouvertes ──────────────────────────────────────────────────────────

function openOffer(over: Partial<OpenOfferSummary> = {}): OpenOfferSummary {
  return {
    offerId: 100,
    offerCode: 'OFF-0001',
    projectCode: 'PRJ-0010',
    title: 'Rizière de Bukavu',
    sector: 'Riz',
    location: 'Sud-Kivu',
    typeOfTitle: 'OBLIGATION',
    paymentFrequency: 'QUARTERLY',
    // `offers/open` sert ce taux en POINTS DE POURCENTAGE, contrairement à
    // `metrics/mine` qui sert des fractions déclarées. Deux endpoints, deux
    // conventions : le fixture fige la différence pour qu'elle reste visible.
    couponRate: 12.5,
    maturityMonths: 24,
    minTicket: 500,
    bondUnitValue: 100,
    minBonds: 5,
    maxBonds: 200,
    availableBonds: 150,
    fundingGoal: 50000,
    riskScore: 6,
    globalScore: 58,
    riskCategory: 'Modéré',
    reservedAmount: 12000,
    fundedAmount: 10000,
    minFundingAmount: 30000,
    oversubscriptionPolicy: 'REJECT',
    subscriptionDeadline: '2026-06-30',
    ...over,
  };
}

describe('buildOpenOfferCards', () => {
  it('reprend le score du projet servi par l’offre ouverte', () => {
    // Le score n'est plus joint depuis `GET /investments/projects` : la
    // projection serveur le porte. Un appel de moins, une source unique.
    const [carte] = buildOpenOfferCards([openOffer()]);

    expect(carte.riskScore).toBe(6);
    expect(carte.globalScore).toBe(58);
    expect(carte.riskCategory).toBe('Modéré');
  });

  it('reprend la typologie du titre et la périodicité du coupon', () => {
    const [carte] = buildOpenOfferCards([openOffer({ typeOfTitle: 'ACTION' })]);

    expect(carte.titleType).toBe('ACTION');
    expect(carte.titleTypeLabel).toBe('Capital — action');
    expect(carte.paymentFrequency).toBe('QUARTERLY');
  });

  it('n’affiche pas de coupon converti : ce taux n’est pas une fraction', () => {
    // Le multiplier par 100 « pour homogénéiser » avec `metrics/mine` afficherait
    // 1 250 % sur une offre à 12,5 %.
    const [carte] = buildOpenOfferCards([openOffer({ couponRate: 12.5 })]);

    expect(carte.expectedReturn).toBe(12.5);
  });

  it('reprend les bornes de souscription servies par l’offre', () => {
    const [carte] = buildOpenOfferCards([openOffer({ minBonds: 5, maxBonds: 200 })]);

    expect(carte.minBonds).toBe(5);
    expect(carte.maxBonds).toBe(200);
    expect(carte.bondLimitsFromServer).toBe(true);
  });

  it('borne sur le stock disponible si un serveur ancien ne sert pas min/max', () => {
    // Sans ce repli, `Math.min(undefined, …)` donnait `NaN` dans le sélecteur de
    // titres et la borne haute ne bloquait rien. `funding.reserve` re-valide.
    const partiel = openOffer({ availableBonds: 30 });
    delete (partiel as Partial<OpenOfferSummary>).minBonds;
    delete (partiel as Partial<OpenOfferSummary>).maxBonds;

    const [carte] = buildOpenOfferCards([partiel]);

    expect(carte.minBonds).toBe(1);
    expect(carte.maxBonds).toBe(30);
    expect(carte.bondLimitsFromServer).toBe(false);
  });

  it('sépare l’argent encaissé des engagements réservés', () => {
    const [carte] = buildOpenOfferCards([openOffer({ fundedAmount: 10000, reservedAmount: 12000 })]);

    expect(carte.raisedAmount).toBe(10000);
    expect(carte.reservedAmount).toBe(12000);
  });
});

// ── Profondeur d'historique ──────────────────────────────────────────────────

function movement(dateTime: string, over: Partial<InvestmentMovement> = {}): InvestmentMovement {
  return {
    id: 1, type: 'DEPOSIT', investorId: 7, projectId: null, amount: 100,
    currency: 'USD', status: 'POSTED', geographicZone: 'Sud-Kivu', dateTime, ...over,
  };
}

describe('describeHistoryCoverage — dire ce qu’on a, et le dire quand c’est court', () => {
  it('annonce explicitement une profondeur inférieure à douze mois', () => {
    const couverture = describeHistoryCoverage([
      movement('2026-05-02T10:00:00Z'),
      movement('2026-06-11T10:00:00Z', { id: 2 }),
      movement('2026-06-28T10:00:00Z', { id: 3 }),
    ]);

    expect(couverture.monthsCovered).toBe(2);
    expect(couverture.movementsCount).toBe(3);
    expect(couverture.hasTwelveMonths).toBe(false);
    expect(couverture.note).toContain('2 mois');
    expect(couverture.note).toContain('Moins de douze mois');
  });

  it('reconnaît un historique de douze mois et plus', () => {
    const mouvements = Array.from({ length: 13 }, (_, i) =>
      movement(`2025-${String((i % 12) + 1).padStart(2, '0')}-05T10:00:00Z`, { id: i + 1 }));

    const couverture = describeHistoryCoverage(mouvements);

    expect(couverture.monthsCovered).toBe(12);
    expect(couverture.hasTwelveMonths).toBe(true);
    expect(couverture.note).not.toContain('Moins de douze mois');
  });

  it('borne l’historique sur les dates réellement servies', () => {
    const couverture = describeHistoryCoverage([
      movement('2026-06-11T10:00:00Z', { id: 2 }),
      movement('2026-01-02T10:00:00Z'),
    ]);

    expect(couverture.from).toBe('2026-01-02T10:00:00Z');
    expect(couverture.to).toBe('2026-06-11T10:00:00Z');
  });

  it('dit qu’il n’y a rien plutôt que de dessiner un vide', () => {
    const couverture = describeHistoryCoverage([]);

    expect(couverture.monthsCovered).toBe(0);
    expect(couverture.from).toBeNull();
    expect(couverture.note).toContain('Aucun mouvement');
  });
});

// ── Métriques manquantes : nommées, pas simulées ─────────────────────────────

describe('unmeasurableFrom — ce qui manque est une DONNÉE, plus un calcul', () => {
  it('ne signale rien sur un portefeuille complètement mesurable', () => {
    expect(unmeasurableFrom(metrics())).toEqual([]);
  });

  it('remonte le motif SERVI quand la date du prochain paiement n’est pas établissable', () => {
    const motif = "Aucun échéancier de retour n'est enregistré sur les offres de ce portefeuille.";
    const trous = unmeasurableFrom(metrics({
      nextPayment: {
        nextPaymentDate: null, nextPaymentSource: null, upcomingCount: 0,
        offersWithSchedule: 0, offersCount: 2, unavailableReason: motif,
      },
      nextPaymentDate: null,
    }));

    expect(trous.map((t) => t.key)).toContain('nextPayment');
    // Le texte affiché est celui du serveur, pas une reformulation du front.
    expect(trous.find((t) => t.key === 'nextPayment')!.reason).toBe(motif);
  });

  it('relaie l’avertissement de couverture des échéanciers', () => {
    const avertissement = "2 projet(s) sur 3 n'ont aucun échéancier de retour enregistré.";
    const trous = unmeasurableFrom(metrics({
      lateProjects: {
        share: 0, lateProjects: 0, totalProjects: 3, projectsWithSchedule: 1,
        scheduleCoverageWarning: avertissement,
      },
    }));

    expect(trous.find((t) => t.key === 'lateProjects')!.reason).toBe(avertissement);
  });

  it('signale les titres de capital retenus au pair faute d’expertise', () => {
    // Le pair n’est pas une valeur de marché : c’est le prix payé. Le laisser
    // passer pour une valorisation est exactement le chiffre flatteur discret.
    const trous = unmeasurableFrom(metrics({
      valuation: {
        ...metrics().valuation,
        positions: [valuationPosition({ valuationMethod: 'PAIR_FAUTE_D_EXPERTISE' })],
      },
    }));

    expect(trous.map((t) => t.key)).toContain('expertValuation');
  });

  it('n’invente jamais de valeur de remplacement', () => {
    const trous = unmeasurableFrom(metrics({
      nextPayment: {
        nextPaymentDate: null, nextPaymentSource: null, upcomingCount: 0,
        offersWithSchedule: 0, offersCount: 1, unavailableReason: 'Aucun échéancier.',
      },
    }));

    for (const t of trous) {
      expect(Object.prototype.hasOwnProperty.call(t, 'value')).toBe(false);
    }
  });
});

describe('buildExposureBars — le serveur ventile, l’écran ne fait que tracer', () => {
  it('conserve montant et part servis, et met la part en pourcents', () => {
    const barres = buildExposureBars([
      { key: 'Riz', amount: 3000, share: 0.6 },
      { key: 'Maïs', amount: 2000, share: 0.4 },
    ]);

    expect(barres[0]).toEqual({ key: 'Riz', amount: 3000, share: 0.6, sharePercent: 60 });
    expect(barres[1].sharePercent).toBeCloseTo(40, 10);
  });

  it('préserve l’ordre servi — le tri est celui du serveur', () => {
    const barres = buildExposureBars([
      { key: 'A', amount: 10, share: 0.1 },
      { key: 'B', amount: 90, share: 0.9 },
    ]);

    expect(barres.map((b) => b.key)).toEqual(['A', 'B']);
  });

  it('rend un tableau vide sur une ventilation absente', () => {
    expect(buildExposureBars()).toEqual([]);
    expect(buildExposureBars([])).toEqual([]);
  });
});

describe('valorisation par position — jointe, jamais recalculée', () => {
  it('rattache la valorisation serveur à sa souscription', () => {
    const { positions } = buildPositions(
      [subscription()], [offer()], [project()], 7,
      [valuationPosition({ capitalOutstanding: 4843.75, latentGain: 210.4 })],
    );

    expect(positions[0].valuation?.capitalOutstanding).toBe(4843.75);
    expect(positions[0].valuation?.latentGain).toBe(210.4);
    expect(positions[0].valuation?.valuationMethod).toBe('PAIR');
  });

  it('livre la perte estimée et le taux de recouvrement d’une position en défaut', () => {
    const { positions } = buildPositions(
      [subscription()], [offer()], [project({ status: 'P12' })], 7,
      [valuationPosition({
        projectStatus: 'P12', valuationMethod: 'PROVISION_P12',
        recoveryRate: 0.3, capitalOutstanding: 1453.13, impairment: 3390.62,
      })],
    );

    expect(positions[0].isInDefault).toBe(true);
    expect(positions[0].valuation?.impairment).toBe(3390.62);
    expect(positions[0].valuation?.recoveryRate).toBe(0.3);
  });

  it('laisse une réservation non valorisée plutôt que de lui inventer une valeur', () => {
    const { positions } = buildPositions(
      [subscription({ status: 'RESERVED', settledAt: null, settledAmount: 0 })],
      [offer()], [project()], 7, [],
    );

    expect(positions[0].valuation).toBeNull();
  });

  it('n’attribue jamais la valorisation d’une souscription à une autre', () => {
    const { positions } = buildPositions(
      [subscription({ id: 1 }), subscription({ id: 2 })], [offer()], [project()], 7,
      [valuationPosition({ subscriptionId: 2, impairment: 999 })],
    );

    expect(positions.find((p) => p.subscriptionId === 1)!.valuation).toBeNull();
    expect(positions.find((p) => p.subscriptionId === 2)!.valuation?.impairment).toBe(999);
  });
});

describe('valuationMethodLabel', () => {
  it('distingue le pair choisi du pair subi', () => {
    expect(valuationMethodLabel('PAIR')).toBe('Au pair');
    expect(valuationMethodLabel('PAIR_FAUTE_D_EXPERTISE')).toBe('Au pair, faute d’expertise');
    expect(valuationMethodLabel('PAIR')).not.toBe(valuationMethodLabel('PAIR_FAUTE_D_EXPERTISE'));
  });

  it('affiche une méthode inconnue telle quelle', () => {
    expect(valuationMethodLabel('MARK_TO_MODEL')).toBe('MARK_TO_MODEL');
  });
});
