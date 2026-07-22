/**
 * Espace investisseur — PROJECTIONS PURES des réponses serveur vers l'écran.
 *
 * Une seule règle tient ce fichier : **rien ici ne calcule un chiffre métier.**
 * On sélectionne, on joint, on étiquette, on convertit une unité — jamais on ne
 * dérive un rendement, une concentration ou une perte. Ces grandeurs vivent dans
 * `backend/investments/metrics.py` (annexe D) et arrivent déjà calculées ; les
 * recomposer côté navigateur produirait, tôt ou tard, deux chiffres différents
 * pour la même grandeur sur deux écrans — ce que le principe 11 nomme un
 * incident de données, pas une divergence d'affichage.
 *
 * Trois points méritent d'être lus avant de modifier quoi que ce soit :
 *
 * 1. **Trois colonnes de rendement, jamais un chiffre unique.** Réalisé (XIRR sur
 *    flux encaissés), latent (valorisation, toujours étiquetée latente avec sa
 *    méthode) et attendu (promesse contractuelle) sont trois grandeurs de nature
 *    différente. Les additionner ou n'en montrer qu'une est l'anti-modèle.
 *
 * 2. **L'unité d'un taux se LIT, elle ne se devine pas.** Le serveur a servi un
 *    temps deux conventions dans la même réponse (XIRR en fraction,
 *    `expectedCouponRate` en points de pourcentage) ; il n'en sert plus qu'une et
 *    la déclare champ par champ dans `metrics.units`. On lit ce dictionnaire —
 *    coder « fraction » en dur reviendrait à réintroduire le pari qui vient
 *    d'être supprimé, et à afficher « 0,09 % » ou « 1 250 % » au premier
 *    changement. Attention : `GET /investments/offers/open` reste, lui, en points
 *    de pourcentage et ne porte pas de `units` — deux endpoints, deux conventions.
 *
 * 3. **Asymétrie d'information.** Un investisseur voit SON argent et les offres
 *    OUVERTES. `buildPositions` refuse toute souscription qui n'est pas la sienne
 *    et le signale (`foreignRowsRejected`) : le serveur filtre déjà, mais un
 *    front qui affiche aveuglément ce qu'on lui donne transforme la moindre
 *    régression serveur en fuite. Le pipeline P01→P05 ne sort qu'en compteurs.
 */
import type {
  ExposureLine,
  InvestmentMovement,
  InvestmentOffer,
  InvestmentPipeline,
  InvestmentPipelineStage,
  InvestmentProject,
  InvestmentSubscription,
  InvestorMetrics,
  OpenOfferSummary,
  ValuationPosition,
} from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────────
// Nomenclatures — le backend définit les codes, le front ne fait que traduire
// ─────────────────────────────────────────────────────────────────────────────

/** `investments.Project.Status` — libellés servis par le serveur, recopiés pour
 *  l'affichage local. Un code inconnu s'affiche TEL QUEL : deviner un libellé
 *  pour un statut ajouté côté serveur ferait lire au client autre chose que ce
 *  que le dossier dit. */
export const PROJECT_STATUS_LABELS: Record<string, string> = {
  P01: 'Prospection',
  P02: 'Analyse initiale',
  P03: 'Due diligence',
  P04: "Comité d'investissement",
  P05: 'Approbation conditionnelle',
  P06: 'Levée de fonds',
  P07: 'Souscription clôturée',
  P08: 'Décaissement',
  P09: 'En cours',
  P10: 'Remboursement',
  P11: 'Clôturé',
  P12: 'Défaut',
  P13: 'Annulé',
};

/** Statut qui déclenche l'information immédiate des investisseurs concernés. */
export const DEFAULT_PROJECT_STATUS = 'P12';

export const PROJECT_STATUS_CLASSES: Record<string, string> = {
  P06: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  P07: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  P08: 'bg-green-500/20 text-green-400 border-green-500/30',
  P09: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  P10: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  P11: 'bg-green-600/20 text-green-400 border-green-600/30',
  P12: 'bg-red-500/20 text-red-400 border-red-500/30',
  P13: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

/** `investments.Offer.TypeOfTitle` — la typologie dette / capital, reprise de
 *  l'écran `Investments` supprimé. Elle change la lecture du rendement : un
 *  coupon obligataire est contractuel, un rendement d'action ne l'est pas. */
export const TITLE_TYPE_LABELS: Record<string, string> = {
  OBLIGATION: 'Dette — obligation',
  ACTION: 'Capital — action',
  PART_SOCIALE: 'Capital — part sociale',
};

/** `investments.Subscription.Status` — les dix états servis, libellés à
 *  l'identique du serveur. « Réservée » et « Encaissée » ne se confondent pas :
 *  la première est une intention, la seconde de l'argent reçu. */
export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  RESERVED: 'Réservée (non encaissée)',
  WAITLISTED: "Liste d'attente",
  SETTLED: 'Encaissée',
  PENDING: 'En attente (hérité)',
  ACTIVE: 'Actif',
  REPAYMENT: 'Remboursement',
  COMPLETED: 'Terminé',
  DEFAULTED: 'Défaut',
  REFUNDED: 'Remboursée',
  CANCELLED: 'Annulé',
};

export const SUBSCRIPTION_STATUS_CLASSES: Record<string, string> = {
  RESERVED: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  WAITLISTED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  SETTLED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  PENDING: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  ACTIVE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REPAYMENT: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  COMPLETED: 'bg-green-600/20 text-green-400 border-green-600/30',
  DEFAULTED: 'bg-red-500/20 text-red-400 border-red-500/30',
  CANCELLED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  REFUNDED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

/** Méthodes de valorisation servies par `metrics._valuation` (annexe D). Une
 *  position en porte toujours exactement une, et elle est affichée : « au pair »
 *  et « faute d'expertise » ne se lisent pas pareil, la seconde dit qu'on ne
 *  sait pas ce que le titre vaut. */
export const VALUATION_METHOD_LABELS: Record<string, string> = {
  PAIR: 'Au pair',
  PROVISION_P12: 'Décote de défaut',
  EXPERTISE_DATEE: 'Expertise datée',
  PAIR_FAUTE_D_EXPERTISE: 'Au pair, faute d’expertise',
};

/** Traduit un code en s'abstenant d'inventer : un code absent du dictionnaire
 *  ressort inchangé, visible, plutôt que rangé dans la case la plus proche. */
function label(dictionary: Record<string, string>, code: string | null | undefined): string {
  if (!code) return '—';
  return dictionary[code] ?? code;
}

export const valuationMethodLabel = (code: string | null | undefined) =>
  label(VALUATION_METHOD_LABELS, code);
export const projectStatusLabel = (code: string | null | undefined) =>
  label(PROJECT_STATUS_LABELS, code);
export const titleTypeLabel = (code: string | null | undefined) =>
  label(TITLE_TYPE_LABELS, code);
export const subscriptionStatusLabel = (code: string | null | undefined) =>
  label(SUBSCRIPTION_STATUS_LABELS, code);

export const projectStatusClass = (code: string | null | undefined) =>
  PROJECT_STATUS_CLASSES[code ?? ''] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30';
export const subscriptionStatusClass = (code: string | null | undefined) =>
  SUBSCRIPTION_STATUS_CLASSES[code ?? ''] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30';

// ─────────────────────────────────────────────────────────────────────────────
// Positions — jointure souscription × offre × projet, filtrée sur SON argent
// ─────────────────────────────────────────────────────────────────────────────

export interface InvestorPosition {
  key: string;
  subscriptionId: number;
  investorId: number;
  offerId: number;
  offerCode: string | null;
  projectCode: string | null;
  projectTitle: string;
  projectStatus: string | null;
  projectStatusLabel: string;
  sector: string | null;
  location: string | null;
  titleType: string | null;
  titleTypeLabel: string;
  /** Réservé — un engagement. Distinct de l'encaissé, volontairement. */
  reservedAmount: number;
  allocatedAmount: number;
  settledAmount: number;
  refundedAmount: number;
  totalReceived: number;
  bonds: number;
  /** Coupon contractuel figé à la souscription, en POURCENTS. */
  couponRate: number;
  status: string;
  statusLabel: string;
  subscriptionDate: string;
  settledAt: string | null;
  nextPaymentDate: string | null;
  /** Le projet est passé en P12 : l'investisseur doit le voir le jour même. */
  isInDefault: boolean;
  /** L'argent est-il réellement parti ? Une réservation n'est pas un placement. */
  isSettled: boolean;
  /** Valorisation SERVEUR de la position (`valuation.positions`), jointe par
   *  `subscriptionId`. `null` sur une souscription seulement réservée : le
   *  serveur ne valorise que ce qui est encaissé, et c'est correct — une
   *  intention n'a pas de valeur de marché. */
  valuation: ValuationPosition | null;
}

export interface PositionsResult {
  positions: InvestorPosition[];
  /** Nombre de lignes écartées parce qu'elles appartiennent à quelqu'un d'autre.
   *  Toute valeur > 0 est un INCIDENT à afficher, pas un détail à taire. */
  foreignRowsRejected: number;
}

/**
 * Assemble les positions de l'investisseur `investorId`.
 *
 * `investorId` est obligatoire et le filtrage est strict : une souscription dont
 * l'`investorId` diffère est écartée et comptée. Le serveur ne sert déjà que les
 * souscriptions du demandeur (`GET /investments/subscriptions/mine`) — cette
 * barrière est la seconde, celle qui tient si la première cède.
 */
export function buildPositions(
  subscriptions: InvestmentSubscription[],
  offers: Array<Pick<InvestmentOffer, 'id' | 'code' | 'projectId' | 'typeOfTitle'>>,
  projects: InvestmentProject[],
  investorId: number,
  valuationPositions: ValuationPosition[] = [],
): PositionsResult {
  const offerById = new Map(offers.map((o) => [o.id, o]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  // Valorisation servie par l'annexe D, indexée par souscription : capital restant
  // dû, gain latent, perte estimée et méthode viennent de là, pas d'un calcul local.
  const valuationBySubscription = new Map(valuationPositions.map((v) => [v.subscriptionId, v]));

  let foreignRowsRejected = 0;
  const positions: InvestorPosition[] = [];

  for (const s of subscriptions) {
    if (s.investorId !== investorId) {
      foreignRowsRejected += 1;
      continue;
    }
    const offer = offerById.get(s.offerId) ?? null;
    const project = offer ? projectById.get(offer.projectId) ?? null : null;
    positions.push({
      key: `SUB-${s.id}`,
      subscriptionId: s.id,
      investorId: s.investorId,
      offerId: s.offerId,
      offerCode: offer?.code ?? null,
      projectCode: project?.code ?? null,
      // Sans projet joignable (offre d'un projet hors périmètre client), on
      // nomme la position par son offre plutôt que d'afficher un vide.
      projectTitle: project?.title ?? (offer ? `Offre ${offer.code}` : `Offre #${s.offerId}`),
      projectStatus: project?.status ?? null,
      projectStatusLabel: projectStatusLabel(project?.status),
      sector: project?.sector ?? null,
      location: project?.location ?? null,
      titleType: offer?.typeOfTitle ?? null,
      titleTypeLabel: titleTypeLabel(offer?.typeOfTitle),
      reservedAmount: s.amount,
      allocatedAmount: s.allocatedAmount,
      settledAmount: s.settledAmount,
      refundedAmount: s.refundedAmount,
      totalReceived: s.totalReceived,
      bonds: s.bonds,
      couponRate: s.couponRate,
      status: s.status,
      statusLabel: subscriptionStatusLabel(s.status),
      subscriptionDate: s.subscriptionDate,
      settledAt: s.settledAt,
      nextPaymentDate: s.nextPaymentDate,
      isInDefault: project?.status === DEFAULT_PROJECT_STATUS,
      isSettled: Boolean(s.settledAt),
      valuation: valuationBySubscription.get(s.id) ?? null,
    });
  }
  return { positions, foreignRowsRejected };
}

/** Positions dont le projet est en défaut (P12), pour l'alerte du jour même. */
export function positionsInDefault(positions: InvestorPosition[]): InvestorPosition[] {
  return positions.filter((p) => p.isInDefault);
}

// ─────────────────────────────────────────────────────────────────────────────
// Les trois colonnes de rendement
// ─────────────────────────────────────────────────────────────────────────────

export type ReturnColumnKey = 'realized' | 'latent' | 'expected';

export interface ReturnColumn {
  key: ReturnColumnKey;
  label: string;
  /** Taux en POURCENTS quand `unit === 'percent'`, sinon `null`. */
  rate: number | null;
  /** Montant en devise quand `unit === 'amount'`, sinon `null`. */
  amount: number | null;
  unit: 'percent' | 'amount';
  /** Ce que la colonne mesure, en une phrase — affiché sous le chiffre. */
  caption: string;
  /** Méthode ou définition. Pour le latent, c'est la méthode SERVIE. */
  detail: string;
  /** Motif servi quand le chiffre n'existe pas : à afficher, pas à masquer. */
  unavailableReason: string | null;
  /** Vrai pour la seule colonne latente — l'étiquette ne se perd jamais. */
  isLatent: boolean;
}

/** Unité déclarée pour un taux, lue dans `metrics.units` (chemin pointé, ex.
 *  `defaultRates.byValue`). Repli sur `fraction`, convention unique du module —
 *  et repli LOGGÉ nulle part exprès : un champ absent du dictionnaire est un
 *  champ que le serveur n'a pas déclaré, pas un champ dans une autre unité. */
export function rateUnit(metrics: Pick<InvestorMetrics, 'units'>, path: string): string {
  return metrics.units?.[path] ?? 'fraction';
}

/**
 * Taux serveur → pourcentage d'affichage, selon l'unité DÉCLARÉE.
 *
 * Conversion d'unité, pas calcul métier : la valeur reste celle du serveur, seule
 * sa présentation change. `fraction` est multipliée par 100 ; toute autre unité
 * (`percent`, `points_sur_100`…) est affichée telle quelle — mieux vaut un
 * chiffre non converti, visiblement faux d'un facteur 100, qu'une conversion
 * appliquée à l'aveugle sur une unité qu'on n'a pas comprise.
 */
export function rateToPercent(
  value: number | null | undefined,
  unit: string = 'fraction',
): number | null {
  if (value === null || value === undefined) return null;
  return unit === 'fraction' ? value * 100 : value;
}

/**
 * Les trois colonnes, dans cet ordre et toujours les trois.
 *
 * Renvoyer une seule d'entre elles serait choisir le chiffre qui arrange : le
 * réalisé est souvent vide au démarrage d'un portefeuille, le latent est
 * flatteur par construction, l'attendu est une promesse. Ensemble, ils se
 * corrigent mutuellement.
 */
export function buildReturnColumns(metrics: InvestorMetrics): ReturnColumn[] {
  return [
    {
      key: 'realized',
      label: 'Rendement réalisé',
      rate: rateToPercent(metrics.realizedReturn, rateUnit(metrics, 'realizedReturn')),
      amount: null,
      unit: 'percent',
      caption: 'Distributions réellement encaissées',
      detail:
        'XIRR sur vos flux datés réels : souscriptions encaissées en sortie, '
        + 'distributions reçues en entrée. Aucune projection.',
      unavailableReason: metrics.realizedReturn === null
        ? metrics.realizedReturnUnavailableReason
          ?? "Le rendement réalisé n'est pas calculable sur vos flux actuels."
        : null,
      isLatent: false,
    },
    {
      key: 'latent',
      label: 'Gain latent',
      rate: null,
      amount: metrics.valuation.latentGain,
      unit: 'amount',
      caption: 'Valorisation — non encaissé, peut ne jamais l’être',
      detail: metrics.valuation.method,
      unavailableReason: null,
      isLatent: true,
    },
    {
      key: 'expected',
      label: 'Rendement attendu',
      // Même traitement que le réalisé, et pour la même raison : l'unité est LUE.
      // Ce champ a changé de convention côté serveur (points de pourcentage →
      // fraction) ; la lire plutôt que la supposer est ce qui a fait que le
      // changement n'a rien cassé d'invisible.
      rate: rateToPercent(metrics.expectedCouponRate, rateUnit(metrics, 'expectedCouponRate')),
      amount: null,
      unit: 'percent',
      caption: `Promesse contractuelle · ${metrics.expectedCouponPositions} position(s) financée(s)`,
      detail:
        'Moyenne des taux de coupon figés à la souscription, pondérée par les '
        + 'montants encaissés. Ce que les projets ont promis, pas ce qu’ils ont versé.',
      unavailableReason: metrics.expectedCouponPositions === 0
        ? 'Aucune position encaissée : il n’y a pas encore de promesse contractuelle à afficher.'
        : null,
      isLatent: false,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Risque — tout vient du serveur, y compris les bases et les avertissements
// ─────────────────────────────────────────────────────────────────────────────

export interface RateReading {
  /** Taux en pourcents d'affichage, converti selon l'unité déclarée. */
  percent: number;
  /** Base de la mesure — un pourcentage sans base n'est pas une information. */
  basis: string;
}

/** Lit un taux du payload et l'accompagne de sa base, telle que servie. */
export function readRate(
  metrics: InvestorMetrics,
  path: string,
  value: number,
  basis: string,
): RateReading {
  return { percent: rateToPercent(value, rateUnit(metrics, path)) ?? 0, basis };
}

export interface ExposureBar extends ExposureLine {
  /** Part en pourcents d'affichage — `share` est servi en fraction. */
  sharePercent: number;
}

/**
 * Ventilation d'exposition prête à tracer.
 *
 * Le serveur sert `{key, amount, share}` triés du plus exposé au moins exposé :
 * il n'y a plus rien à agréger côté navigateur. La seule opération faite ici est
 * la mise en pourcents de la part — une unité, pas un calcul.
 */
export function buildExposureBars(lines: ExposureLine[] = []): ExposureBar[] {
  return lines.map((l) => ({ ...l, sharePercent: l.share * 100 }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline anonymisé
// ─────────────────────────────────────────────────────────────────────────────

/**
 * N'expose que les COMPTEURS d'étape du pipeline.
 *
 * `GET /investments/pipeline` renvoie un tableau `projects` rempli pour le
 * personnel et vide pour un client. Cette fonction ne le lit jamais : si un jour
 * le serveur se met à le remplir pour tout le monde, l'écran investisseur reste
 * muet plutôt que de publier des dossiers en due diligence.
 */
export function buildPipelineStages(pipeline: InvestmentPipeline | null): InvestmentPipelineStage[] {
  if (!pipeline?.stages) return [];
  return pipeline.stages.map((s) => ({
    stage: s.stage,
    label: s.label,
    count: s.count,
    aggregateTarget: s.aggregateTarget,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Offres ouvertes
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenOfferCard {
  id: number;
  code: string;
  name: string;
  sector: string;
  location: string;
  offerId: number;
  offerCode: string;
  /** Score de risque du projet (0–10), servi par la projection de l'offre. */
  riskScore: number | null;
  globalScore: number | null;
  riskCategory: string | null;
  raisedAmount: number;
  reservedAmount: number;
  targetAmount: number;
  minFundingAmount: number;
  minimumTicket: number;
  /** Coupon promis, en POINTS DE POURCENTAGE — `offers/open` ne convertit pas. */
  expectedReturn: number;
  maturityMonths: number;
  paymentFrequency: string;
  bondUnitValue: number;
  availableBonds: number;
  /** Bornes de souscription servies par l'offre. Le repli (au moins 1 titre, au
   *  plus le stock disponible) ne joue que sur un serveur antérieur à leur ajout :
   *  sans lui, le sélecteur partait sur `NaN` et la borne haute ne bloquait rien.
   *  `funding.reserve` re-valide `min_bonds` de toute façon. */
  minBonds: number;
  maxBonds: number;
  bondLimitsFromServer: boolean;
  subscriptionDeadline: string | null;
  oversubscriptionPolicy: string;
  titleType: string | null;
  titleTypeLabel: string;
}

/**
 * Cartes des offres ouvertes.
 *
 * `open_offers_summary()` sert désormais le score de risque du projet, sa
 * catégorie, la typologie du titre et les bornes de souscription : la jointure
 * qu'il fallait faire ici sur `GET /investments/projects` a disparu, et avec elle
 * un appel réseau et une occasion de désaccorder deux sources.
 *
 * Aucun pourcentage d'avancement n'est produit : cette projection n'en sert pas,
 * et le calculer ici ferait un chiffre métier de plus dans le navigateur. La
 * carte affiche les deux montants servis.
 */
export function buildOpenOfferCards(offers: OpenOfferSummary[]): OpenOfferCard[] {
  return offers.map((o) => {
    const hasLimits = o.minBonds !== undefined && o.maxBonds !== undefined;
    return {
      id: o.offerId,
      code: o.projectCode,
      name: o.title,
      sector: o.sector,
      location: o.location,
      offerId: o.offerId,
      offerCode: o.offerCode,
      riskScore: o.riskScore ?? null,
      globalScore: o.globalScore ?? null,
      riskCategory: o.riskCategory || null,
      raisedAmount: o.fundedAmount,
      reservedAmount: o.reservedAmount,
      targetAmount: o.fundingGoal,
      minFundingAmount: o.minFundingAmount,
      minimumTicket: o.minTicket,
      expectedReturn: o.couponRate,
      maturityMonths: o.maturityMonths,
      paymentFrequency: o.paymentFrequency,
      bondUnitValue: o.bondUnitValue,
      availableBonds: o.availableBonds,
      minBonds: o.minBonds ?? 1,
      maxBonds: o.maxBonds ?? o.availableBonds,
      bondLimitsFromServer: Boolean(hasLimits),
      subscriptionDeadline: o.subscriptionDeadline,
      oversubscriptionPolicy: o.oversubscriptionPolicy,
      titleType: o.typeOfTitle ?? null,
      titleTypeLabel: titleTypeLabel(o.typeOfTitle),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Profondeur d'historique — dire ce qu'on a, et le dire quand c'est court
// ─────────────────────────────────────────────────────────────────────────────

export interface HistoryCoverage {
  movementsCount: number;
  /** Nombre de mois DISTINCTS réellement couverts par les mouvements servis. */
  monthsCovered: number;
  from: string | null;
  to: string | null;
  hasTwelveMonths: boolean;
  /** Phrase à afficher telle quelle sous l'historique. */
  note: string;
}

/**
 * Décrit la profondeur de l'historique disponible — métadonnée sur les données,
 * pas grandeur financière.
 *
 * Le prototype traçait une courbe de performance sur douze mois en
 * `Math.random()` : douze points existaient parce que le graphique en voulait
 * douze. On affiche désormais ce qu'on a, et quand c'est court, on l'écrit.
 */
export function describeHistoryCoverage(movements: InvestmentMovement[]): HistoryCoverage {
  const dated = movements
    .filter((m) => Boolean(m.dateTime))
    .slice()
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  if (dated.length === 0) {
    return {
      movementsCount: 0,
      monthsCovered: 0,
      from: null,
      to: null,
      hasTwelveMonths: false,
      note: 'Aucun mouvement enregistré sur votre compte : il n’y a pas encore d’historique à afficher.',
    };
  }
  const months = new Set(dated.map((m) => m.dateTime.slice(0, 7)));
  const from = dated[0].dateTime;
  const to = dated[dated.length - 1].dateTime;
  const hasTwelveMonths = months.size >= 12;
  return {
    movementsCount: dated.length,
    monthsCovered: months.size,
    from,
    to,
    hasTwelveMonths,
    note: hasTwelveMonths
      ? `Historique réel sur ${months.size} mois, ${dated.length} mouvement(s).`
      : `Historique réel disponible : ${months.size} mois seulement (${dated.length} mouvement(s)). `
        + 'Moins de douze mois : la profondeur est insuffisante pour une lecture de tendance, '
        + 'et rien n’est extrapolé pour combler le manque.',
  };
}

/** `investments.Movement.Type` — les onze types servis, libellés à l'identique.
 *  « Souscription (réservation) » et « Encaissement souscription » sont deux
 *  lignes distinctes du serveur : la première ne déplace aucun franc. */
export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: 'Dépôt',
  SUBSCRIPTION: 'Souscription (réservation)',
  SETTLEMENT: 'Encaissement souscription',
  REFUND: 'Remboursement souscription',
  DISBURSEMENT: 'Décaissement projet',
  PROJECT_RETURN: 'Encaissement retour projet',
  DISTRIBUTION: 'Distribution investisseurs',
  COUPON_REPAYMENT: 'Remboursement coupon',
  CAPITAL_REPAYMENT: 'Remboursement capital',
  WITHDRAWAL: 'Retrait',
  FEES: 'Frais',
};

export const movementTypeLabel = (code: string | null | undefined) =>
  label(MOVEMENT_TYPE_LABELS, code);

// ─────────────────────────────────────────────────────────────────────────────
// Ce qui reste non mesurable — et le reste pour une raison de DONNÉES
// ─────────────────────────────────────────────────────────────────────────────

export interface MissingMetric {
  key: string;
  label: string;
  /** Pourquoi le chiffre n'est pas affiché, en clair, pour l'investisseur. */
  reason: string;
}

/**
 * Les trous restants ne viennent plus d'un calcul absent mais d'une donnée
 * absente — ce n'est pas la même chose, et l'écran doit dire laquelle.
 *
 * Défaut, concentration, retard et score de santé sont désormais calculés par
 * `investor_metrics()` sur le seul portefeuille du demandeur : ils sont affichés.
 * Ce qui manque encore se déduit du payload lui-même, pas d'une liste figée —
 * d'où une fonction plutôt qu'une constante : une couverture d'échéanciers nulle
 * ou une expertise manquante sont des états, pas des dettes permanentes.
 */
export function unmeasurableFrom(metrics: InvestorMetrics): MissingMetric[] {
  const trous: MissingMetric[] = [];

  if (metrics.nextPayment.unavailableReason) {
    trous.push({
      key: 'nextPayment',
      label: 'Date du prochain paiement',
      reason: metrics.nextPayment.unavailableReason,
    });
  }
  if (metrics.lateProjects.scheduleCoverageWarning) {
    trous.push({
      key: 'lateProjects',
      label: 'Part de projets en retard — mesure partielle',
      reason: metrics.lateProjects.scheduleCoverageWarning,
    });
  }
  // Une position valorisée « au pair faute d'expertise » n'a pas de valeur de
  // marché connue : le dire vaut mieux que laisser lire le pair comme une valeur.
  const sansExpertise = (metrics.valuation.positions ?? [])
    .filter((p) => p.valuationMethod === 'PAIR_FAUTE_D_EXPERTISE');
  if (sansExpertise.length > 0) {
    trous.push({
      key: 'expertValuation',
      label: `Valeur de marché de ${sansExpertise.length} titre(s) de capital`,
      reason:
        'Aucune valorisation d’expert datée et valide n’est enregistrée sur ces projets : '
        + 'ils sont retenus au pair, c’est-à-dire à leur prix de souscription. Ce n’est pas '
        + 'une estimation de ce qu’ils valent aujourd’hui.',
    });
  }
  return trous;
}
