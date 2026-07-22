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
} from '@/types/api';
import {
  MISSING_INVESTOR_METRICS,
  buildOpenOfferCards,
  buildPipelineStages,
  buildPositions,
  buildReturnColumns,
  describeHistoryCoverage,
  fractionToPercent,
  movementTypeLabel,
  positionsInDefault,
  projectStatusLabel,
  subscriptionStatusLabel,
  titleTypeLabel,
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

function metrics(over: Partial<InvestorMetrics> = {}): InvestorMetrics {
  return {
    totalInvested: 5000,
    totalSettled: 5000,
    totalRefunded: 0,
    totalDistributed: 156.25,
    positionsCount: 1,
    realizedReturn: 0.1234,
    realizedReturnUnavailableReason: null,
    expectedCouponRate: 12.5,
    valuation: {
      capitalOutstanding: 4843.75,
      latentGain: 210.4,
      latentGainIsLatent: true,
      method: 'Dette saine valorisée au pair ; intérêts courus non échus prorata temporis.',
    },
    nextPaymentDate: '2026-04-20',
    currency: 'USD',
    asOf: '2026-07-22',
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

describe('unités — la dissymétrie serveur, figée', () => {
  it('convertit le XIRR (fraction) en pourcents et laisse le coupon tel quel', () => {
    const colonnes = buildReturnColumns(metrics({
      realizedReturn: 0.1234, expectedCouponRate: 12.5,
    }));

    expect(colonnes.find((c) => c.key === 'realized')!.rate).toBeCloseTo(12.34, 10);
    // Surtout PAS 1250 : `expectedCouponRate` est déjà un pourcentage.
    expect(colonnes.find((c) => c.key === 'expected')!.rate).toBe(12.5);
  });

  it('distingue un taux nul d’un taux absent', () => {
    expect(fractionToPercent(0)).toBe(0);
    expect(fractionToPercent(null)).toBeNull();
    expect(fractionToPercent(undefined)).toBeNull();
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
    couponRate: 12.5,
    maturityMonths: 24,
    minTicket: 500,
    bondUnitValue: 100,
    availableBonds: 150,
    fundingGoal: 50000,
    reservedAmount: 12000,
    fundedAmount: 10000,
    minFundingAmount: 30000,
    oversubscriptionPolicy: 'REJECT',
    subscriptionDeadline: '2026-06-30',
    ...over,
  };
}

describe('buildOpenOfferCards', () => {
  it('joint le score du projet à l’offre ouverte', () => {
    const [carte] = buildOpenOfferCards(
      [openOffer()], [project({ status: 'P06', riskScore: 6, globalScore: 58, progressPercent: 20 })],
    );

    expect(carte.riskScore).toBe(6);
    expect(carte.globalScore).toBe(58);
    // L'avancement vient du serveur, il n'est pas redivisé ici.
    expect(carte.progressPercent).toBe(20);
  });

  it('n’invente pas de score quand le projet n’est pas joignable', () => {
    const [carte] = buildOpenOfferCards([openOffer()], []);

    expect(carte.riskScore).toBeNull();
    expect(carte.globalScore).toBeNull();
    expect(carte.progressPercent).toBeNull();
  });

  it('borne la souscription sur le stock disponible quand le serveur ne sert pas min/max', () => {
    // `offers/open` ne porte ni `minBonds` ni `maxBonds` : sans repli, le
    // sélecteur de titres partait sur `NaN` et la borne haute ne bloquait rien.
    const [carte] = buildOpenOfferCards([openOffer({ availableBonds: 30 })], [project()]);

    expect(carte.minBonds).toBe(1);
    expect(carte.maxBonds).toBe(30);
    expect(carte.bondLimitsFromServer).toBe(false);
  });

  it('préfère les bornes du serveur dès qu’elles sont disponibles', () => {
    const [carte] = buildOpenOfferCards(
      [openOffer()], [project()],
      [{ id: 100, typeOfTitle: 'ACTION', minBonds: 5, maxBonds: 200 }],
    );

    expect(carte.minBonds).toBe(5);
    expect(carte.maxBonds).toBe(200);
    expect(carte.bondLimitsFromServer).toBe(true);
    expect(carte.titleTypeLabel).toBe('Capital — action');
  });

  it('sépare l’argent encaissé des engagements réservés', () => {
    const [carte] = buildOpenOfferCards(
      [openOffer({ fundedAmount: 10000, reservedAmount: 12000 })], [project()],
    );

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

describe('MISSING_INVESTOR_METRICS', () => {
  it('nomme les trois grandeurs que le serveur ne calcule pas encore par investisseur', () => {
    expect(MISSING_INVESTOR_METRICS.map((m) => m.key).sort())
      .toEqual(['concentration', 'defaultRate', 'health']);
  });

  it('donne à chacune un motif affichable, jamais une valeur de remplacement', () => {
    for (const m of MISSING_INVESTOR_METRICS) {
      expect(m.reason.length).toBeGreaterThan(30);
      expect(Object.prototype.hasOwnProperty.call(m, 'value')).toBe(false);
    }
  });
});
