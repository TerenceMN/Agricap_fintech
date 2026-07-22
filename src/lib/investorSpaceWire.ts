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
 * 2. **Les unités diffèrent selon le champ servi.** `realizedReturn` est un XIRR,
 *    donc une fraction (0,12) ; `expectedCouponRate` est déjà en pourcents (12,5).
 *    La conversion faite ici est une conversion d'UNITÉ, explicite et testée, pas
 *    un calcul.
 *
 * 3. **Asymétrie d'information.** Un investisseur voit SON argent et les offres
 *    OUVERTES. `buildPositions` refuse toute souscription qui n'est pas la sienne
 *    et le signale (`foreignRowsRejected`) : le serveur filtre déjà, mais un
 *    front qui affiche aveuglément ce qu'on lui donne transforme la moindre
 *    régression serveur en fuite. Le pipeline P01→P05 ne sort qu'en compteurs.
 */
import type {
  InvestmentMovement,
  InvestmentOffer,
  InvestmentPipeline,
  InvestmentPipelineStage,
  InvestmentProject,
  InvestmentSubscription,
  InvestorMetrics,
  OpenOfferSummary,
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

/** Traduit un code en s'abstenant d'inventer : un code absent du dictionnaire
 *  ressort inchangé, visible, plutôt que rangé dans la case la plus proche. */
function label(dictionary: Record<string, string>, code: string | null | undefined): string {
  if (!code) return '—';
  return dictionary[code] ?? code;
}

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
): PositionsResult {
  const offerById = new Map(offers.map((o) => [o.id, o]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

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

/** Fraction serveur → pourcentage d'affichage. Conversion d'UNITÉ : le taux
 *  reste celui du XIRR serveur, seule sa présentation change. */
export function fractionToPercent(fraction: number | null | undefined): number | null {
  if (fraction === null || fraction === undefined) return null;
  return fraction * 100;
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
      rate: fractionToPercent(metrics.realizedReturn),
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
      // Déjà en pourcents côté serveur : aucune conversion ici, contrairement au
      // réalisé. C'est la dissymétrie la plus facile à casser par mégarde.
      rate: metrics.expectedCouponRate,
      amount: null,
      unit: 'percent',
      caption: 'Promesse contractuelle des projets souscrits',
      detail:
        'Moyenne des taux de coupon figés à la souscription, pondérée par les '
        + 'montants encaissés. Ce que les projets ont promis, pas ce qu’ils ont versé.',
      unavailableReason: null,
      isLatent: false,
    },
  ];
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
  /** Score de risque du projet (0–10), servi par `GET /investments/projects`. */
  riskScore: number | null;
  globalScore: number | null;
  /** Avancement SERVEUR (`Project.progress_percent`) — jamais recalculé ici. */
  progressPercent: number | null;
  raisedAmount: number;
  reservedAmount: number;
  targetAmount: number;
  minFundingAmount: number;
  minimumTicket: number;
  expectedReturn: number;
  maturityMonths: number;
  bondUnitValue: number;
  availableBonds: number;
  /** Bornes de souscription. `offers/open` ne les sert PAS : à défaut, on borne
   *  sur ce qui est structurellement vrai (au moins 1 titre, au plus le stock
   *  disponible) et le serveur re-valide `min_bonds` à la réservation. */
  minBonds: number;
  maxBonds: number;
  bondLimitsFromServer: boolean;
  subscriptionDeadline: string | null;
  oversubscriptionPolicy: string;
  /** Typologie dette / capital — absente de `offers/open`, jointe si connue. */
  titleType: string | null;
  titleTypeLabel: string;
}

/**
 * Cartes des offres ouvertes, enrichies du score du projet.
 *
 * La jointure se fait sur `projectCode` : `open_offers_summary()` sert le code du
 * projet mais pas son score, et le score est précisément ce qu'un investisseur
 * doit voir avant d'engager son argent (« un risque honnête ou rien »).
 */
export function buildOpenOfferCards(
  offers: OpenOfferSummary[],
  projects: InvestmentProject[],
  offerDetails: Array<Pick<InvestmentOffer, 'id' | 'typeOfTitle' | 'minBonds' | 'maxBonds'>> = [],
): OpenOfferCard[] {
  const projectByCode = new Map(projects.map((p) => [p.code, p]));
  const detailById = new Map(offerDetails.map((o) => [o.id, o]));
  return offers.map((o) => {
    const project = projectByCode.get(o.projectCode) ?? null;
    const detail = detailById.get(o.offerId) ?? null;
    const hasLimits = detail?.minBonds !== undefined && detail?.maxBonds !== undefined;
    return {
      id: project?.id ?? o.offerId,
      code: o.projectCode,
      name: o.title,
      sector: o.sector,
      location: o.location,
      offerId: o.offerId,
      offerCode: o.offerCode,
      riskScore: project?.riskScore ?? null,
      globalScore: project?.globalScore ?? null,
      progressPercent: project?.progressPercent ?? null,
      raisedAmount: o.fundedAmount,
      reservedAmount: o.reservedAmount,
      targetAmount: o.fundingGoal,
      minFundingAmount: o.minFundingAmount,
      minimumTicket: o.minTicket,
      expectedReturn: o.couponRate,
      maturityMonths: o.maturityMonths,
      bondUnitValue: o.bondUnitValue,
      availableBonds: o.availableBonds,
      minBonds: detail?.minBonds ?? 1,
      maxBonds: detail?.maxBonds ?? o.availableBonds,
      bondLimitsFromServer: Boolean(hasLimits),
      subscriptionDeadline: o.subscriptionDeadline,
      oversubscriptionPolicy: o.oversubscriptionPolicy,
      titleType: detail?.typeOfTitle ?? null,
      titleTypeLabel: titleTypeLabel(detail?.typeOfTitle),
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
// Métriques absentes du serveur — nommées, pas simulées
// ─────────────────────────────────────────────────────────────────────────────

export interface MissingMetric {
  key: string;
  label: string;
  /** Pourquoi le chiffre n'est pas affiché, en clair, pour l'investisseur. */
  reason: string;
}

/**
 * Ce que l'espace investisseur NE PEUT PAS afficher aujourd'hui, faute d'un
 * chiffre serveur — et qu'il refuse de calculer dans le navigateur.
 *
 * `metrics.py` sait déjà mesurer la concentration (Herfindahl), le taux de
 * défaut et le score de santé, mais uniquement au niveau INSTITUTION
 * (`GET /investments/metrics/portfolio`, réservé au personnel : servir cet
 * agrégat à un investisseur reviendrait à lui montrer le portefeuille des
 * autres). Le même calcul restreint à SES souscriptions n'existe pas encore
 * dans `investor_metrics()`.
 */
export const MISSING_INVESTOR_METRICS: MissingMetric[] = [
  {
    key: 'defaultRate',
    label: 'Votre taux de défaut (valeur et nombre)',
    reason:
      'Mesuré côté serveur pour l’institution entière, pas encore pour un portefeuille '
      + 'individuel. Les projets de votre portefeuille passés en défaut sont listés '
      + 'nommément ci-dessus : c’est l’information brute, sans le ratio.',
  },
  {
    key: 'concentration',
    label: 'Concentration de votre portefeuille (Herfindahl)',
    reason:
      'L’indice de concentration par secteur et par zone n’est servi que pour '
      + 'l’institution. Le recomposer ici donnerait un chiffre invérifiable, différent '
      + 'de celui du back-office.',
  },
  {
    key: 'health',
    label: 'Score de santé de votre portefeuille /100',
    reason:
      'La formule et ses paramètres vivent en base côté serveur. Tant qu’ils ne sont pas '
      + 'appliqués à votre seul portefeuille, aucun score n’est affiché.',
  },
];
