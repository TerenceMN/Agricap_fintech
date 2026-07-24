/**
 * Outils de « Gestion de Portefeuilles » — ce que ces tests protègent.
 *
 * Quatre classes de défaut, toutes déjà survenues sur ce produit :
 *
 * 1. **Le chiffre inventé.** Une page affichait « Total reçu 12 450 $ » et
 *    « TRI 11,8 % » au-dessus d'un tableau vide. Ici, une grandeur absente sort
 *    à `null` AVEC le motif servi, et `formatReportValue` rend le motif — pas un
 *    zéro, pas un tiret muet.
 *
 * 2. **Le seuil recodé côté navigateur.** Les seuils (défaut, Herfindahl) vivent
 *    dans `InvestmentConfig` et arrivent dans le payload. Un test vérifie qu'un
 *    taux de défaut de 90 % ne déclenche AUCUNE alerte tant que le serveur dit
 *    `alert: false` : c'est le serveur qui alerte, pas l'écran.
 *
 * 3. **L'erreur d'unité.** Un ratio de couverture de 60 % a déjà été affiché
 *    « 0,6 % » sur un écran de décision. Les taux sont donc convertis selon
 *    l'unité DÉCLARÉE dans `units`, et deux tests figent les deux conventions.
 *
 * 4. **L'écart calculé sur une base incomplète.** Un rééquilibrage dont les
 *    cibles ne totalisent pas 100 % produirait des écarts faux qui auraient
 *    l'air justes : la fonction refuse de les produire.
 *
 * Les charges utiles sont écrites d'après `backend/investments/metrics.py` et
 * `backend/investments/serializers.py` — champ pour champ, sans champ inventé.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  InvestmentMovement,
  InvestmentSubscription,
  InvestorMetrics,
  ValuationPosition,
} from '@/types/api';
import { buildAllocationView } from '@/lib/investorSpaceWire';
import {
  BENCHMARK_GAP,
  DATA_GAPS,
  ESG_GAP,
  MOVEMENTS_SERVER_LIMIT,
  REBALANCE_MISSING_CONTRACT,
  SECONDARY_MARKET_FEE_GAP,
  buildGlobalReport,
  buildMovementRows,
  buildPortfolioAlerts,
  buildRebalanceView,
  buildSurveillanceRows,
  countMovementsByType,
  describeSubPortfolioScope,
  flattenReport,
  formatReportValue,
  movementCurrencies,
  movementsTruncationNote,
} from '@/lib/portfolioTools';

// ── Fixtures fidèles au serveur ──────────────────────────────────────────────

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
    capitalRepaid: 0,
    couponsReceived: 0,
    principalAtPar: 5000,
    capitalOutstanding: 5000,
    latentGain: 210.4,
    valuationMethod: 'PAIR',
    recoveryRate: null,
    impairment: 0,
    valuationNote: 'Dette saine au pair, intérêts courus non échus nets des coupons déjà versés.',
    ...over,
  };
}

/** Portefeuille SAIN : aucun drapeau serveur levé, aucun motif d'absence. */
function metrics(over: Partial<InvestorMetrics> = {}): InvestorMetrics {
  return {
    totalInvested: 5000,
    totalSettled: 5000,
    totalRefunded: 0,
    totalDistributed: 156.25,
    totalValue: 5210.4,
    positionsCount: 1,
    realizedReturn: 0.1234,
    realizedReturnUnavailableReason: null,
    expectedCouponRate: 0.125,
    expectedCouponBasis: 5000,
    expectedCouponPositions: 1,
    valuation: {
      capitalOutstanding: 5000,
      positions: [valuationPosition()],
      latentGain: 210.4,
      latentGainIsLatent: true,
      totalValue: 5210.4,
      positionsCount: 1,
      byMethod: { PAIR: { positionsCount: 1, amount: 5000 } },
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
      herfindahlSector: 0.2, herfindahlGeography: 0.18, herfindahlRetained: 0.2,
      retainedAxis: 'sector', threshold: 0.25, highConcentration: false,
      largestExposureShare: 0.4, largestExposureProject: 'PRJ-0010',
      largestSector: 'Riz', largestSectorShare: 0.4,
      largestLocation: 'Sud-Kivu', largestLocationShare: 0.4,
      projectsCount: 3, sectorsCount: 3, locationsCount: 2, basisAmount: 5000,
    },
    lateProjects: {
      share: 0, lateProjects: 0, totalProjects: 3, projectsWithSchedule: 3,
      scheduleCoverageWarning: null,
    },
    health: {
      score: 100, rawScore: 100, clamped: false,
      formula: '100 − a×taux_défaut − b×max(0, H−h₀)×100 − c×part_projets_en_retard',
      parameters: { a: 4, b: 50, c: 1, h0: 0.25 },
      inputs: { defaultRate: 0, herfindahl: 0.2, lateShare: 0 },
      penalties: { default: 0, concentration: 0, late: 0 },
    },
    nextPayment: {
      nextPaymentDate: '2026-10-20', nextPaymentSource: 'repayment_schedule',
      upcomingCount: 2, offersWithSchedule: 1, offersCount: 1, unavailableReason: null,
    },
    nextPaymentDate: '2026-10-20',
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

function subscription(over: Partial<InvestmentSubscription> = {}): InvestmentSubscription {
  return {
    id: 1, investorId: 7, offerId: 100, amount: 5000, allocatedAmount: 5000,
    settledAmount: 5000, refundedAmount: 0, bonds: 50, queueRank: null,
    status: 'ACTIVE', paymentStatus: 'PAID', couponRate: 12.5,
    subscriptionDate: '2026-01-15', reservedAt: '2026-01-15T09:00:00Z',
    settledAt: '2026-01-20T09:00:00Z', refundedAt: null, nextPaymentDate: null,
    totalReceived: 156.25, subPortfolioId: null, units: { couponRate: 'percent' },
    ...over,
  };
}

function movement(over: Partial<InvestmentMovement> = {}): InvestmentMovement {
  return {
    id: 1, type: 'SETTLEMENT', investorId: 7, projectId: 10, amount: 5000,
    currency: 'USD', status: 'DONE', geographicZone: 'Sud-Kivu',
    dateTime: '2026-01-20T09:00:00Z',
    ...over,
  };
}

/** Allocation servie par `GET /investments/portfolio-allocation`, ventilée. */
const allocationServeur = {
  bonds: 8000,
  bondsFromSubscriptions: 5000,
  bondsFromObligationPositions: 3000,
  obligationPositionsCount: 2,
  cash: 2000,
  stocks: 0,
  reconciliationWarning: null,
};

// ── Périmètre ────────────────────────────────────────────────────────────────

describe('describeSubPortfolioScope', () => {
  const subs = [
    subscription({ id: 1, subPortfolioId: 3 }),
    subscription({ id: 2, subPortfolioId: 3 }),
    subscription({ id: 3, subPortfolioId: null }),
  ];

  it('compte les souscriptions rattachées, le total et les non rattachées', () => {
    const scope = describeSubPortfolioScope(subs, 3, 'Retraite');
    expect(scope.attachedCount).toBe(2);
    expect(scope.totalCount).toBe(3);
    expect(scope.unassignedCount).toBe(1);
  });

  it('annonce que les mesures portent sur TOUT le portefeuille, pas sur la poche', () => {
    // Sans cette phrase, un investisseur lit un taux de défaut global sous le
    // titre d'un sous-portefeuille et croit qu'il ne concerne que celui-ci.
    const scope = describeSubPortfolioScope(subs, 3, 'Retraite');
    expect(scope.note).toContain('ENSEMBLE');
    expect(scope.note).toContain('aucune métrique par sous-portefeuille');
    expect(scope.note).toContain('Retraite');
  });

  it('sans sous-portefeuille, ne parle que du portefeuille entier', () => {
    const scope = describeSubPortfolioScope(subs, null, '');
    expect(scope.attachedCount).toBe(0);
    expect(scope.note).toContain('3 souscription(s)');
  });
});

// ── Alertes ──────────────────────────────────────────────────────────────────

describe('buildPortfolioAlerts', () => {
  it('ne produit aucune alerte sur un portefeuille dont aucun drapeau n’est levé', () => {
    expect(buildPortfolioAlerts(metrics(), buildAllocationView(allocationServeur))).toEqual([]);
  });

  it('n’alerte QUE sur le drapeau serveur, jamais sur un seuil recodé ici', () => {
    // 90 % de défaut en valeur, mais le serveur dit `alert: false` : l'écran ne
    // s'invente pas un seuil. Le jour où le comité change le seuil en base,
    // l'écran suit sans redéploiement (principe 8).
    const alerts = buildPortfolioAlerts(metrics({
      defaultRates: {
        byValue: 0.9, byCount: 0.5, defaultedValue: 4500, defaultedProjects: 1,
        totalProjects: 2, totalValue: 5000, alertThreshold: 0.95, alert: false,
      },
    }));
    expect(alerts.find((a) => a.key === 'defaultRate')).toBeUndefined();
  });

  it('lève l’alerte de défaut quand le serveur la lève, avec ses deux taux et sa base', () => {
    const alerts = buildPortfolioAlerts(metrics({
      defaultRates: {
        byValue: 0.42, byCount: 0.5, defaultedValue: 2100, defaultedProjects: 1,
        totalProjects: 2, totalValue: 5000, alertThreshold: 0.05, alert: true,
      },
    }));
    const defaut = alerts.find((a) => a.key === 'defaultRate');
    expect(defaut?.severity).toBe('critique');
    // Fraction → pourcents d'affichage, selon l'unité DÉCLARÉE.
    expect(defaut?.facts.find((f) => f.key === 'byValue')?.value).toBeCloseTo(42, 6);
    expect(defaut?.facts.find((f) => f.key === 'byCount')?.value).toBeCloseTo(50, 6);
    expect(defaut?.facts.find((f) => f.key === 'threshold')?.value).toBeCloseTo(5, 6);
    // Un pourcentage sans base n'est pas une information.
    expect(defaut?.facts.find((f) => f.key === 'byValue')?.basis).toContain('5,000 $');
  });

  it('nomme la position en défaut : un agrégat ne dit pas QUELLE ligne a décroché', () => {
    const alerts = buildPortfolioAlerts(metrics({
      valuation: {
        ...metrics().valuation,
        positions: [
          valuationPosition(),
          valuationPosition({
            subscriptionId: 2, projectCode: 'PRJ-0042', projectStatus: 'P12',
            valuationMethod: 'PROVISION_P12', capitalOutstanding: 1200,
            impairment: 1800, recoveryRate: 0.4,
            valuationNote: 'Projet en défaut — taux de recouvrement constaté.',
          }),
        ],
      },
    }));
    const enDefaut = alerts.find((a) => a.key === 'default-2');
    expect(enDefaut?.severity).toBe('critique');
    expect(enDefaut?.title).toContain('PRJ-0042');
    expect(enDefaut?.statement).toBe('Projet en défaut — taux de recouvrement constaté.');
    expect(enDefaut?.facts.find((f) => f.key === 'impairment-2')?.value).toBe(1800);
    // 0,4 servi en fraction → 40 % à l'écran. Afficher « 0,4 % » sur un taux de
    // recouvrement est exactement l'incident que ce projet a déjà connu.
    expect(enDefaut?.facts.find((f) => f.key === 'recovery-2')?.value).toBeCloseTo(40, 6);
  });

  it('classe les alertes par gravité : le critique se lit avant l’information', () => {
    const alerts = buildPortfolioAlerts(metrics({
      mixedCurrency: true,
      currenciesObserved: ['CDF', 'USD'],
      mixedCurrencyWarning: 'Des flux libellés en CDF coexistent avec la devise de tenue USD.',
      lateProjects: {
        share: 0.33, lateProjects: 1, totalProjects: 3, projectsWithSchedule: 2,
        scheduleCoverageWarning: '1 projet(s) sur 3 n’ont aucun échéancier de retour enregistré.',
      },
    }));
    expect(alerts.map((a) => a.severity)).toEqual(
      [...alerts.map((a) => a.severity)].sort(
        (x, y) => (['critique', 'attention', 'information'].indexOf(x)
          - ['critique', 'attention', 'information'].indexOf(y)),
      ),
    );
    expect(alerts[0].key).toBe('mixedCurrency');
  });

  it('reprend MOT POUR MOT le motif servi, sans le reformuler', () => {
    const motif = 'Tous les flux vont dans le même sens : le rendement n’existe pas encore.';
    const alerts = buildPortfolioAlerts(metrics({
      realizedReturn: null, realizedReturnUnavailableReason: motif,
    }));
    expect(alerts.find((a) => a.key === 'realizedReturn')?.statement).toBe(motif);
  });

  it('signale un écart de rapprochement servi avec l’allocation', () => {
    const view = buildAllocationView({
      ...allocationServeur,
      reconciliationWarning: 'Deux « investi » différents coexistent pour cet investisseur.',
    });
    const alerts = buildPortfolioAlerts(metrics(), view);
    expect(alerts.find((a) => a.key === 'reconciliation')?.severity).toBe('attention');
  });

  it('dit qu’un titre de capital au pair n’est pas une valeur de marché', () => {
    const alerts = buildPortfolioAlerts(metrics({
      valuation: {
        ...metrics().valuation,
        positions: [valuationPosition({
          valuationMethod: 'PAIR_FAUTE_D_EXPERTISE',
          valuationNote: 'Titre de capital valorisé au pair — aucune expertise datée.',
        })],
      },
    }));
    const info = alerts.find((a) => a.key === 'noExpertValuation');
    expect(info?.severity).toBe('information');
    expect(info?.title).toContain('1 titre(s)');
  });
});

describe('buildSurveillanceRows', () => {
  it('dit ce qui est surveillé quand rien n’alerte — une page vide ne dit rien', () => {
    const rows = buildSurveillanceRows(metrics());
    expect(rows.map((r) => r.key)).toEqual(
      ['defaultByValue', 'hhi', 'late', 'health', 'positions'],
    );
    // Chaque ligne porte son seuil ou son effectif servi.
    expect(rows[0].basis).toContain('5,00 %');
    expect(rows[1].basis).toContain('0.25');
    expect(rows[3].value).toBe(100);
  });
});

// ── Rééquilibrage ────────────────────────────────────────────────────────────

describe('buildRebalanceView', () => {
  const view = buildAllocationView(allocationServeur); // 5000 + 3000 + 2000 = 10 000

  it('sans cible saisie, n’affiche aucun écart et dit qu’aucune cible n’est stockée', () => {
    const r = buildRebalanceView(view, {});
    expect(r.rows.every((x) => x.gapPoints === null && x.gapAmount === null)).toBe(true);
    expect(r.warning).toContain('Aucune allocation cible n’est enregistrée côté serveur');
  });

  it('refuse de calculer un écart tant que les cibles ne totalisent pas 100 %', () => {
    // Un écart mesuré sur une base incomplète est faux ET a l'air juste.
    const r = buildRebalanceView(view, { 'Souscriptions encaissées': 60, Cash: 20 });
    expect(r.targetsTotalPercent).toBe(80);
    expect(r.targetsComplete).toBe(false);
    expect(r.rows.every((x) => x.gapPoints === null)).toBe(true);
    expect(r.warning).toContain('80,00 %');
  });

  it('à 100 %, produit l’écart en points ET en montant, et les montants se compensent', () => {
    const r = buildRebalanceView(view, {
      'Souscriptions encaissées': 60, 'Positions obligataires': 20, Cash: 20,
    });
    expect(r.targetsComplete).toBe(true);
    const souscriptions = r.rows.find((x) => x.name === 'Souscriptions encaissées');
    expect(souscriptions?.currentSharePercent).toBeCloseTo(50, 6);
    expect(souscriptions?.gapPoints).toBeCloseTo(10, 6);
    expect(souscriptions?.gapAmount).toBeCloseTo(1000, 6);
    // Un rééquilibrage ne crée pas d'argent : la somme des écarts est nulle.
    const somme = r.rows.reduce((s, x) => s + (x.gapAmount ?? 0), 0);
    expect(somme).toBeCloseTo(0, 6);
  });

  it('sur un portefeuille vide, ne divise pas par zéro et le dit', () => {
    const vide = buildAllocationView({ bonds: 0, cash: 0, stocks: 0 });
    const r = buildRebalanceView(vide, { Cash: 100 });
    expect(r.total).toBe(0);
    expect(r.rows).toEqual([]);
    expect(r.warning).toContain('aucun actif valorisé');
  });

  it('conserve la nature de chaque poche : l’encaissé ne se mélange pas au déclaré', () => {
    const r = buildRebalanceView(view, {});
    expect(r.rows.map((x) => x.basis)).toEqual(['settled', 'declared', 'cash']);
  });
});

// ── Ce qui manque ────────────────────────────────────────────────────────────

describe('trous de données énoncés, jamais comblés', () => {
  it('ESG nomme le champ réellement existant et ce qu’il n’est pas', () => {
    expect(ESG_GAP.whatExists.join(' ')).toContain('impact_esg');
    expect(ESG_GAP.whatExists.join(' ')).toContain('TEXTE LIBRE');
    expect(ESG_GAP.serverContract.length).toBeGreaterThan(0);
  });

  it('Benchmarks dit qu’aucune série de référence n’est stockée', () => {
    expect(BENCHMARK_GAP.whatIsMissing.join(' ')).toContain('série de référence');
    expect(BENCHMARK_GAP.howItWouldBeFed.length).toBeGreaterThan(0);
  });

  it('le rééquilibrage énonce le contrat serveur manquant plutôt qu’un bouton mort', () => {
    expect(REBALANCE_MISSING_CONTRACT.serverContract.join(' ')).toContain('target-allocation');
    expect(REBALANCE_MISSING_CONTRACT.whatIsMissing.join(' ')).toContain('Aucune allocation cible');
  });

  it('le marché secondaire dit que le taux de frais n’est servi par aucun endpoint', () => {
    // `Holdings` affichait « Frais (1.5%) » puis « Net estimé si vendu » sur un
    // `0.015` en dur. Le champ existe en base, mais AUCUNE réponse ne le porte :
    // le net affiché n'avait donc pas de source, et supposait un acheteur.
    expect(SECONDARY_MARKET_FEE_GAP.whatIsMissing.join(' ')).toContain('fee_rate');
    expect(SECONDARY_MARKET_FEE_GAP.whatIsMissing.join(' ')).toContain('aucun endpoint');
    expect(SECONDARY_MARKET_FEE_GAP.serverContract.join(' ')).toContain('feeRate');
    expect(DATA_GAPS.secondaryMarketFee).toBe(SECONDARY_MARKET_FEE_GAP);
  });

  it('chaque trou dit ce qui existe, ce qui manque, et comment ce serait alimenté', () => {
    for (const gap of Object.values(DATA_GAPS)) {
      expect(gap.whatExists.length, gap.key).toBeGreaterThan(0);
      expect(gap.whatIsMissing.length, gap.key).toBeGreaterThan(0);
      expect(gap.howItWouldBeFed.length, gap.key).toBeGreaterThan(0);
      expect(gap.question.length, gap.key).toBeGreaterThan(0);
    }
  });
});

// ── Historique ───────────────────────────────────────────────────────────────

describe('historique des mouvements', () => {
  const mouvements = [
    movement({ id: 1, type: 'SETTLEMENT', dateTime: '2026-01-20T09:00:00Z', amount: 5000 }),
    movement({ id: 2, type: 'COUPON_REPAYMENT', dateTime: '2026-04-20T09:00:00Z', amount: 156.25 }),
    movement({ id: 3, type: 'COUPON_REPAYMENT', dateTime: '2026-07-20T09:00:00Z', amount: 156.25 }),
  ];

  it('trie du plus récent au plus ancien et traduit le type sans le deviner', () => {
    const rows = buildMovementRows(mouvements);
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(rows[0].typeLabel).toBe('Remboursement coupon');
  });

  it('affiche un code de type inconnu TEL QUEL plutôt que de le ranger au plus proche', () => {
    const rows = buildMovementRows([movement({ id: 9, type: 'TYPE_FUTUR' })]);
    expect(rows[0].typeLabel).toBe('TYPE_FUTUR');
  });

  it('filtre par type sans rien recalculer', () => {
    const rows = buildMovementRows(mouvements, { type: 'COUPON_REPAYMENT' });
    expect(rows.map((r) => r.id)).toEqual([3, 2]);
  });

  it('compte les lignes par type — un effectif, jamais une somme de montants', () => {
    const counts = countMovementsByType(mouvements);
    expect(counts[0]).toEqual({
      type: 'COUPON_REPAYMENT', label: 'Remboursement coupon', count: 2,
    });
    expect(Object.keys(counts[0])).not.toContain('amount');
  });

  it('ne parle de troncature que lorsque la borne serveur est atteinte', () => {
    expect(movementsTruncationNote(mouvements)).toBeNull();
    const pleine = Array.from({ length: MOVEMENTS_SERVER_LIMIT }, (_, i) => movement({ id: i }));
    expect(movementsTruncationNote(pleine)).toContain('500');
    expect(movementsTruncationNote(pleine)).toContain('total_rows');
  });

  it('liste les devises réellement observées', () => {
    expect(movementCurrencies([...mouvements, movement({ id: 4, currency: 'CDF' })]))
      .toEqual(['CDF', 'USD']);
  });
});

// ── Rapport global ───────────────────────────────────────────────────────────

describe('buildGlobalReport', () => {
  const report = buildGlobalReport({
    metrics: metrics(),
    allocation: buildAllocationView(allocationServeur),
    subPortfoliosCount: 2,
    subscriptionsCount: 3,
  });

  const findRow = (sectionKey: string, rowKey: string) =>
    report.sections.find((s) => s.key === sectionKey)?.rows.find((r) => r.key === rowKey);

  it('sépare les trois grandeurs qui ne se confondent jamais', () => {
    expect(report.sections.map((s) => s.key)).toEqual(
      ['engagement', 'valorisation', 'rendements', 'risque', 'repartition', 'organisation'],
    );
    expect(findRow('valorisation', 'latentGain')?.label).toContain('NON encaissé');
  });

  it('convertit chaque taux selon son unité déclarée, jamais ×100 à l’aveugle', () => {
    expect(findRow('rendements', 'realized')?.value).toBeCloseTo(12.34, 6);
    expect(findRow('rendements', 'expected')?.value).toBeCloseTo(12.5, 6);
    // `health.score` est servi en points sur 100 : il ne se multiplie pas.
    expect(findRow('risque', 'health')?.value).toBe(100);
  });

  it('respecte une unité `percent` sans la remultiplier', () => {
    const enPoints = buildGlobalReport({
      metrics: metrics({
        realizedReturn: 12.34,
        units: { ...metrics().units, realizedReturn: 'percent' },
      }),
      allocation: buildAllocationView(allocationServeur),
      subPortfoliosCount: 0,
      subscriptionsCount: 0,
    });
    const ligne = enPoints.sections.find((s) => s.key === 'rendements')
      ?.rows.find((r) => r.key === 'realized');
    expect(ligne?.value).toBeCloseTo(12.34, 6);
  });

  it('remplace un rendement absent par le MOTIF servi, jamais par zéro', () => {
    const sansTri = buildGlobalReport({
      metrics: metrics({
        realizedReturn: null,
        realizedReturnUnavailableReason: 'Moins de deux flux : aucun rendement n’est calculable.',
      }),
      allocation: buildAllocationView(allocationServeur),
      subPortfoliosCount: 0,
      subscriptionsCount: 0,
    });
    const ligne = sansTri.sections.find((s) => s.key === 'rendements')
      ?.rows.find((r) => r.key === 'realized');
    expect(ligne?.value).toBeNull();
    expect(ligne?.reason).toContain('Moins de deux flux');
    expect(formatReportValue(ligne!, 'USD')).toBe(
      'non disponible — Moins de deux flux : aucun rendement n’est calculable.',
    );
  });

  it('porte sa période, son périmètre et sa devise — un agrégat sans contexte n’en est pas un', () => {
    expect(report.asOf).toBe('2026-07-22');
    expect(report.scope).toContain('cet investisseur');
    expect(report.currency).toBe('USD');
    expect(report.period.flowsCount).toBe(2);
    expect(report.disclaimers.join(' ')).toContain('gain latent');
    expect(report.disclaimers.join(' ')).toContain('ni score ESG ni comparaison');
  });

  it('ventile la valorisation par méthode, avec l’effectif de chacune', () => {
    const ligne = findRow('valorisation', 'method-PAIR');
    expect(ligne?.label).toContain('Au pair');
    expect(ligne?.basis).toContain('1 position(s)');
  });

  it('reprend la répartition SERVIE sans refondre les natures', () => {
    const repartition = report.sections.find((s) => s.key === 'repartition');
    expect(repartition?.rows.map((r) => r.label)).toEqual(
      ['Souscriptions encaissées', 'Positions obligataires', 'Cash', 'Total'],
    );
    expect(repartition?.rows.find((r) => r.key === 'allocTotal')?.value).toBe(10000);
  });

  it('n’expose pas la vue institution : elle est refusée en 403 à un client', () => {
    // `metrics.portfolio()` agrège TOUS les investisseurs. L'appeler pour combler
    // un trou de l'espace investisseur serait une fuite d'asymétrie, et le
    // serveur le refuserait — l'écran afficherait alors une erreur au lieu d'une
    // absence assumée.
    const source = readFileSync(
      join(process.cwd(), 'src', 'pages', 'Portfolios.jsx'), 'utf8',
    );
    expect(source).not.toContain('metrics.portfolio(');
  });

  it('chaque ligne mise à plat garde sa base et sa clé serveur', () => {
    const plat = flattenReport(report);
    const totalEncaisse = plat.find((l) => l.label === 'Total encaissé');
    expect(totalEncaisse?.value).toBe('5,000 $');
    expect(totalEncaisse?.source).toBe('totalSettled');
    expect(totalEncaisse?.basis).toContain('position(s)');
    expect(plat.find((l) => l.label.startsWith('Rendement réalisé'))?.value).toBe('12,34 %');
  });
});

// ── Le défaut d'origine ne doit pas revenir ──────────────────────────────────

describe('l’écran Portefeuilles ne promet plus rien qu’il ne fait', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'pages', 'Portfolios.jsx'), 'utf8');

  it('ne contient plus aucun bouton « non disponible »', () => {
    // Sept boutons appelaient `handleNotAvailable`, un toast qui promettait une
    // fonction existant ailleurs. Un bouton fait quelque chose de réel, ou dit
    // ce qui manque — jamais « non disponible ».
    // La chaîne nue apparaît encore dans l'en-tête du fichier, qui RACONTE le
    // défaut corrigé : c'est l'appel et le message qui ne doivent plus exister.
    expect(source).not.toContain('handleNotAvailable(');
    expect(source).not.toContain('Non disponible :');
  });

  it('câble les six outils depuis une seule liste, sans bouton orphelin', () => {
    expect(source).toContain('PORTFOLIO_TOOLS');
    expect(source).toContain('PortfolioToolsDialog');
    expect(source).toContain('GlobalReportDialog');
  });

  it('ne stocke aucune donnée métier dans le navigateur', () => {
    // Une allocation cible en `localStorage` serait une donnée métier hors base,
    // invisible de l'institution — la dette que ce projet résorbe partout.
    expect(source).not.toContain('localStorage');
  });
});
