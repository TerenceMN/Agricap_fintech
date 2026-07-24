/**
 * Produit obligataire client — PROJECTIONS PURES des réponses serveur.
 *
 * Ce que ce fichier remplace
 * --------------------------
 * `pages/Obligations.jsx` portait quatre constantes en tête de fichier, sous le
 * commentaire « Termes réels du produit (défauts backend) » :
 *
 *     const COUPON_VALUE = 250;
 *     const ANNUAL_RATE = 0.09;
 *     const MATURITY_MONTHS = 24;
 *     const WITHDRAWAL_PENALTY_RATE = 0.02;
 *
 * Elles étaient exactes le jour où elles ont été écrites : c'étaient les
 * `default=` du modèle `ObligationPosition`. Le backend les a SUPPRIMÉS depuis,
 * et pour une raison qui condamne aussi leur copie côté front — citation de
 * `investments/models.py` : « Les termes ne s'inventent pas. […] toute position
 * créée sans les préciser héritait donc de termes que personne n'avait décidés. »
 * Les termes viennent désormais de l'`Offer` souscrite, et une création sans
 * offre est refusée.
 *
 * L'écran, lui, continuait d'annoncer « Rendement 9 %/an » et « Taux Annuel 9 % »
 * — sur la MÊME page, et jusque dans la même ligne de tableau, que le `p.rate`
 * réellement servi par le serveur. Deux taux contradictoires côte à côte : celui
 * du produit qu'on vend et celui du titre qu'on détient.
 *
 * Les trois règles appliquées ici
 * -------------------------------
 * 1. **Un terme de produit vient de l'offre, jamais d'une constante.** Les termes
 *    affichés avant souscription sont ceux de `GET /investments/offers/open`,
 *    offre par offre. Aucune offre ouverte → on l'écrit, on ne replie pas sur un
 *    taux de brochure.
 *
 * 2. **Aucune projection financière au navigateur.** « Valeur Maturité Est. »
 *    valait `montant × 1,09 ^ années` : une capitalisation COMPOSÉE, alors que le
 *    coupon du module est en intérêt SIMPLE (`obligations.coupon_periodique`).
 *    Le chiffre était donc faux en plus d'être local. Il n'est pas recalculé
 *    correctement ici : il est retiré, et le besoin serveur est nommé.
 *
 * 3. **Un taux se lit avec son unité DÉCLARÉE.** `rate` d'une position est en
 *    points de pourcentage, `penaltyRate` d'un retrait est une fraction — deux
 *    conventions, dans le même module, servies avec leur `units`. On lit le
 *    dictionnaire (`rowRateToPercent`), on ne parie pas.
 */
import type { BondWithdrawal, ObligationPosition, OpenOfferSummary } from '@/types/api';
import { UNIT_FRACTION, UNIT_PERCENT, rowRateToPercent } from './investorSpaceWire';
import type { DataGap } from './portfolioTools';

// ─────────────────────────────────────────────────────────────────────────────
// Nomenclature
// ─────────────────────────────────────────────────────────────────────────────

/** `investments.ObligationPosition.Status`. */
export const OBLIGATION_STATUS_LABELS: Record<string, string> = {
  ACTIF: 'Actif',
  EN_ATTENTE: 'En attente',
  MATURE: 'Maturé',
};

/** `investments.BondWithdrawal.Status` / `BondConversion.Status` réunis — les
 *  deux files partagent les trois premiers états, la conversion ajoute REJETE. */
export const BOND_FLOW_STATUS_LABELS: Record<string, string> = {
  EN_ATTENTE: 'En attente',
  APPROUVE: 'Approuvé',
  PAYE: 'Payé',
  REJETE: 'Rejeté',
};

/** Un code inconnu ressort inchangé plutôt que rangé dans la case la plus proche. */
export function obligationStatusLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return OBLIGATION_STATUS_LABELS[code] ?? code;
}

export function bondFlowStatusLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return BOND_FLOW_STATUS_LABELS[code] ?? code;
}

// ─────────────────────────────────────────────────────────────────────────────
// Positions détenues — les termes SERVIS, avec leur provenance
// ─────────────────────────────────────────────────────────────────────────────

export interface ObligationPositionRow {
  id: number;
  name: string;
  status: string;
  statusLabel: string;
  investedAmount: number;
  couponAmount: number;
  /** Nombre de titres. `invested / couponAmount` est ici une DIVISION EXACTE :
   *  `obligations.souscrire` pose `montant = titres × valeur unitaire`. Ce n'est
   *  pas une estimation, c'est la reconstitution du facteur d'un produit servi. */
  bonds: number;
  termMonths: number;
  /** Taux du titre, en POURCENTS d'affichage, converti selon `units.rate`. */
  ratePercent: number | null;
  /** Provenance des termes — `termsSource` du serveur. Une position antérieure
   *  au rattachement obligatoire à une offre le dit, elle ne se tait pas. */
  termsSource: string | null;
  offerCode: string | null;
  projectCode: string | null;
  paymentFrequency: string | null;
  dateCreated: string;
  /** Vrai quand les termes ne viennent d'aucune offre : à signaler à l'écran. */
  termsOrphaned: boolean;
}

/**
 * Les positions détenues, telles que servies.
 *
 * Aucune valeur à maturité n'est produite — c'est l'objet de `MATURITY_VALUE_GAP`.
 * Le taux est converti selon l'unité déclarée par la ligne ; le repli est
 * `percent`, l'unité de `OBLIGATION_RATE_UNITS`, et il ne joue que face à un
 * serveur antérieur à la publication des unités.
 */
export function buildObligationRows(positions: ObligationPosition[]): ObligationPositionRow[] {
  return positions.map((p) => {
    const unit = p.couponAmount > 0 ? p.couponAmount : 0;
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      statusLabel: obligationStatusLabel(p.status),
      investedAmount: p.investedAmount,
      couponAmount: p.couponAmount,
      bonds: unit > 0 ? Math.floor(p.investedAmount / unit) : 0,
      termMonths: p.termMonths,
      ratePercent: rowRateToPercent(p, 'rate', p.rate, UNIT_PERCENT),
      termsSource: p.termsSource ?? null,
      offerCode: p.offerCode ?? null,
      projectCode: p.projectCode ?? null,
      paymentFrequency: p.paymentFrequency ?? null,
      dateCreated: p.dateCreated,
      termsOrphaned: !p.offerCode,
    };
  });
}

/** Capital réellement placé sur les positions ACTIVES — somme de montants SERVIS
 *  de même nature et de même devise (le module est mono-devise, `obligations.DEVISE`).
 *  Additionner n'est pas dériver : aucune grandeur nouvelle n'apparaît. */
export function totalInvestedActive(rows: ObligationPositionRow[]): number {
  return rows.filter((r) => r.status === 'ACTIF').reduce((sum, r) => sum + r.investedAmount, 0);
}

/** Titres détenus sur les positions ACTIVES. */
export function totalBondsActive(rows: ObligationPositionRow[]): number {
  return rows.filter((r) => r.status === 'ACTIF').reduce((sum, r) => sum + r.bonds, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Maturité — une DATE, pas une valeur
// ─────────────────────────────────────────────────────────────────────────────

export interface MaturityReading {
  /** Date d'échéance = souscription + maturité servie. */
  maturityDate: Date;
  /** Mois calendaires restants, borné à 0. Jamais négatif : une position échue
   *  n'a pas « −3 mois » à courir. */
  monthsRemaining: number;
  /** Part de la durée écoulée, en pourcents (0–100), pour une barre d'avancement.
   *  C'est une proportion de TEMPS, pas une proportion d'argent. */
  elapsedPercent: number;
}

/**
 * Où en est une position dans sa durée de vie.
 *
 * Purement calendaire : aucune valeur, aucun intérêt, aucun rendement. Le calcul
 * précédent divisait un écart de millisecondes par `1000 × 60 × 60 × 24 × 30`,
 * c'est-à-dire par des « mois de 30 jours » — une précision affichée à l'unité
 * près sur une convention qui dérive d'un jour tous les deux mois. On compte
 * désormais en mois CALENDAIRES, ce que la maturité mesure réellement.
 */
export function readMaturity(
  dateCreated: string,
  termMonths: number,
  now: Date = new Date(),
): MaturityReading {
  const start = new Date(dateCreated);
  const maturityDate = new Date(start);
  maturityDate.setMonth(maturityDate.getMonth() + (Number(termMonths) || 0));

  const brut = (maturityDate.getFullYear() - now.getFullYear()) * 12
    + (maturityDate.getMonth() - now.getMonth())
    - (now.getDate() < maturityDate.getDate() ? 0 : 1) + 1;
  const monthsRemaining = Math.max(0, brut);

  const total = Number(termMonths) || 0;
  const elapsedPercent = total > 0
    ? Math.min(100, Math.max(0, ((total - monthsRemaining) / total) * 100))
    : 0;
  return { maturityDate, monthsRemaining, elapsedPercent };
}

// ─────────────────────────────────────────────────────────────────────────────
// Retraits — la pénalité est une donnée de LIGNE, pas une constante
// ─────────────────────────────────────────────────────────────────────────────

export interface BondWithdrawalRow {
  id: number;
  amount: number;
  /** Pénalité RÉELLEMENT appliquée à ce retrait, en pourcents d'affichage.
   *  Servie par ligne (`BondWithdrawal.penalty_rate`, unité `fraction`). */
  penaltyPercent: number | null;
  reason: string;
  status: string;
  statusLabel: string;
  date: string;
}

/**
 * Les retraits déjà déposés, avec la pénalité que le serveur a RETENUE sur
 * chacun.
 *
 * L'écran affichait auparavant une pénalité de 2 % en dur, y compris dans un
 * « Net à Recevoir » calculé avant l'envoi de la demande. `penalty_rate` est un
 * champ PAR LIGNE : deux retraits du même investisseur peuvent porter deux taux,
 * et rien ne garantit que le prochain portera 2 %. Le montant net promis n'était
 * donc confirmé par personne — cf. `WITHDRAWAL_NET_GAP`.
 */
export function buildWithdrawalRows(withdrawals: BondWithdrawal[]): BondWithdrawalRow[] {
  return withdrawals.map((w) => ({
    id: w.id,
    amount: w.amount,
    penaltyPercent: rowRateToPercent(w, 'penaltyRate', w.penaltyRate, UNIT_FRACTION),
    reason: w.reason,
    status: w.status,
    statusLabel: bondFlowStatusLabel(w.status),
    date: w.date,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Termes de produit — ceux des offres OUVERTES, offre par offre
// ─────────────────────────────────────────────────────────────────────────────

export interface BondOfferTerms {
  offerId: number;
  offerCode: string;
  projectCode: string;
  title: string;
  sector: string;
  location: string;
  /** Valeur unitaire d'un titre — remplace `COUPON_VALUE = 250`. */
  bondUnitValue: number;
  /** Coupon promis, en pourcents d'affichage — remplace `ANNUAL_RATE = 0.09`.
   *  `offers/open` déclare `couponRate: "percent"` ; on lit la déclaration. */
  couponRatePercent: number | null;
  /** Maturité en mois — remplace `MATURITY_MONTHS = 24`. */
  maturityMonths: number;
  paymentFrequency: string;
  availableBonds: number;
  minBonds: number;
  maxBonds: number;
  minTicket: number;
  subscriptionDeadline: string | null;
  /** Typologie du titre servie par l'offre, `null` si le serveur ne la sert pas. */
  titleType: string | null;
}

/** `investments.Offer.TypeOfTitle` — seule cette valeur passe le contrôle
 *  `OfferNotABond` de `obligations.souscrire`. */
export const TITLE_TYPE_BOND = 'OBLIGATION';

/**
 * Termes des offres obligataires ouvertes, servis par `GET /investments/offers/open`.
 *
 * Deux abstentions volontaires :
 *
 * - **aucun repli sur une brochure.** Quand la liste est vide, l'écran doit dire
 *   qu'aucune offre n'est ouverte. Annoncer « 9 %/an » sans offre ouverte, c'est
 *   promettre un produit qu'on ne peut pas vendre — et `obligations.souscrire`
 *   refuserait de toute façon (`OBLIGATION_OFFER_REQUIRED`).
 * - **aucune exclusion sur une typologie inconnue.** Une offre dont le serveur ne
 *   déclare pas le `typeOfTitle` est CONSERVÉE : la masquer sur une supposition
 *   retirerait un produit vendable, alors que le serveur, lui, tranche à la
 *   souscription avec un code explicite (`OBLIGATION_OFFER_NOT_A_BOND`).
 */
export function buildBondOfferTerms(offers: OpenOfferSummary[]): BondOfferTerms[] {
  return offers.filter((o) => {
    const type = (o as { typeOfTitle?: string | null }).typeOfTitle;
    return !type || type === TITLE_TYPE_BOND;
  }).map((o) => ({
    offerId: o.offerId,
    offerCode: o.offerCode,
    projectCode: o.projectCode,
    title: o.title,
    sector: o.sector,
    location: o.location,
    bondUnitValue: o.bondUnitValue,
    couponRatePercent: rowRateToPercent(o, 'couponRate', o.couponRate, UNIT_PERCENT),
    maturityMonths: o.maturityMonths,
    paymentFrequency: o.paymentFrequency,
    availableBonds: o.availableBonds,
    minBonds: o.minBonds ?? 1,
    maxBonds: o.maxBonds ?? o.availableBonds,
    minTicket: o.minTicket,
    subscriptionDeadline: o.subscriptionDeadline,
    titleType: (o as { typeOfTitle?: string | null }).typeOfTitle ?? null,
  }));
}

/** Montant d'une souscription = titres × valeur unitaire de l'OFFRE.
 *  Ce n'est pas une estimation : c'est la règle de prix que `obligations.souscrire`
 *  applique ensuite côté serveur, et c'est le serveur qui fait foi. */
export function subscriptionAmount(terms: BondOfferTerms | null, bonds: number): number | null {
  if (!terms || !Number.isFinite(bonds) || bonds <= 0) return null;
  return terms.bondUnitValue * bonds;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ce qui n'est PAS servi — nommé, plutôt que fabriqué
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La valeur à maturité n'existe nulle part côté serveur.
 *
 * Elle était pourtant affichée deux fois : en carte (« Valeur Maturité Est. ») et
 * en colonne de tableau (« Val. Maturité Est. »), toutes deux en
 * `montant × (1 + 0,09) ^ années`. Trois défauts superposés : le taux était une
 * constante, la capitalisation était COMPOSÉE là où le produit verse un coupon en
 * intérêt SIMPLE, et le résultat portait le mot « Est. » comme s'il s'agissait
 * d'une incertitude de mesure plutôt que d'une invention.
 */
export const MATURITY_VALUE_GAP: DataGap = {
  key: 'maturityValue',
  title: 'Valeur à maturité — aucun échéancier de coupons n’est servi',
  question: 'Combien vaudra ma position à l’échéance, coupons compris ?',
  whatExists: [
    'Les termes de chaque position : nominal (`investedAmount`), taux (`rate`, en points '
    + 'de pourcentage), maturité (`termMonths`) et fréquence de paiement '
    + '(`paymentFrequency`), tous servis par `GET /investments/obligations`.',
    '`investments/obligations.py::coupon_periodique` calcule DÉJÀ le coupon d’une période '
    + 'à partir de ces termes, en `Decimal` et en intérêt simple — mais côté serveur '
    + 'seulement, et sans être exposé.',
  ],
  whatIsMissing: [
    'Un échéancier de coupons daté par position : ni endpoint, ni champ. Sans lui, la '
    + 'valeur à maturité ne peut être qu’une hypothèse de convention prise dans le '
    + 'navigateur — et c’est exactement ce qui produisait une capitalisation composée sur '
    + 'un produit à intérêt simple.',
    'Le traitement des retraits anticipés déjà approuvés, qui amputent le nominal : une '
    + 'projection qui les ignore annonce plus que ce qui sera versé.',
  ],
  howItWouldBeFed: [
    '`coupon_periodique` est déjà écrit et testé : il reste à l’exposer sous forme '
    + 'd’échéancier, comme `GET /api/portfolio/loans/<ref>/schedule` le fait pour un prêt.',
  ],
  serverContract: [
    'GET /investments/obligations/<id>/schedule — coupons datés, capital à l’échéance, '
    + 'nets des retraits approuvés, chaque montant en `Decimal` quantizé.',
  ],
};

/**
 * Le net d'un retrait à venir n'est confirmé par personne.
 *
 * Le dialogue affichait « Pénalité : 2 % » puis « Net à Recevoir » en gras et en
 * vert, AVANT tout appel serveur. `BondWithdrawal.penalty_rate` est un champ par
 * ligne : 2 % en est la valeur par défaut, pas la règle. L'investisseur lisait
 * donc un montant que rien ne lui garantissait, sur l'écran même où il confirmait.
 */
export const WITHDRAWAL_NET_GAP: DataGap = {
  key: 'withdrawalNet',
  title: 'Net d’un retrait anticipé — la pénalité applicable n’est pas servie avant la demande',
  question: 'Si je retire maintenant, combien vais-je réellement recevoir ?',
  whatExists: [
    'La pénalité RETENUE sur chaque retrait déjà déposé (`penaltyRate`, servi avec son '
    + 'unité `fraction` par `GET /investments/obligations/<id>/withdrawals`) : le passé '
    + 'est lisible, ligne par ligne.',
  ],
  whatIsMissing: [
    'La pénalité APPLICABLE à un retrait qui n’existe pas encore. Elle est posée par le '
    + 'serveur à la création (`BondWithdrawal.penalty_rate`, défaut 0,02) et rien ne la '
    + 'publie avant. Un « Net à Recevoir » affiché à ce moment-là est une promesse sans '
    + 'auteur.',
    'La règle elle-même : le taux est un `default=` de modèle, donc du code. Une pénalité '
    + 'qui touche l’argent d’un client relève du comité (principe 8), pas d’un défaut de '
    + 'champ.',
  ],
  howItWouldBeFed: [
    'Le taux en base (`InvestmentConfig`), versionné, et une prévisualisation serveur de '
    + 'la demande — le même mécanisme que la réservation de souscription, qui calcule '
    + 'côté serveur avant d’engager quoi que ce soit.',
  ],
  serverContract: [
    'GET /investments/obligations/<id>/withdrawal-quote?amount= — pénalité applicable, '
    + 'montant net, et la règle qui les fonde, calculés par le serveur.',
  ],
};

/**
 * Le plan d'épargne récurrent n'est ni un produit ni une donnée.
 *
 * L'onglet « Simuler Plan » projetait un tableau mois par mois avec une colonne
 * « Valeur Est. » en `cumul × 1,09 ^ (mois/12)`, un « Taux Annuel » figé à 9 %
 * dans un champ désactivé — et un bouton « Activer ce Plan Épargne » qui ouvrait
 * un toast « non disponible ». La projection habillait donc en chiffres un
 * produit qui n'existe pas.
 */
export const BOND_SAVINGS_PLAN_GAP: DataGap = {
  key: 'bondSavingsPlan',
  title: 'Plan d’épargne obligataire récurrent — le produit n’existe pas',
  question: 'Si je place un montant chaque mois, où en serai-je dans deux ans ?',
  whatExists: [
    'La souscription d’un montant UNIQUE, adossée à une offre ouverte : c’est le seul '
    + 'chemin d’achat servi (`POST /investments/obligations`), et il débite réellement le '
    + 'portefeuille.',
    'Les termes des offres ouvertes (valeur unitaire, coupon, maturité), qui permettent de '
    + 'connaître le prix d’un titre aujourd’hui — pas celui d’un titre dans dix-huit mois.',
  ],
  whatIsMissing: [
    'Tout modèle de plan récurrent : aucun ordre permanent, aucun calendrier de '
    + 'prélèvement, aucun endroit où une intention d’épargne serait conservée.',
    'La garantie que les termes d’aujourd’hui vaudront demain. Chaque souscription tire ses '
    + 'termes de l’offre du moment (ce sont des snapshots) : projeter vingt-quatre mois au '
    + 'taux d’aujourd’hui suppose vingt-quatre offres identiques que personne n’a promises.',
  ],
  howItWouldBeFed: [
    'Un ordre permanent instruit comme une souscription — contrôle de solde, réservation, '
    + 'encaissement, journal — répété par une tâche planifiée, jamais un bouton qui '
    + 'promet une régularité que rien n’exécute.',
  ],
  serverContract: [
    'POST /investments/obligations/standing-orders — montant, périodicité, offre cible ou '
    + 'règle de sélection, avec sa journalisation.',
    'GET /investments/obligations/<id>/schedule — pour projeter sur des coupons datés '
    + 'plutôt que sur une convention choisie au navigateur.',
  ],
};

export const OBLIGATION_GAPS: Record<string, DataGap> = {
  maturityValue: MATURITY_VALUE_GAP,
  withdrawalNet: WITHDRAWAL_NET_GAP,
  bondSavingsPlan: BOND_SAVINGS_PLAN_GAP,
};
