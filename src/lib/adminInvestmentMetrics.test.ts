/**
 * Ce que ces tests protègent : **deux écrans du même back-office qui ne
 * mesurent pas la même chose sous le même libellé.**
 *
 * `admin-console/AdminDashboard.jsx` affichait « Taux de Défaut » =
 * montant DEFAULTED ÷ montant investi. `admin-investments/AdminInvestmentDashboard.jsx`
 * affichait « Taux de Défaut » = projets P12 ÷ projets. Deux nombres, deux
 * définitions, un seul libellé — et les deux calculés en React sur des listes
 * paginées côté client.
 *
 * Quatre défauts sont figés ici :
 *
 * 1. **Le taux unique.** `buildDefaultRateCards` rend TOUJOURS les deux taux.
 *    Choisir lequel afficher est ce qui a produit le désaccord ; la fonction en
 *    est structurellement incapable.
 *
 * 2. **Le pourcentage sans base.** Chaque carte porte son effectif ou son
 *    montant de référence. Un « 12 % » sans base n'est pas une information.
 *
 * 3. **Le zéro qui se lit comme une mesure.** Sans charge utile serveur, les
 *    cartes sortent à `null` AVEC leur motif — jamais « 0,0 % », qui se lirait
 *    comme « aucun défaut ».
 *
 * 4. **L'unité.** `defaultRates.*` et `weightedIrr` sont servis en FRACTION
 *    (0,0925 = 9,25 %). Lus en points de pourcentage, ils afficheraient
 *    « 0,09 % » sur un écran de décision.
 *
 * Les charges utiles sont écrites d'après `backend/investments/metrics.py`
 * (`portfolio_metrics`, `_default_rates`, `RATE_UNITS`) — champ pour champ.
 */
import { describe, expect, it } from 'vitest';
import {
  AVERAGE_COUPON_GAP,
  asPortfolioMetrics,
  buildDefaultRateCards,
  buildInstitutionCards,
  buildWeightedReturnCard,
  scopeNote,
} from '@/lib/adminInvestmentMetrics';

/** `portfolio_metrics()` : trois projets financés, un en défaut, qui pèse peu en
 *  nombre (1/3 = 33,33 %) mais lourd en valeur (9 000/40 000 = 22,5 %). */
const METRICS = {
  weightedIrr: 0.0925,
  weightedIrrUnavailableReason: null,
  totalInvested: 40000,
  defaultRates: {
    byValue: 0.225,
    byCount: 0.3333,
    defaultedValue: 9000,
    defaultedProjects: 1,
    totalProjects: 3,
    totalValue: 40000,
    alertThreshold: 0.05,
    alert: true,
  },
  subscriptionsCount: 12,
  investorsCount: 7,
  period: { from: '2025-02-01', to: '2026-07-24', flowsCount: 31, basis: 'Flux datés réels.' },
  asOf: '2026-07-24',
  scope: 'Toutes offres, tous investisseurs.',
  currency: 'USD',
  mixedCurrencyWarning: null,
  units: {
    weightedIrr: 'fraction',
    'defaultRates.byValue': 'fraction',
    'defaultRates.byCount': 'fraction',
  },
};

describe('buildDefaultRateCards — les DEUX taux, jamais l’un sans l’autre', () => {
  it('rend systématiquement les deux définitions, nommées', () => {
    const cards = buildDefaultRateCards(METRICS);
    expect(cards.map((c) => c.key)).toEqual(['defaultByValue', 'defaultByCount']);
    expect(cards[0].label).toContain('en valeur');
    expect(cards[1].label).toContain('en nombre');
  });

  it('les deux taux DIFFÈRENT et sont tous deux servis — c’est tout le sujet', () => {
    const [valeur, nombre] = buildDefaultRateCards(METRICS);
    expect(valeur.value).toBe('22,50 %');
    expect(nombre.value).toBe('33,33 %');
    expect(valeur.value).not.toBe(nombre.value);
  });

  it('lit la FRACTION servie — 0,225 est 22,5 %, pas 0,23 %', () => {
    const [valeur] = buildDefaultRateCards(METRICS);
    expect(valeur.value).not.toBe('0,23 %');
  });

  it('accompagne chaque taux de sa base', () => {
    const [valeur, nombre] = buildDefaultRateCards(METRICS);
    // `toLocaleString('fr-FR')` sépare les milliers par une espace fine
    // insécable (U+202F) : on normalise plutôt que de coder le caractère.
    const base = valeur.basis.replace(/\s/g, ' ');
    expect(base).toContain('9 000 USD');
    expect(base).toContain('40 000 USD');
    expect(base).toContain('encaissés');
    expect(nombre.basis).toBe('1 projet(s) sur 3');
  });

  it('reprend le drapeau d’alerte SERVI, sans recoder le seuil', () => {
    const [valeur] = buildDefaultRateCards(METRICS);
    expect(valeur.alert).toBe(true);
    const calme = buildDefaultRateCards({
      ...METRICS, defaultRates: { ...METRICS.defaultRates, alert: false },
    });
    // Le taux reste à 22,5 %, très au-dessus du seuil de 5 % : c'est pourtant le
    // SERVEUR qui alerte, pas l'écran qui compare.
    expect(calme[0].alert).toBe(false);
  });

  it('sort en MOTIF, jamais en « 0 % », quand le serveur ne sert rien', () => {
    const cards = buildDefaultRateCards({});
    for (const c of cards) {
      expect(c.value).toBeNull();
      expect(c.unavailableReason).toContain('defaultRates');
      expect(c.unavailableReason).toContain('paginées');
    }
  });
});

describe('buildWeightedReturnCard — un TRI servi, pas une moyenne d’offres', () => {
  it('affiche le TRI pondéré du serveur avec sa période', () => {
    const card = buildWeightedReturnCard(METRICS);
    expect(card.value).toBe('9,25 %');
    expect(card.basis).toContain('31 flux');
    expect(card.basis).toContain('2025-02-01');
  });

  it('dit explicitement qu’il ne s’agit pas d’une moyenne de coupons promis', () => {
    const card = buildWeightedReturnCard(METRICS);
    expect(card.definition).toContain('coupons promis');
    expect(card.definition).toContain('XIRR');
  });

  it('rend le MOTIF servi quand le TRI n’est pas calculable', () => {
    const card = buildWeightedReturnCard({
      ...METRICS,
      weightedIrr: null,
      weightedIrrUnavailableReason: 'Aucune distribution versée : le TRI n’a pas de flux entrant.',
    });
    expect(card.value).toBeNull();
    expect(card.unavailableReason).toContain('Aucune distribution');
  });

  it('ne rend jamais 0 % faute de motif servi', () => {
    const card = buildWeightedReturnCard({ ...METRICS, weightedIrr: null });
    expect(card.value).toBeNull();
    expect(card.unavailableReason).toBeTruthy();
  });
});

describe('périmètre et provenance', () => {
  it('joint périmètre, date d’arrêté, effectif et devise', () => {
    const note = scopeNote(METRICS);
    expect(note).toContain('Toutes offres, tous investisseurs.');
    expect(note).toContain('2026-07-24');
    expect(note).toContain('12 souscription(s)');
    expect(note).toContain('USD');
  });

  it('fait remonter l’avertissement multi-devises quand il est servi', () => {
    const note = scopeNote({ ...METRICS, mixedCurrencyWarning: 'Deux devises sans taux journalisé.' });
    expect(note).toContain('Deux devises sans taux journalisé.');
  });

  it('chaque carte porte sa clé serveur d’origine', () => {
    for (const c of buildInstitutionCards(METRICS)) {
      expect(c.sourceKey.length).toBeGreaterThan(0);
      expect(c.definition.length).toBeGreaterThan(0);
    }
  });

  it('les trois cartes de l’institution sont rendues ensemble', () => {
    expect(buildInstitutionCards(METRICS).map((c) => c.key))
      .toEqual(['defaultByValue', 'defaultByCount', 'weightedIrr']);
  });
});

describe('asPortfolioMetrics — un endpoint non typé n’autorise aucune supposition', () => {
  it('refuse une charge utile qui n’est pas un objet', () => {
    expect(asPortfolioMetrics(null)).toBeNull();
    expect(asPortfolioMetrics('403')).toBeNull();
    expect(asPortfolioMetrics(undefined)).toBeNull();
  });

  it('laisse les cartes en motif sur un refus serveur', () => {
    const cards = buildInstitutionCards(asPortfolioMetrics(null));
    expect(cards.every((c) => c.value === null)).toBe(true);
  });
});

describe('le coupon moyen promis reste un trou nommé', () => {
  it('dit pourquoi une moyenne non pondérée n’en est pas une approximation', () => {
    expect(AVERAGE_COUPON_GAP.whatIsMissing.join(' ')).toContain('PONDÉRÉE');
    expect(AVERAGE_COUPON_GAP.whatIsMissing.join(' ')).toContain('500 000');
    expect(AVERAGE_COUPON_GAP.serverContract.join(' ')).toContain('expectedCouponRate');
  });
});
