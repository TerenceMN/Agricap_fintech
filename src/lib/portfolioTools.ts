/**
 * Gestion de portefeuilles — PROJECTIONS PURES pour les outils de l'écran
 * `Portfolios`, dans la même discipline que `investorSpaceWire.ts` : on
 * sélectionne, on joint, on étiquette, on convertit une unité — **on ne dérive
 * aucun chiffre métier**.
 *
 * Ce fichier existe parce que sept boutons de `Gestion de Portefeuilles`
 * appelaient un `toast` « non disponible ». Trois classes de réponse étaient
 * possibles, et une seule est honnête pour chacun :
 *
 * 1. **Le serveur sert déjà la mesure** — `Risque`, `Alertes`, `Historique`,
 *    `Rapport Global` : on l'affiche avec sa base, son effectif et sa méthode.
 *    Défaut, concentration (Herfindahl), retard et score de santé sont calculés
 *    par `backend/investments/metrics.py` sur le SEUL portefeuille du demandeur,
 *    avec leurs seuils lus en base ; les recomposer ici produirait un second
 *    chiffre pour la même grandeur.
 *
 * 2. **La donnée d'entrée n'existe pas dans l'institution** — `Ind. ESG` et
 *    `Benchmarks` : `Project.impact_esg` est un `TextField` libre (jamais noté,
 *    jamais daté, jamais vérifié) et aucun indice de référence n'est collecté.
 *    L'écran dit précisément CE QUI MANQUE et PAR QUEL MOYEN ce serait alimenté.
 *    Un score ESG fabriqué à partir d'un texte libre serait pire qu'un bouton
 *    inerte : il aurait l'air d'une mesure.
 *
 * 3. **La lecture est possible, l'écriture n'existe pas** — `Rééquilibrer` :
 *    aucune allocation cible n'est stockée côté serveur et aucun endpoint ne
 *    déplace d'argent entre poches. On construit l'écart entre l'allocation
 *    RÉELLEMENT servie et une cible SAISIE, en disant que la cible n'est
 *    enregistrée nulle part — et on n'offre aucun bouton d'exécution.
 *
 * Deux règles d'unité, héritées d'incidents réels de ce projet :
 * l'unité d'un taux se LIT dans `metrics.units` (`rateUnit` / `rateToPercent`),
 * et un pourcentage ne s'affiche jamais sans sa base.
 */
import type {
  InvestmentMovement,
  InvestmentSubscription,
  InvestorMetrics,
} from '@/types/api';
import type { AllocationSlice, AllocationView } from './investorSpaceWire';
import {
  formatPercent,
  movementTypeLabel,
  rateToPercent,
  rateUnit,
  valuationMethodLabel,
} from './investorSpaceWire';
// Formateur UNIQUE des montants du projet (devise, séparateurs). Le réimplémenter
// ici ferait un second « 12 450 $ » qui divergerait du premier au premier
// changement de convention.
import { formatCurrency } from './investorSpaceUtils';

// ─────────────────────────────────────────────────────────────────────────────
// Une ligne de restitution : une valeur ne voyage JAMAIS sans sa base
// ─────────────────────────────────────────────────────────────────────────────

/** Nature de la valeur — le formatage (devise, pourcent) est fait à l'affichage,
 *  par les formateurs uniques du projet, jamais recodé ici. */
export type ReportValueKind = 'amount' | 'percent' | 'index' | 'count' | 'text' | 'date';

export interface ReportRow {
  key: string;
  label: string;
  /** Valeur SERVIE (les taux sont convertis en pourcents d'affichage selon
   *  l'unité déclarée). `null` = la grandeur n'existe pas : `reason` dit
   *  pourquoi, et l'écran affiche le motif, pas un zéro. */
  value: number | string | null;
  kind: ReportValueKind;
  /** Base, effectif ou périmètre de la valeur. Jamais vide : un pourcentage sans
   *  base et une moyenne sans effectif ne sont pas des informations (§4.6). */
  basis: string;
  /** Motif d'indisponibilité, servi par le serveur quand il en fournit un. */
  reason?: string | null;
  /** Chemin de la clé serveur d'origine — traçabilité du chiffre affiché. */
  sourceKey: string;
}

function row(
  key: string,
  label: string,
  value: number | string | null,
  kind: ReportValueKind,
  basis: string,
  sourceKey: string,
  reason: string | null = null,
): ReportRow {
  return { key, label, value, kind, basis, sourceKey, reason };
}

/**
 * Une ligne prête à écrire (écran, PDF, tableur), formatée par les formateurs
 * UNIQUES du projet — jamais par un `toFixed` local.
 *
 * Une valeur absente ne devient pas « 0 » ni « — » : elle devient son MOTIF.
 * C'est la différence entre « vous n'avez rien gagné » et « le rendement n'est
 * pas calculable tant qu'aucune distribution n'a été versée ».
 */
export function formatReportValue(r: ReportRow, currency: string): string {
  if (r.value === null || r.value === '') {
    return r.reason ? `non disponible — ${r.reason}` : 'non disponible';
  }
  if (typeof r.value === 'number') {
    if (r.kind === 'amount') return formatCurrency(r.value, currency);
    if (r.kind === 'percent') return formatPercent(r.value);
  }
  return String(r.value);
}

/** Taux du payload converti en pourcents d'affichage selon l'unité DÉCLARÉE. */
function percentRow(
  metrics: InvestorMetrics,
  key: string,
  label: string,
  path: string,
  value: number | null | undefined,
  basis: string,
): ReportRow {
  return row(key, label, rateToPercent(value, rateUnit(metrics, path)), 'percent', basis, path);
}

// ─────────────────────────────────────────────────────────────────────────────
// Périmètre — le serveur ne mesure RIEN par sous-portefeuille, et on le dit
// ─────────────────────────────────────────────────────────────────────────────

export interface SubPortfolioScope {
  /** Souscriptions rattachées à CE sous-portefeuille (`subPortfolioId`). */
  attachedCount: number;
  /** Souscriptions de l'investisseur, tous sous-portefeuilles confondus. */
  totalCount: number;
  /** Souscriptions rattachées à aucun sous-portefeuille. */
  unassignedCount: number;
  /** Phrase de périmètre, à afficher en tête de chaque outil. */
  note: string;
}

/**
 * Périmètre réel des mesures ouvertes depuis la carte d'un sous-portefeuille.
 *
 * `GET /investments/metrics/mine` agrège TOUTES les souscriptions financées de
 * l'investisseur : il n'existe aucune métrique par sous-portefeuille côté
 * serveur. Afficher ces chiffres sous le titre d'un sous-portefeuille sans le
 * dire laisserait croire qu'ils ne portent que sur lui.
 */
export function describeSubPortfolioScope(
  subscriptions: InvestmentSubscription[],
  subPortfolioId: number | null,
  subPortfolioName: string,
): SubPortfolioScope {
  const totalCount = subscriptions.length;
  const attachedCount = subPortfolioId === null
    ? 0
    : subscriptions.filter((s) => s.subPortfolioId === subPortfolioId).length;
  const unassignedCount = subscriptions.filter((s) => s.subPortfolioId === null).length;
  const note = subPortfolioId === null
    ? `Mesures portant sur l’ensemble de votre portefeuille : ${totalCount} souscription(s).`
    : `Ces mesures portent sur l’ENSEMBLE de votre portefeuille (${totalCount} souscription(s)) : `
      + 'le serveur ne calcule aucune métrique par sous-portefeuille. '
      + `« ${subPortfolioName} » regroupe ${attachedCount} souscription(s), `
      + `et ${unassignedCount} n’est/ne sont rattachée(s) à aucun sous-portefeuille.`;
  return { attachedCount, totalCount, unassignedCount, note };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alertes — aucune n'est inventée : chacune naît d'un DRAPEAU servi
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critique' | 'attention' | 'information';

export interface PortfolioAlert {
  key: string;
  severity: AlertSeverity;
  title: string;
  /** Ce que le serveur CONSTATE, formulé en fait et jamais en jugement (§4.5). */
  statement: string;
  /** Les chiffres du constat, chacun avec sa base. */
  facts: ReportRow[];
  /** Le geste possible ou la question à poser (§4.6). `null` s'il n'y en a pas. */
  action: string | null;
  sourceKey: string;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critique: 0,
  attention: 1,
  information: 2,
};

/**
 * Les alertes du portefeuille, dérivées des seuls drapeaux et motifs SERVIS.
 *
 * Aucun seuil n'est codé ici : `defaultRates.alert`, `concentration.threshold`,
 * `concentration.highConcentration` et les motifs d'indisponibilité viennent du
 * serveur, qui les lit dans `InvestmentConfig` (principe 8 — les règles vivent
 * en base). Un seuil recodé côté navigateur alerterait un jour à un niveau que
 * le comité n'a pas voté.
 */
export function buildPortfolioAlerts(
  metrics: InvestorMetrics,
  allocation?: AllocationView | null,
): PortfolioAlert[] {
  const alerts: PortfolioAlert[] = [];
  const { defaultRates, concentration, lateProjects, health, nextPayment, valuation } = metrics;
  const positions = valuation.positions ?? [];

  // Devise : un agrégat qui additionne des devises sans taux journalisé n'est pas
  // exploitable — c'est la première chose à savoir avant de lire les autres.
  if (metrics.mixedCurrency && metrics.mixedCurrencyWarning) {
    alerts.push({
      key: 'mixedCurrency',
      severity: 'critique',
      title: 'Agrégat multi-devises sans taux de conversion',
      statement: metrics.mixedCurrencyWarning,
      facts: [
        row('currencies', 'Devises observées', metrics.currenciesObserved.join(', '), 'text',
          `Devise de tenue : ${metrics.currency}`, 'currenciesObserved'),
      ],
      action: 'Les montants ci-dessous ne sont pas comparables entre eux tant qu’aucun '
        + 'taux daté n’est journalisé : demandez la conversion à votre gestionnaire.',
      sourceKey: 'mixedCurrencyWarning',
    });
  }

  if (defaultRates.alert) {
    alerts.push({
      key: 'defaultRate',
      severity: 'critique',
      title: 'Taux de défaut au-dessus du seuil d’alerte',
      statement: 'La part en valeur de votre portefeuille exposée à des projets en défaut '
        + 'dépasse le seuil d’alerte paramétré par l’institution.',
      facts: [
        percentRow(metrics, 'byValue', 'Taux de défaut — en valeur', 'defaultRates.byValue',
          defaultRates.byValue,
          `Base : ${formatCurrency(defaultRates.totalValue, metrics.currency)} encaissés`),
        row('defaultedValue', 'Montant exposé au défaut', defaultRates.defaultedValue, 'amount',
          `${defaultRates.defaultedProjects} projet(s) sur ${defaultRates.totalProjects}`,
          'defaultRates.defaultedValue'),
        percentRow(metrics, 'byCount', 'Taux de défaut — en nombre', 'defaultRates.byCount',
          defaultRates.byCount,
          `${defaultRates.defaultedProjects} projet(s) sur ${defaultRates.totalProjects}`),
        percentRow(metrics, 'threshold', 'Seuil d’alerte', 'defaultRates.alertThreshold',
          defaultRates.alertThreshold, 'Paramètre d’institution lu en base, non modifiable ici'),
      ],
      action: 'Ouvrez « Risque » pour voir quelles positions portent ce défaut.',
      sourceKey: 'defaultRates.alert',
    });
  }

  // Le détail par position : un agrégat ne dit jamais QUELLE ligne a décroché.
  for (const p of positions.filter((x) => x.projectStatus === 'P12')) {
    alerts.push({
      key: `default-${p.subscriptionId}`,
      severity: 'critique',
      title: `Projet en défaut — ${p.projectCode}`,
      statement: p.valuationNote,
      facts: [
        row(`settled-${p.subscriptionId}`, 'Encaissé sur cette position', p.settledAmount, 'amount',
          `Offre ${p.offerCode} · ${p.sector} · ${p.location}`,
          'valuation.positions[].settledAmount'),
        row(`outstanding-${p.subscriptionId}`, 'Capital retenu après dépréciation',
          p.capitalOutstanding, 'amount', valuationMethodLabel(p.valuationMethod),
          'valuation.positions[].capitalOutstanding'),
        row(`impairment-${p.subscriptionId}`, 'Perte estimée', p.impairment, 'amount',
          'Capital au pair moins capital retenu', 'valuation.positions[].impairment'),
        row(`recovery-${p.subscriptionId}`, 'Taux de recouvrement retenu',
          rateToPercent(p.recoveryRate, rateUnit(metrics, 'valuation.positions[].recoveryRate')),
          'percent', 'Constaté sur le projet, à défaut provision paramétrée',
          'valuation.positions[].recoveryRate'),
      ],
      action: 'Cette estimation n’est pas une perte définitive : le taux de recouvrement '
        + 'est réévalué à chaque encaissement constaté sur le projet.',
      sourceKey: 'valuation.positions[].projectStatus',
    });
  }

  if (concentration.highConcentration) {
    const axis = concentration.retainedAxis === 'sector' ? 'secteur' : 'géographie';
    alerts.push({
      key: 'concentration',
      severity: 'attention',
      title: `Concentration élevée sur l’axe ${axis}`,
      statement: 'L’indice de Herfindahl retenu dépasse le seuil paramétré : votre capital '
        + 'encaissé est peu réparti sur cet axe.',
      facts: [
        row('hhi', 'Herfindahl retenu', concentration.herfindahlRetained, 'index',
          `${concentration.projectsCount} projet(s), ${concentration.sectorsCount} secteur(s), `
          + `${concentration.locationsCount} zone(s)`, 'concentration.herfindahlRetained'),
        row('threshold', 'Seuil', concentration.threshold, 'index',
          'Paramètre d’institution lu en base', 'concentration.threshold'),
        percentRow(metrics, 'largest', 'Plus grosse exposition',
          'concentration.largestExposureShare', concentration.largestExposureShare,
          `${concentration.largestExposureProject ?? 'aucun engagement'} · base `
          + `${formatCurrency(concentration.basisAmount, metrics.currency)} encaissés`),
      ],
      action: 'Ouvrez « Rééquilibrer » pour comparer votre répartition réelle à une cible.',
      sourceKey: 'concentration.highConcentration',
    });
  }

  if (lateProjects.lateProjects > 0) {
    alerts.push({
      key: 'late',
      severity: 'attention',
      title: 'Échéance(s) de retour dépassée(s)',
      statement: 'Des échéances de retour sont passées sans être payées ni annulées sur des '
        + 'projets de votre portefeuille.',
      facts: [
        percentRow(metrics, 'share', 'Part de projets en retard', 'lateProjects.share',
          lateProjects.share,
          `${lateProjects.lateProjects} sur ${lateProjects.totalProjects} projet(s)`),
        row('coverage', 'Projets dotés d’un échéancier', lateProjects.projectsWithSchedule, 'count',
          `sur ${lateProjects.totalProjects} projet(s) du portefeuille`,
          'lateProjects.projectsWithSchedule'),
      ],
      action: 'Le retard est constaté sur les dates d’échéance, pas sur un statut déclaré.',
      sourceKey: 'lateProjects.lateProjects',
    });
  }

  if (allocation?.reconciliationWarning) {
    alerts.push({
      key: 'reconciliation',
      severity: 'attention',
      title: 'Rapprochement : deux « investi » possibles',
      statement: allocation.reconciliationWarning,
      facts: [],
      action: 'Le montant encaissé (rapprochable d’une pièce) est la seule grandeur qui vaut '
        + '« investi ». Signalez l’écart à votre gestionnaire.',
      sourceKey: 'portfolioAllocation.reconciliationWarning',
    });
  }

  if (lateProjects.scheduleCoverageWarning) {
    alerts.push({
      key: 'scheduleCoverage',
      severity: 'information',
      title: 'Mesure du retard partielle',
      statement: lateProjects.scheduleCoverageWarning,
      facts: [],
      action: null,
      sourceKey: 'lateProjects.scheduleCoverageWarning',
    });
  }

  if (nextPayment.unavailableReason) {
    alerts.push({
      key: 'nextPayment',
      severity: 'information',
      title: 'Date du prochain paiement non établissable',
      statement: nextPayment.unavailableReason,
      facts: [
        row('offers', 'Offres dotées d’un échéancier', nextPayment.offersWithSchedule, 'count',
          `sur ${nextPayment.offersCount} offre(s) de votre portefeuille`,
          'nextPayment.offersWithSchedule'),
      ],
      action: null,
      sourceKey: 'nextPayment.unavailableReason',
    });
  }

  if (metrics.realizedReturn === null && metrics.realizedReturnUnavailableReason) {
    alerts.push({
      key: 'realizedReturn',
      severity: 'information',
      title: 'Rendement réalisé non calculable',
      statement: metrics.realizedReturnUnavailableReason,
      facts: [
        row('flows', 'Flux datés réels pris en compte', metrics.period.flowsCount, 'count',
          metrics.period.basis, 'period.flowsCount'),
      ],
      action: null,
      sourceKey: 'realizedReturnUnavailableReason',
    });
  }

  const sansExpertise = positions.filter((p) => p.valuationMethod === 'PAIR_FAUTE_D_EXPERTISE');
  if (sansExpertise.length > 0) {
    alerts.push({
      key: 'noExpertValuation',
      severity: 'information',
      title: `${sansExpertise.length} titre(s) de capital valorisé(s) au pair`,
      statement: 'Aucune valorisation d’expert datée et valide n’est enregistrée sur ces '
        + 'projets : ils sont retenus à leur prix de souscription, ce qui n’est pas une '
        + 'estimation de ce qu’ils valent aujourd’hui.',
      facts: sansExpertise.map((p) => row(
        `par-${p.subscriptionId}`, p.projectCode, p.capitalOutstanding, 'amount',
        p.valuationNote, 'valuation.positions[].valuationMethod',
      )),
      action: null,
      sourceKey: 'valuation.positions[].valuationMethod',
    });
  }

  if (health.clamped) {
    alerts.push({
      key: 'healthClamped',
      severity: 'information',
      title: 'Score de santé ramené dans ses bornes',
      statement: `Le score brut calculé est de ${health.rawScore} : il est affiché ramené `
        + 'dans l’intervalle [0, 100].',
      facts: [
        row('raw', 'Score brut', health.rawScore, 'index', health.formula, 'health.rawScore'),
        row('score', 'Score affiché', health.score, 'index', 'Borné à [0, 100]', 'health.score'),
      ],
      action: null,
      sourceKey: 'health.clamped',
    });
  }

  return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/**
 * Ce qui est SURVEILLÉ, avec sa valeur courante et son seuil servi.
 *
 * Une page d'alertes vide ne doit pas être une page blanche : sans cette liste,
 * « aucune alerte » ne dit pas si le portefeuille va bien ou si rien n'est
 * mesuré. Les deux se ressemblent à l'écran et ne se ressemblent pas du tout.
 */
export function buildSurveillanceRows(metrics: InvestorMetrics): ReportRow[] {
  const { defaultRates, concentration, lateProjects, health } = metrics;
  return [
    percentRow(metrics, 'defaultByValue', 'Taux de défaut — en valeur', 'defaultRates.byValue',
      defaultRates.byValue,
      'Seuil d’alerte servi : '
      + formatPercent(rateToPercent(defaultRates.alertThreshold,
        rateUnit(metrics, 'defaultRates.alertThreshold')))
      + ` · base ${formatCurrency(defaultRates.totalValue, metrics.currency)} encaissés`),
    row('hhi', 'Concentration (Herfindahl retenu)', concentration.herfindahlRetained, 'index',
      `Seuil servi : ${concentration.threshold} · axe retenu : `
      + `${concentration.retainedAxis === 'sector' ? 'secteur' : 'géographie'}`,
      'concentration.herfindahlRetained'),
    percentRow(metrics, 'late', 'Part de projets en retard', 'lateProjects.share',
      lateProjects.share, `${lateProjects.lateProjects} sur ${lateProjects.totalProjects} projet(s)`),
    row('health', 'Score de santé', health.score, 'index', health.formula, 'health.score'),
    row('positions', 'Positions financées suivies', metrics.positionsCount, 'count',
      `Arrêté au ${metrics.asOf} · ${metrics.scope}`, 'positionsCount'),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Rééquilibrage — lecture seule, cible SAISIE, aucune exécution possible
// ─────────────────────────────────────────────────────────────────────────────

export interface RebalanceRow {
  key: string;
  name: string;
  basis: AllocationSlice['basis'];
  note: string;
  currentAmount: number;
  /** Part actuelle en pourcents. `null` quand le portefeuille est vide. */
  currentSharePercent: number | null;
  /** Cible SAISIE par l'investisseur, en pourcents. `null` si non saisie. */
  targetSharePercent: number | null;
  /** Écart cible − actuel, en POINTS de pourcentage. `null` si non exploitable. */
  gapPoints: number | null;
  /** Montant théorique de l'écart. Positif = poche à renforcer. */
  gapAmount: number | null;
}

export interface RebalanceView {
  rows: RebalanceRow[];
  total: number;
  /** Somme des cibles saisies, en pourcents. */
  targetsTotalPercent: number;
  targetsEntered: boolean;
  /** Vrai quand la somme des cibles vaut 100 % à 0,01 point près. */
  targetsComplete: boolean;
  /** Ce qui empêche d'afficher les écarts, `null` quand ils sont affichés. */
  warning: string | null;
}

/** Tolérance sur la somme des cibles : 100 % à un centième de point près. */
const TARGET_TOLERANCE = 0.01;

/**
 * Écart entre l'allocation RÉELLE (servie) et une cible SAISIE.
 *
 * Trois choses que cette fonction ne fait pas, et qui sont le cœur du sujet :
 *
 * - elle n'invente pas de cible : sans saisie, aucun écart n'est produit. Aucune
 *   allocation cible n'existe côté serveur, ni sur `SubPortfolio` ni ailleurs ;
 * - elle refuse de calculer un écart quand la somme des cibles ne fait pas
 *   100 % : un écart mesuré sur une base incomplète est faux, et il aurait
 *   l'air juste ;
 * - elle ne produit aucun ordre. Déplacer de l'argent entre poches exigerait un
 *   endpoint qui n'existe pas — un bouton « Exécuter » serait un mensonge.
 */
export function buildRebalanceView(
  allocation: AllocationView,
  targets: Record<string, number | null | undefined>,
): RebalanceView {
  const total = allocation.total;
  const saisies = allocation.slices
    .map((s) => targets[s.name])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const targetsTotalPercent = saisies.reduce((sum, v) => sum + v, 0);
  const targetsEntered = saisies.length > 0;
  const targetsComplete = targetsEntered
    && Math.abs(targetsTotalPercent - 100) <= TARGET_TOLERANCE;

  let warning: string | null = null;
  if (total <= 0) {
    warning = 'Votre portefeuille ne porte encore aucun actif valorisé : il n’y a pas de '
      + 'répartition réelle à comparer à une cible.';
  } else if (!targetsEntered) {
    warning = 'Saisissez une cible par poche pour voir l’écart. Aucune allocation cible n’est '
      + 'enregistrée côté serveur : ce que vous saisissez ici n’est ni conservé ni transmis.';
  } else if (!targetsComplete) {
    warning = `La somme de vos cibles est de ${targetsTotalPercent.toFixed(2).replace('.', ',')} %. `
      + 'Tant qu’elle ne fait pas 100 %, aucun écart n’est affiché : un écart mesuré sur une '
      + 'base incomplète serait faux tout en ayant l’air juste.';
  }

  const exploitable = total > 0 && targetsComplete;
  const rows: RebalanceRow[] = allocation.slices.map((s) => {
    const cible = targets[s.name];
    const target = typeof cible === 'number' && Number.isFinite(cible) ? cible : null;
    const currentSharePercent = total > 0 ? (s.value / total) * 100 : null;
    return {
      key: s.name,
      name: s.name,
      basis: s.basis,
      note: s.note,
      currentAmount: s.value,
      currentSharePercent,
      targetSharePercent: target,
      gapPoints: exploitable && target !== null && currentSharePercent !== null
        ? target - currentSharePercent
        : null,
      gapAmount: exploitable && target !== null
        ? (target / 100) * total - s.value
        : null,
    };
  });

  return { rows, total, targetsTotalPercent, targetsEntered, targetsComplete, warning };
}

/** Contrat serveur absent, énoncé à l'écran plutôt que caché dans un rapport. */
export const REBALANCE_MISSING_CONTRACT: DataGap = {
  key: 'rebalance',
  title: 'Rééquilibrage — la lecture existe, l’exécution n’existe pas',
  question: 'Mon portefeuille s’écarte-t-il de l’allocation que je vise, et puis-je le corriger ?',
  whatExists: [
    '`GET /investments/portfolio-allocation` sert la répartition RÉELLE, ventilée par nature '
    + '(souscriptions encaissées, positions obligataires déclarées, cash, actions).',
    'L’écart à une cible que vous saisissez ci-dessus est donc lisible, poche par poche.',
  ],
  whatIsMissing: [
    'Aucune allocation cible n’est stockée : ni sur `SubPortfolio` (qui ne porte que `name` et '
    + '`description`), ni sur `Investor`, ni ailleurs. Une cible saisie ici disparaît au '
    + 'rechargement de la page — elle n’est volontairement pas conservée dans le navigateur, '
    + 'où elle deviendrait une donnée métier hors base.',
    'Aucun endpoint ne déplace d’argent entre poches. Un rééquilibrage réel se ferait par '
    + 'souscription et par retrait, chacun avec son contrôle et sa journalisation.',
  ],
  howItWouldBeFed: [
    'Une cible par sous-portefeuille, saisie une fois et versionnée (append-only), avec son '
    + 'auteur et sa date — comme toute règle qui engage une décision.',
    'Un ordre de rééquilibrage instruit comme une souscription : contrôle de solde, réservation, '
    + 'encaissement, journal — jamais un bouton qui déplace en un clic.',
  ],
  serverContract: [
    'GET/PUT /investments/sub-portfolios/<id>/target-allocation — cible par poche, versionnée, '
    + 'somme contrôlée à 100 % côté serveur.',
    'GET /investments/sub-portfolios/<id>/allocation — répartition réelle PAR sous-portefeuille '
    + '(aujourd’hui l’allocation n’est servie qu’au niveau investisseur).',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Ce qui manque VRAIMENT — donnée absente, pas écran absent
// ─────────────────────────────────────────────────────────────────────────────

export interface DataGap {
  key: string;
  title: string;
  /** La question à laquelle l'écran devrait répondre. */
  question: string;
  /** Ce que le serveur sert AUJOURD'HUI, nommé précisément. */
  whatExists: string[];
  /** La donnée manquante, nommée — pas « des données ». */
  whatIsMissing: string[];
  /** Par quel moyen elle serait alimentée, dans les mécanismes du projet. */
  howItWouldBeFed: string[];
  /** Le contrat serveur qu'il faudrait créer. */
  serverContract: string[];
}

/**
 * ESG — la seule donnée d'entrée existante est un texte libre.
 *
 * `investments.Project.impact_esg` est un `TextField(blank=True)` servi par
 * `project_detail_row` sous la clé `impactEsg`. Ce n'est pas un score : pas
 * d'échelle, pas de critères, pas de date de collecte, pas de source, pas de
 * vérification. En dériver une note reviendrait à noter un paragraphe.
 */
export const ESG_GAP: DataGap = {
  key: 'esg',
  title: 'Indicateurs ESG — la donnée d’entrée n’existe pas encore',
  question: 'Quel est l’impact environnemental, social et de gouvernance des projets '
    + 'que je finance, et comment se compare-t-il d’un projet à l’autre ?',
  whatExists: [
    '`Project.impact_esg` — un champ TEXTE LIBRE, rempli par l’équipe d’instruction et servi '
    + 'par `GET /investments/projects/<code>` sous la clé `impactEsg`. Il décrit une intention '
    + 'ou un effet attendu, en prose.',
    'Le secteur et la localisation de chaque projet financé, servis avec chaque position '
    + '(`valuation.positions[].sector` / `.location`).',
  ],
  whatIsMissing: [
    'Des critères ESG identifiés, avec leur unité de mesure (tonnes de CO₂e, emplois créés, '
    + 'part de femmes bénéficiaires, hectares en agroécologie…). Aucun n’est modélisé.',
    'Une échelle de notation et une pondération votées par le comité — sans elles, deux projets '
    + 'ne sont pas comparables.',
    'La date de collecte, la source et la vérification de chaque valeur. Un chiffre d’impact '
    + 'non daté et non vérifié ne vaut pas plus qu’un texte.',
    'Une couverture mesurée : combien de projets financés portent réellement la donnée. Un score '
    + 'moyen sur 3 projets renseignés sur 20 serait un chiffre trompeur.',
  ],
  howItWouldBeFed: [
    'Une grille de critères ESG versionnée en maker-checker, comme les filières `ValueChain` : '
    + 'un référentiel activé par un checker différent du maker, jamais des seuils en dur.',
    'Une saisie à l’instruction (due diligence, P03) avec pièce jointe probante, puis une '
    + 'vérification terrain — le mécanisme existe déjà pour les actifs gageables '
    + '(déclaré → vérifié par agent → valeur retenue).',
    'Une actualisation au rythme des rapports de performance du projet, chaque valeur portant '
    + 'sa date : un impact se constate dans le temps, il ne se déclare pas une fois.',
  ],
  serverContract: [
    'Un modèle `EsgCriterion` (référentiel versionné : code, libellé, unité, sens d’amélioration, '
    + 'poids) et un modèle `ProjectEsgMeasure` (projet, critère, valeur, date de collecte, source, '
    + 'vérificateur, pièce jointe) — append-only.',
    'GET /investments/projects/<code>/esg — les mesures datées d’un projet, avec leur source.',
    'GET /investments/metrics/mine — un bloc `esg` agrégé sur les seules positions de '
    + 'l’investisseur, pondéré par les montants ENCAISSÉS, servi avec son effectif et son taux '
    + 'de couverture, comme les autres agrégats de l’annexe D.',
  ],
};

/**
 * Benchmarks — aucun indice de référence n'est collecté, nulle part.
 *
 * Comparer un rendement à « un marché » suppose une série de référence datée,
 * de même devise et de même horizon. Le module n'en stocke aucune : il n'y a ni
 * modèle, ni endpoint, ni import. Une comparaison à une moyenne interne (par
 * exemple `portfolio_metrics()`) n'est pas un benchmark — et cette vue est de
 * toute façon refusée en 403 à un client, à juste titre.
 */
export const BENCHMARK_GAP: DataGap = {
  key: 'benchmarks',
  title: 'Benchmarks — aucun indice de référence n’est collecté',
  question: 'Mon rendement est-il bon ou mauvais comparé à une référence de marché ?',
  whatExists: [
    'Votre rendement RÉALISÉ (XIRR sur vos flux datés réels) et votre rendement ATTENDU '
    + '(moyenne des coupons contractuels pondérée par les montants encaissés), servis par '
    + '`GET /investments/metrics/mine` avec leur période et leur effectif.',
    'Le taux de coupon contractuel de chaque offre ouverte (`GET /investments/offers/open`), '
    + 'qui permet de situer une nouvelle souscription parmi les offres du moment — pas parmi '
    + 'un marché.',
  ],
  whatIsMissing: [
    'Toute série de référence datée : indice obligataire, taux directeur BCC, inflation RDC, '
    + 'rendement moyen d’un panier comparable. Aucun modèle ne les stocke, aucun import ne les '
    + 'alimente.',
    'La devise et l’horizon de la référence. Comparer un rendement en USD à un indice en CDF, '
    + 'ou un portefeuille de 8 mois à un indice annuel, produit un écart qui ne veut rien dire.',
    'Un effectif de pairs suffisant pour un comparatif interne (la boucle d’apprentissage du '
    + 'projet exige N ≥ 30 avant de traiter une statistique comme une référence).',
  ],
  howItWouldBeFed: [
    'Un import périodique de séries publiques (BCC, INS) versionné comme les référentiels : '
    + 'chaque point porte sa date, sa source et sa devise.',
    'À défaut d’indice externe, une référence INTERNE explicitement nommée comme telle — '
    + 'rendement médian des offres clôturées d’une même filière, publiée seulement au-delà de '
    + '30 dossiers, avec sa fiabilité annoncée.',
  ],
  serverContract: [
    'Un modèle `BenchmarkSeries` (code, libellé, devise, fréquence, source, licence) et '
    + '`BenchmarkPoint` (série, date, valeur) — import versionné, jamais de saisie libre.',
    'GET /investments/benchmarks?from=&to= — les séries publiables, avec leur source.',
    'GET /investments/metrics/mine — un bloc `benchmark` alignant la période RÉELLE du '
    + 'portefeuille sur la série, avec l’écart et la mention explicite de l’horizon comparé.',
  ],
};

export const DATA_GAPS: Record<string, DataGap> = {
  esg: ESG_GAP,
  benchmarks: BENCHMARK_GAP,
  rebalance: REBALANCE_MISSING_CONTRACT,
};

// ─────────────────────────────────────────────────────────────────────────────
// Historique — les mouvements servis, sans un total inventé
// ─────────────────────────────────────────────────────────────────────────────

/** Borne SERVEUR de `GET /investments/movements` (`views.movements`, `qs[:500]`).
 *  La réponse ne porte pas de `total_rows` : une liste pleine à ras bord est
 *  peut-être tronquée, et l'écran doit le dire (§4.6). */
export const MOVEMENTS_SERVER_LIMIT = 500;

export interface MovementRow {
  id: number;
  dateTime: string;
  type: string;
  typeLabel: string;
  amount: number;
  currency: string;
  status: string;
  geographicZone: string;
}

/** Mouvements servis, du plus récent au plus ancien, filtrés par type au besoin.
 *  Aucun montant n'est additionné : les totaux existent déjà côté serveur
 *  (`totalSettled`, `totalDistributed`…) et en recomposer un ici garantirait
 *  qu'un jour deux écrans affichent deux totaux différents. */
export function buildMovementRows(
  movements: InvestmentMovement[],
  options: { type?: string | null } = {},
): MovementRow[] {
  const { type } = options;
  return movements
    .filter((m) => !type || m.type === type)
    .slice()
    .sort((a, b) => (b.dateTime ?? '').localeCompare(a.dateTime ?? ''))
    .map((m) => ({
      id: m.id,
      dateTime: m.dateTime,
      type: m.type,
      typeLabel: movementTypeLabel(m.type),
      amount: m.amount,
      currency: m.currency,
      status: m.status,
      geographicZone: m.geographicZone,
    }));
}

/** Effectif par type — un COMPTAGE de lignes, pas une agrégation de montants. */
export function countMovementsByType(
  movements: InvestmentMovement[],
): Array<{ type: string; label: string; count: number }> {
  const buckets = new Map<string, number>();
  for (const m of movements) buckets.set(m.type, (buckets.get(m.type) ?? 0) + 1);
  return [...buckets.entries()]
    .map(([type, count]) => ({ type, label: movementTypeLabel(type), count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/** Avertissement de troncature quand la réponse atteint la borne serveur. */
export function movementsTruncationNote(movements: InvestmentMovement[]): string | null {
  if (movements.length < MOVEMENTS_SERVER_LIMIT) return null;
  return `Le serveur borne cette liste à ${MOVEMENTS_SERVER_LIMIT} mouvements et n’annonce pas `
    + 'le nombre total : votre historique est probablement plus long que ce qui est affiché. '
    + 'Une pagination avec `total_rows` reste à ajouter côté serveur.';
}

/** Devises réellement observées dans les mouvements — plusieurs = rien à sommer. */
export function movementCurrencies(movements: InvestmentMovement[]): string[] {
  return [...new Set(movements.map((m) => m.currency).filter(Boolean))].sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Rapport global — la photo du portefeuille, chaque ligne avec sa provenance
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportSection {
  key: string;
  title: string;
  note: string | null;
  rows: ReportRow[];
}

export interface GlobalReport {
  title: string;
  asOf: string;
  scope: string;
  currency: string;
  period: InvestorMetrics['period'];
  sections: ReportSection[];
  /** Les réserves de lecture, à imprimer AVEC les chiffres et non en annexe. */
  disclaimers: string[];
}

/**
 * Le rapport global : rien d'autre que ce que le serveur a servi, remis dans
 * l'ordre où un investisseur le lit, chaque ligne avec sa base et sa clé
 * d'origine.
 *
 * Trois grandeurs ne se confondent jamais et sont donc dans trois sections
 * différentes : ce qui est SORTI de la poche (encaissé), ce que les positions
 * VALENT (dont un gain latent étiqueté latent) et ce qui a été REÇU (distribué).
 */
export function buildGlobalReport(input: {
  metrics: InvestorMetrics;
  allocation: AllocationView;
  subPortfoliosCount: number;
  subscriptionsCount: number;
}): GlobalReport {
  const { metrics, allocation, subPortfoliosCount, subscriptionsCount } = input;
  const { valuation, defaultRates, concentration, lateProjects, health, nextPayment } = metrics;
  const devise = metrics.currency;

  const sections: ReportSection[] = [
    {
      key: 'engagement',
      title: 'Ce que vous avez engagé',
      note: 'Seul l’encaissé se rapproche d’une pièce comptable : une réservation n’est pas '
        + 'un placement.',
      rows: [
        row('totalSettled', 'Total encaissé', metrics.totalSettled, 'amount',
          `${metrics.positionsCount} position(s) financée(s), en ${devise}`, 'totalSettled'),
        row('totalRefunded', 'Souscriptions remboursées', metrics.totalRefunded, 'amount',
          'Montants rendus avant terme', 'totalRefunded'),
        row('totalInvested', 'Investi net', metrics.totalInvested, 'amount',
          'Encaissé moins remboursé', 'totalInvested'),
        row('totalDistributed', 'Distributions reçues', metrics.totalDistributed, 'amount',
          'Coupons et remboursements de capital réellement versés', 'totalDistributed'),
      ],
    },
    {
      key: 'valorisation',
      title: 'Ce que vos positions valent',
      note: valuation.method,
      rows: [
        row('capitalOutstanding', 'Capital restant dû', valuation.capitalOutstanding, 'amount',
          `${valuation.positionsCount} position(s)`, 'valuation.capitalOutstanding'),
        row('latentGain', 'Gain latent — NON encaissé', valuation.latentGain, 'amount',
          'Valorisation : peut ne jamais être encaissé, et peut être négatif',
          'valuation.latentGain'),
        row('totalValue', 'Valeur totale', valuation.totalValue, 'amount',
          'Capital restant dû + gain latent, borné à zéro', 'valuation.totalValue'),
        ...Object.entries(valuation.byMethod).map(([methode, v]) => row(
          `method-${methode}`, `Dont ${valuationMethodLabel(methode)}`, v.amount, 'amount',
          `${v.positionsCount} position(s)`, 'valuation.byMethod',
        )),
      ],
    },
    {
      key: 'rendements',
      title: 'Vos rendements — trois grandeurs, jamais un chiffre unique',
      note: 'Le réalisé est encaissé, le latent ne l’est pas, l’attendu est une promesse '
        + 'contractuelle. Les additionner n’aurait aucun sens.',
      rows: [
        percentRow(metrics, 'realized', 'Rendement réalisé (XIRR)', 'realizedReturn',
          metrics.realizedReturn,
          `${metrics.period.flowsCount} flux daté(s) réel(s), du ${metrics.period.from ?? '—'} `
          + `au ${metrics.period.to}`),
        percentRow(metrics, 'expected', 'Rendement attendu (coupon contractuel)',
          'expectedCouponRate', metrics.expectedCouponRate,
          `Pondéré par ${formatCurrency(metrics.expectedCouponBasis, devise)} encaissés sur `
          + `${metrics.expectedCouponPositions} position(s)`),
      ].map((r) => (r.key === 'realized' && metrics.realizedReturn === null
        ? { ...r, reason: metrics.realizedReturnUnavailableReason }
        : r)),
    },
    {
      key: 'risque',
      title: 'Le risque, tel que le serveur le mesure',
      note: `Score de santé : ${health.formula} — avec a = ${health.parameters.a}, `
        + `b = ${health.parameters.b}, c = ${health.parameters.c}, h₀ = ${health.parameters.h0}, `
        + 'paramètres lus en base et réellement appliqués.',
      rows: [
        percentRow(metrics, 'defaultByValue', 'Taux de défaut — en valeur',
          'defaultRates.byValue', defaultRates.byValue,
          `${formatCurrency(defaultRates.defaultedValue, devise)} sur `
          + `${formatCurrency(defaultRates.totalValue, devise)} encaissés`),
        percentRow(metrics, 'defaultByCount', 'Taux de défaut — en nombre',
          'defaultRates.byCount', defaultRates.byCount,
          `${defaultRates.defaultedProjects} projet(s) sur ${defaultRates.totalProjects}`),
        row('hhi', 'Concentration (Herfindahl retenu)', concentration.herfindahlRetained, 'index',
          `Axe ${concentration.retainedAxis === 'sector' ? 'secteur' : 'géographie'} · seuil `
          + `${concentration.threshold} · ${concentration.sectorsCount} secteur(s), `
          + `${concentration.locationsCount} zone(s)`, 'concentration.herfindahlRetained'),
        percentRow(metrics, 'largest', 'Plus grosse exposition',
          'concentration.largestExposureShare', concentration.largestExposureShare,
          `${concentration.largestExposureProject ?? '—'} · base `
          + `${formatCurrency(concentration.basisAmount, devise)} encaissés`),
        percentRow(metrics, 'late', 'Part de projets en retard', 'lateProjects.share',
          lateProjects.share,
          `${lateProjects.lateProjects} sur ${lateProjects.totalProjects} projet(s), dont `
          + `${lateProjects.projectsWithSchedule} doté(s) d’un échéancier`),
        row('health', 'Score de santé', health.score, 'index',
          `Pénalités : défaut −${health.penalties.default}, concentration `
          + `−${health.penalties.concentration}, retard −${health.penalties.late}`, 'health.score'),
        row('nextPayment', 'Prochain paiement attendu', nextPayment.nextPaymentDate, 'date',
          nextPayment.nextPaymentSource
            ? `Source : ${nextPayment.nextPaymentSource} · ${nextPayment.upcomingCount} échéance(s) à venir`
            : 'Aucune source disponible',
          'nextPayment.nextPaymentDate', nextPayment.unavailableReason),
      ],
    },
    {
      key: 'repartition',
      title: 'Répartition de vos actifs',
      note: allocation.reconciliationWarning
        ?? 'Parts de même nature séparées : l’encaissé ne se mélange pas au déclaré.',
      rows: [
        ...allocation.slices.map((s) => row(
          `slice-${s.name}`, s.name, s.value, 'amount', s.note, 'portfolioAllocation',
        )),
        row('allocTotal', 'Total', allocation.total, 'amount',
          `${allocation.slices.length} poche(s) non vide(s)`, 'portfolioAllocation'),
      ],
    },
    {
      key: 'organisation',
      title: 'Organisation de votre portefeuille',
      note: 'Aucune métrique n’est calculée par sous-portefeuille : les sous-portefeuilles '
        + 'organisent l’affichage, ils ne segmentent pas la mesure.',
      rows: [
        row('subPortfolios', 'Sous-portefeuilles', subPortfoliosCount, 'count',
          'Créés par vous', 'subPortfolios'),
        row('subscriptions', 'Souscriptions', subscriptionsCount, 'count',
          'Toutes natures et tous statuts', 'subscriptions.mine'),
      ],
    },
  ];

  return {
    title: 'Rapport global de portefeuille',
    asOf: metrics.asOf,
    scope: metrics.scope,
    currency: devise,
    period: metrics.period,
    sections,
    disclaimers: [
      `Arrêté au ${metrics.asOf}. Périmètre : ${metrics.scope}`,
      `Période réellement couverte par les flux : du ${metrics.period.from ?? '—'} au `
      + `${metrics.period.to} (${metrics.period.flowsCount} flux). ${metrics.period.basis}`,
      'Le gain latent n’est pas encaissé et peut ne jamais l’être ; il peut aussi être négatif.',
      metrics.mixedCurrencyWarning
        ?? `Tous les montants sont en ${devise} ; aucune conversion n’a été appliquée.`,
      'Ce rapport ne contient ni score ESG ni comparaison à un indice de référence : ces '
      + 'données ne sont pas collectées par l’institution (voir les onglets « Ind. ESG » et '
      + '« Benchmarks »).',
    ],
  };
}

/** Le rapport mis à plat pour un export tabulaire (PDF, tableur).
 *  `source` voyage avec chaque ligne : un rapport imprimé doit rester
 *  reconstituable — on doit pouvoir retrouver la clé serveur d'un chiffre lu
 *  sur papier deux ans plus tard. */
export function flattenReport(report: GlobalReport): Array<{
  section: string; label: string; value: string; basis: string; source: string;
}> {
  return report.sections.flatMap((s) => s.rows.map((r) => ({
    section: s.title,
    label: r.label,
    value: formatReportValue(r, report.currency),
    basis: r.basis,
    source: r.sourceKey,
  })));
}
