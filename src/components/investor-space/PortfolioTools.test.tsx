/**
 * `PortfolioToolsDialog` — les six outils de « Gestion de Portefeuilles ».
 *
 * Ce test existe pour deux raisons précises, toutes deux vécues sur ce produit :
 *
 * 1. **Un écran qui plante à l'ouverture.** Un type front déclarant un champ que
 *    le backend n'émet pas a déjà fait tomber une page entière. Les six outils
 *    sont donc réellement rendus, sur une charge utile écrite d'après
 *    `backend/investments/metrics.py`, champ pour champ.
 *
 * 2. **La promesse qui se dérobe.** Les boutons ouvraient un toast « non
 *    disponible ». Aucun panneau ne doit désormais rendre ce message : soit il
 *    affiche une mesure servie, soit il énonce la donnée qui manque. Les deux
 *    cas sont vérifiés ici, y compris le fait que l'écran ESG n'affiche AUCUN
 *    score.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestorMetrics } from '@/types/api';
import { buildAllocationView } from '@/lib/investorSpaceWire';
import PortfolioToolsDialog from '@/components/investor-space/PortfolioTools';

const movements = vi.fn();
const projectDetail = vi.fn();

vi.mock('@/services/api', () => ({
  api: {
    investments: {
      movements: (...args: unknown[]) => movements(...args),
      projects: { detail: (...args: unknown[]) => projectDetail(...args) },
    },
  },
  ApiError: class ApiError extends Error {},
}));

/** Réponse de `GET /investments/metrics/mine`, recopiée du serveur. */
const metrics: InvestorMetrics = {
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
    positions: [{
      subscriptionId: 1, offerCode: 'OFF-0001', projectCode: 'PRJ-0010', projectStatus: 'P09',
      typeOfTitle: 'OBLIGATION', sector: 'Riz', location: 'Sud-Kivu', settledAmount: 5000,
      capitalRepaid: 0, couponsReceived: 0, principalAtPar: 5000, capitalOutstanding: 5000,
      latentGain: 210.4, valuationMethod: 'PAIR', recoveryRate: null, impairment: 0,
      valuationNote: 'Dette saine au pair.',
    }],
    latentGain: 210.4,
    latentGainIsLatent: true,
    totalValue: 5210.4,
    positionsCount: 1,
    byMethod: { PAIR: { positionsCount: 1, amount: 5000 } },
    methodNotes: [],
    method: 'Dette saine valorisée au pair.',
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
    realizedReturn: 'fraction', expectedCouponRate: 'fraction',
    'defaultRates.byValue': 'fraction', 'defaultRates.byCount': 'fraction',
    'defaultRates.alertThreshold': 'fraction',
    'concentration.largestExposureShare': 'fraction',
    'lateProjects.share': 'fraction', 'health.score': 'points_sur_100',
    'valuation.positions[].recoveryRate': 'fraction',
  },
  currency: 'USD',
  currenciesObserved: ['USD'],
  conversionRate: null,
  mixedCurrency: false,
  mixedCurrencyWarning: null,
  asOf: '2026-07-22',
  scope: 'Portefeuille de cet investisseur uniquement.',
};

const allocationView = buildAllocationView({
  bonds: 8000, bondsFromSubscriptions: 5000, bondsFromObligationPositions: 3000,
  obligationPositionsCount: 2, cash: 2000, stocks: 0, reconciliationWarning: null,
});

/** `recharts` observe la taille de son conteneur ; jsdom n'a pas d'observateur
 *  de redimensionnement. Sans ce bouchon, le panneau de risque — qui trace deux
 *  ventilations d'exposition — ne peut pas être monté sous test. */
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
});

const ouvrir = (tool: string, over: Record<string, unknown> = {}) => render(
  <PortfolioToolsDialog
    tool={tool}
    open
    onOpenChange={() => {}}
    metrics={metrics}
    metricsError={null}
    allocationView={allocationView}
    subscriptions={[]}
    subPortfolio={{ id: 3, name: 'Retraite' }}
    {...over}
  />,
);

describe('les six outils s’ouvrent et disent leur périmètre', () => {
  it('annonce que les mesures portent sur tout le portefeuille, pas sur la poche', () => {
    ouvrir('alerts');
    expect(document.body.textContent).toContain('aucune métrique par sous-portefeuille');
  });

  it('Alertes : sans drapeau levé, dit ce qui EST surveillé plutôt que rien', () => {
    ouvrir('alerts');
    expect(document.body.textContent).toContain('Ce qui est surveillé');
    expect(document.body.textContent).toContain('Taux de défaut — en valeur');
    // Le seuil affiché est celui SERVI (0,05 en fraction → 5 %), pas une constante.
    expect(document.body.textContent).toContain('5,00 %');
  });

  it('Risque : rend la formule du score et ses paramètres réellement appliqués', () => {
    ouvrir('risk');
    expect(document.body.textContent).toContain('Score de santé du portefeuille');
    expect(document.body.textContent).toContain('100 − a×taux_défaut');
  });

  it('Rééquilibrer : n’offre AUCUN bouton d’exécution et dit pourquoi', () => {
    ouvrir('rebalance');
    expect(document.body.textContent).toContain('Aucune allocation cible n’est enregistrée');
    expect(document.body.textContent).toContain('target-allocation');
    expect(screen.queryByText(/Exécuter/i)).toBeNull();
    expect(screen.queryByText(/Lancer le rééquilibrage/i)).toBeNull();
  });

  it('ESG : n’affiche aucun score et nomme le champ texte qui existe', () => {
    ouvrir('esg');
    expect(document.body.textContent).toContain('impact_esg');
    expect(document.body.textContent).toContain('non noté');
    expect(document.body.textContent).not.toMatch(/score ESG\s*[:=]\s*\d/i);
  });

  it('Benchmarks : dit qu’aucune série de référence n’est collectée', () => {
    ouvrir('benchmarks');
    expect(document.body.textContent).toContain('aucun indice de référence');
    expect(document.body.textContent).toContain('BenchmarkSeries');
  });

  it('Historique : charge les mouvements servis et n’en additionne aucun', async () => {
    movements.mockResolvedValueOnce([
      {
        id: 1, type: 'SETTLEMENT', investorId: 7, projectId: 10, amount: 5000,
        currency: 'USD', status: 'DONE', geographicZone: 'Sud-Kivu',
        dateTime: '2026-01-20T09:00:00Z',
      },
    ]);
    ouvrir('history');
    await waitFor(() => expect(document.body.textContent).toContain('Encaissement souscription'));
    expect(document.body.textContent).toContain('1 mouvement(s) affiché(s)');
    // Le message de profondeur est celui de `describeHistoryCoverage`, pas un total.
    expect(document.body.textContent).toContain('Moins de douze mois');
  });

  it('Historique : affiche l’erreur serveur au lieu d’un tableau vide', async () => {
    movements.mockRejectedValueOnce(Object.assign(new Error('Accès refusé.'), {
      errors: [{ code: 'FORBIDDEN', message: 'Profil investisseur absent.' }],
    }));
    ouvrir('history');
    await waitFor(() => expect(document.body.textContent).toContain('Historique indisponible'));
    expect(document.body.textContent).toContain('Profil investisseur absent.');
  });

  it('sans métriques, dit qu’elles manquent plutôt que d’afficher des zéros', () => {
    ouvrir('alerts', { metrics: null, metricsError: 'Profil investisseur introuvable.' });
    expect(document.body.textContent).toContain('Mesures indisponibles');
    expect(document.body.textContent).toContain('Profil investisseur introuvable.');
  });

  it('aucun panneau ne rend le message « non disponible »', () => {
    for (const tool of ['alerts', 'risk', 'rebalance', 'esg', 'benchmarks']) {
      const { unmount } = ouvrir(tool);
      expect(document.body.textContent, tool).not.toContain('Non disponible');
      unmount();
    }
  });
});
