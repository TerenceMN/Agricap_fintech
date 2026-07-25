/**
 * Métriques INSTITUTION du back-office investissement — une seule définition,
 * servie par `GET /investments/metrics/portfolio`.
 *
 * Ce que ce fichier répare
 * ------------------------
 * Deux écrans du même back-office affichaient une carte « Taux de Défaut », et
 * ils ne mesuraient pas la même chose :
 *
 *     admin-console/AdminDashboard.jsx
 *         montant des souscriptions DEFAULTED ÷ montant total investi
 *
 *     admin-investments/AdminInvestmentDashboard.jsx
 *         nombre de projets en P12 ÷ nombre total de projets
 *
 * Deux nombres, deux définitions, un seul libellé — et les deux calculés en
 * React, en `float`, sur des listes paginées côté client. Un administrateur qui
 * passait d'un onglet à l'autre lisait deux « taux de défaut » différents de
 * l'institution sans qu'aucun des deux écrans ne dise lequel il mesurait.
 *
 * Le serveur tranche déjà, et son commentaire dit pourquoi
 * (`investments/metrics.py::_default_rates`) : « Un seul projet en défaut sur
 * trente pèse peu en nombre et peut peser énormément en valeur : afficher un
 * seul des deux chiffres, c'est choisir celui qui arrange. Chaque taux porte sa
 * base — un pourcentage sans base n'est pas une information. »
 *
 * On affiche donc LES DEUX, servis, chacun avec sa base et son effectif.
 *
 * Le second défaut : « Rendement Moyen »
 * -------------------------------------
 * Les deux écrans calculaient `Σ couponRate ÷ nombre d'offres` — une moyenne
 * ARITHMÉTIQUE NON PONDÉRÉE de coupons PROMIS. Une offre de 500 USD y pesait
 * autant qu'une offre de 500 000 USD, et une promesse contractuelle y était
 * présentée comme un « rendement ». Le serveur sert, lui, un `weightedIrr` :
 * un TRI pondéré sur les flux datés réels de l'institution. Ce n'est pas la même
 * grandeur, et c'est celle qui mérite le mot « rendement » ; le coupon moyen
 * pondéré, lui, n'est pas servi à l'échelle institution (cf. `AVERAGE_COUPON_GAP`).
 */
import { formatPercent, rateToPercent, rateUnit } from './investorSpaceWire';
import type { DataGap } from './portfolioTools';

// ─────────────────────────────────────────────────────────────────────────────
// Forme lue — défensive : l'endpoint est typé `Record<string, unknown>`
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioMetricsPayload {
  weightedIrr?: number | null;
  weightedIrrUnavailableReason?: string | null;
  totalInvested?: number;
  defaultRates?: {
    byValue?: number;
    byCount?: number;
    defaultedValue?: number;
    defaultedProjects?: number;
    totalProjects?: number;
    totalValue?: number;
    alertThreshold?: number;
    alert?: boolean;
  };
  subscriptionsCount?: number;
  investorsCount?: number;
  period?: { from?: string | null; to?: string; flowsCount?: number; basis?: string };
  asOf?: string;
  scope?: string;
  currency?: string;
  mixedCurrencyWarning?: string | null;
  units?: Record<string, string>;
}

/** Une carte du back-office. Une valeur absente devient son MOTIF, jamais « 0 ». */
export interface AdminMetricCard {
  key: string;
  label: string;
  /** Valeur formatée, prête à afficher. `null` quand la grandeur n'existe pas. */
  value: string | null;
  /** Base ou effectif — un pourcentage sans base n'est pas une information. */
  basis: string;
  /** Ce que la carte MESURE, en une phrase. C'est ce qui manquait. */
  definition: string;
  /** Motif d'indisponibilité, à afficher tel quel. */
  unavailableReason: string | null;
  /** Clé serveur d'origine — traçabilité du chiffre affiché. */
  sourceKey: string;
  /** Drapeau d'alerte SERVI (jamais un seuil recodé ici). */
  alert: boolean;
}

/** Lit `metrics` comme la charge utile de `portfolio_metrics()`. Un endpoint
 *  typé `Record<string, unknown>` n'autorise aucune supposition : tout accès est
 *  optionnel, et l'absence produit un motif plutôt qu'un zéro. */
export function asPortfolioMetrics(raw: unknown): PortfolioMetricsPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as PortfolioMetricsPayload;
}

function amount(n: number | undefined, currency: string): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  return `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${currency}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Les deux taux de défaut — toujours les deux, jamais l'un sans l'autre
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les DEUX taux de défaut servis, chacun avec sa base.
 *
 * Cette fonction est volontairement incapable de n'en rendre qu'un : c'est le
 * choix d'un seul des deux qui produisait deux back-offices en désaccord.
 */
export function buildDefaultRateCards(metrics: PortfolioMetricsPayload | null): AdminMetricCard[] {
  const d = metrics?.defaultRates;
  const devise = metrics?.currency ?? 'USD';
  const alerte = Boolean(d?.alert);

  if (!d) {
    const motif = 'Le serveur n’a pas servi de taux de défaut '
      + '(`defaultRates` absent de `GET /investments/metrics/portfolio`). Aucun taux n’est '
      + 'reconstitué à partir des listes affichées : elles sont paginées, et une moyenne '
      + 'calculée sur une page n’est pas la moyenne de l’institution.';
    return [
      {
        key: 'defaultByValue',
        label: 'Taux de défaut — en valeur',
        value: null,
        basis: 'base non servie',
        definition: 'Part du capital ENCAISSÉ exposée à des projets en défaut (P12).',
        unavailableReason: motif,
        sourceKey: 'defaultRates.byValue',
        alert: false,
      },
      {
        key: 'defaultByCount',
        label: 'Taux de défaut — en nombre',
        value: null,
        basis: 'base non servie',
        definition: 'Part des projets financés qui sont en défaut (P12).',
        unavailableReason: motif,
        sourceKey: 'defaultRates.byCount',
        alert: false,
      },
    ];
  }

  return [
    {
      key: 'defaultByValue',
      label: 'Taux de défaut — en valeur',
      value: formatPercent(rateToPercent(d.byValue, rateUnit(metrics, 'defaultRates.byValue'))),
      basis: `${amount(d.defaultedValue, devise)} sur ${amount(d.totalValue, devise)} encaissés`,
      definition: 'Part du capital ENCAISSÉ exposée à des projets en défaut (P12). '
        + 'C’est la mesure qui dit combien d’argent est en risque.',
      unavailableReason: null,
      sourceKey: 'defaultRates.byValue',
      alert: alerte,
    },
    {
      key: 'defaultByCount',
      label: 'Taux de défaut — en nombre',
      value: formatPercent(rateToPercent(d.byCount, rateUnit(metrics, 'defaultRates.byCount'))),
      basis: `${d.defaultedProjects ?? 0} projet(s) sur ${d.totalProjects ?? 0}`,
      definition: 'Part des projets financés qui sont en défaut (P12). '
        + 'Un projet énorme y pèse autant qu’un petit — à lire avec le taux en valeur.',
      unavailableReason: null,
      sourceKey: 'defaultRates.byCount',
      alert: false,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendement institution — le TRI pondéré servi, pas une moyenne d'offres
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le rendement de l'institution : `weightedIrr`, calculé par le serveur sur les
 * flux datés réels de toutes les souscriptions financées.
 *
 * Il remplace un `Σ couponRate ÷ nombre d'offres` qui n'était ni pondéré, ni
 * réalisé, ni même du rendement — c'était la moyenne des promesses affichées
 * dans le catalogue.
 */
export function buildWeightedReturnCard(metrics: PortfolioMetricsPayload | null): AdminMetricCard {
  const dispo = metrics?.weightedIrr !== null && metrics?.weightedIrr !== undefined;
  const periode = metrics?.period;
  return {
    key: 'weightedIrr',
    label: 'Rendement réalisé — TRI pondéré',
    value: dispo
      ? formatPercent(rateToPercent(metrics?.weightedIrr, rateUnit(metrics, 'weightedIrr')))
      : null,
    basis: periode
      ? `${periode.flowsCount ?? 0} flux daté(s) réel(s), du ${periode.from ?? '—'} au ${periode.to ?? '—'}`
      : 'période non servie',
    definition: 'XIRR sur les flux datés réels de toutes les souscriptions financées : '
      + 'encaissements en sortie, distributions versées en entrée. Aucune projection, '
      + 'et surtout aucune moyenne de coupons promis.',
    unavailableReason: dispo
      ? null
      : metrics?.weightedIrrUnavailableReason
        ?? 'Le TRI pondéré n’est pas calculable sur les flux actuels de l’institution.',
    sourceKey: 'weightedIrr',
    alert: false,
  };
}

/** Les cartes de mesure de l'institution, dans l'ordre où elles se lisent. */
export function buildInstitutionCards(metrics: PortfolioMetricsPayload | null): AdminMetricCard[] {
  return [...buildDefaultRateCards(metrics), buildWeightedReturnCard(metrics)];
}

/** Périmètre et date d'arrêté, à afficher AVEC les cartes : une mesure sans
 *  périmètre ni date n'est pas auditable (§4.6). */
export function scopeNote(metrics: PortfolioMetricsPayload | null): string {
  if (!metrics) return 'Mesures non servies par le serveur.';
  const parties = [
    metrics.scope ? metrics.scope : null,
    metrics.asOf ? `arrêté au ${metrics.asOf}` : null,
    metrics.subscriptionsCount !== undefined
      ? `${metrics.subscriptionsCount} souscription(s) financée(s)` : null,
    metrics.currency ? `devise ${metrics.currency}` : null,
  ].filter(Boolean);
  const base = parties.join(' · ');
  return metrics.mixedCurrencyWarning ? `${base} — ${metrics.mixedCurrencyWarning}` : base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chiffres SAISIS par un analyste — ni calculés, ni mesurés
// ─────────────────────────────────────────────────────────────────────────────

export type AnalystFigureKind = 'percent' | 'ratio';

export interface AnalystFigure {
  /** Valeur formatée, ou `null` quand elle est indistinguable du défaut. */
  value: string | null;
  /** Ce que le chiffre est — saisie d'instruction, pas mesure de performance. */
  provenance: string;
  /** Motif affiché à la place de la valeur. `null` quand une valeur s'affiche. */
  unavailableReason: string | null;
}

/**
 * Lit un champ de `FinancialAnalysis` (marge EBITDA, DSCR, TRI).
 *
 * Ces trois champs sont `DecimalField(default=Decimal("0"))` et non nullables :
 * ils sont **saisis par un analyste** au moment de l'instruction. Un dossier dont
 * l'analyse n'a pas été remplie sort donc à `0`, et l'écran affichait
 * « TRI 0 % » — un rendement nul, c'est-à-dire une information, là où il n'y
 * avait qu'un champ vide.
 *
 * Le serveur ne peut pas lever l'ambiguïté (il n'existe pas de « non renseigné »
 * distinct de zéro dans ce schéma, et `financial_analysis_row` ne sert ni
 * `approved_at` ni `approved_by`). On tranche donc dans le sens qui ne fabrique
 * pas d'information : `0` s'affiche comme NON RENSEIGNÉ, en disant pourquoi.
 * Perdre l'affichage d'un vrai zéro est un moindre mal — un TRI de 0 % sur un
 * dossier instruit est de toute façon un signal à faire corriger, pas une valeur
 * à publier telle quelle.
 *
 * Le mot « TRI » lui-même est trompeur ici : le TRI calculé du module est un
 * XIRR sur flux datés réels (`investments/metrics.py`), pas cette saisie.
 */
export function readAnalystFigure(
  value: number | null | undefined,
  kind: AnalystFigureKind = 'percent',
): AnalystFigure {
  const provenance = 'Saisi par l’analyste à l’instruction du dossier — hypothèse de '
    + 'montage, non mesurée sur des flux réels.';
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return {
      value: null,
      provenance,
      unavailableReason: 'Non servi par le serveur.',
      };
  }
  if (Number(value) === 0) {
    return {
      value: null,
      provenance,
      unavailableReason: 'Non renseigné. Ce champ vaut 0 par défaut en base et n’a pas de '
        + '« vide » distinct : un 0 affiché ici ne se distinguerait pas d’une analyse '
        + 'jamais remplie.',
    };
  }
  const n = Number(value);
  const formate = kind === 'percent'
    ? formatPercent(n)
    : `${new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2, maximumFractionDigits: 3,
    }).format(n)} x`;
  return { value: formate, provenance, unavailableReason: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ce qui n'est pas servi
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le coupon moyen PROMIS n'existe pas à l'échelle de l'institution.
 *
 * `investor_metrics()` sert bien un `expectedCouponRate` pondéré par les
 * montants encaissés — mais sur le seul portefeuille du demandeur.
 * `portfolio_metrics()` n'en porte pas d'équivalent. La moyenne non pondérée que
 * les deux dashboards calculaient n'en était pas une approximation : elle
 * donnait le même poids à une offre de 500 USD et à une offre de 500 000, et
 * comptait les offres jamais financées.
 */
export const AVERAGE_COUPON_GAP: DataGap = {
  key: 'institutionExpectedCoupon',
  title: 'Coupon moyen promis — non servi à l’échelle de l’institution',
  question: 'Quel taux l’institution a-t-elle promis, en moyenne, sur l’argent qu’elle a levé ?',
  whatExists: [
    'Le TRI pondéré RÉALISÉ de l’institution (`weightedIrr`), calculé sur les flux datés '
    + 'réels par `GET /investments/metrics/portfolio`.',
    'Le coupon promis de CHAQUE offre (`couponRate`, en points de pourcentage, servi avec '
    + 'son unité) : le catalogue est lisible offre par offre.',
    '`investor_metrics()` sert déjà un `expectedCouponRate` pondéré par les montants '
    + 'encaissés — mais sur le seul portefeuille du demandeur.',
  ],
  whatIsMissing: [
    'L’équivalent institution de `expectedCouponRate` : une moyenne des coupons figés à la '
    + 'souscription, PONDÉRÉE par les montants encaissés, servie avec son effectif et sa base.',
    'Sans pondération, la moyenne des offres du catalogue n’est pas une approximation du '
    + 'coupon promis : elle donne le même poids à une offre de 500 USD et à une de 500 000, '
    + 'et compte les offres que personne n’a financées.',
  ],
  howItWouldBeFed: [
    'Le calcul existe déjà dans `investor_metrics()` : il reste à l’appliquer à l’ensemble '
    + 'des souscriptions financées plutôt qu’à celles d’un investisseur, comme '
    + '`portfolio_metrics()` le fait déjà pour le défaut et la concentration.',
  ],
  serverContract: [
    'GET /investments/metrics/portfolio — ajouter `expectedCouponRate`, '
    + '`expectedCouponBasis` et `expectedCouponPositions`, avec leur unité dans `units`.',
  ],
};
