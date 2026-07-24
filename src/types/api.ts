// Types du domaine — miroir des sorties du backend Django (moteur d'analyse crédit).

export interface Me {
  sub: string;
  email: string;
  full_name: string;
  role: string;
  phone: string;
  farmer_id: string;
  national_id: string;
  company_name: string;
  is_staff: boolean;
}

export type Verdict =
  | 'OK'
  | 'À VÉRIFIER (sous la plage)'
  | 'À VÉRIFIER (au-dessus de la plage)'
  | 'NON ÉVALUABLE (donnée manquante)'
  | 'JUSTIFIÉ';

export interface VraisemblanceItem {
  controle: string;
  valeur: number | null;
  ref_min: number | null;
  ref_max: number | null;
  verdict: Verdict;
  explication: string;
  action_client: string;
}

export interface ChiffresCles {
  besoin_total: number;
  apport: number;
  credit_calcule: number;
  pic_tresorerie: number;
  credit_propose: number;
  duree_mois: number;
  differe_mois: number;
  ebe: number;
  dscr: number;
  dscr_stresse_min: number;
  point_mort_production: number;
  point_mort_prix: number;
  couverture_garanties: number;
  teg_approx: number;
}

export type DecisionCode =
  | 'FAVORABLE'
  | 'FAVORABLE_SOUS_CONDITIONS'
  | 'A_INSTRUIRE'
  | 'DEFAVORABLE_EN_L_ETAT'
  | '';

export interface AnalysisResult {
  statut: 'ANALYSE_COMPLETE' | 'DONNEES_INCOMPLETES' | 'FICHIER_NON_CONFORME';
  dossier: { code: string; client: string; date_analyse: string };
  chaine_valeur: {
    code: string; libelle: string; confiance: number;
    chaine_alternative: string | null; mixte: boolean;
  };
  chiffres_cles: Partial<ChiffresCles>;
  vraisemblance: VraisemblanceItem[];
  donnees_manquantes: string[];
  hypotheses_moteur: string[];
  retour_client: string;
  score: {
    global?: number;
    composantes?: Record<string, number>;
    comportemental_neutre_1er_cycle?: boolean;
  };
  justifications_ecarts: unknown[];
  signaux_fraude: Array<{ type: string; detail: string }>;
  controle_humain: { requis: boolean; motif: string };
  realise_vs_prevu: unknown | null;
  decision_suggeree: { code: DecisionCode; conditions: string[]; justification: string };
  routage: { destinataire: string; specialite: string | null; priorite: string };
  fichiers: { rapport_excel: string; rapport_word: string };
  version_referentiel: string;
  avertissement: string;
  analyse_ia?: { used: boolean; model: string; synthese: string };
  code?: string;
}

export interface BesoinInput {
  numero?: number | string;
  rubrique: string;
  description?: string;
  unite?: string;
  quantite?: number | string;
  cout_unitaire?: number | string;
  frequence?: number | string;
  montant_total?: number | string;
  periode?: string;
  financement?: string;
  observations?: string;
}

export interface VenteInput {
  produit: string;
  quantite?: number | string;
  unite?: string;
  taux_perte?: number | string;
  prix_unitaire?: number | string;
  recette?: number | string;
  mois_vente?: number | string;
  modalite?: string;
}

export interface AnalyseFormPayload {
  client_name?: string;
  client_phone?: string;
  garantie_estimee?: number | string;
  besoins: BesoinInput[];
  ventes: VenteInput[];
}

export interface ApplicationSummary {
  code: string;
  chain: string;
  statut: string;
  decision: string;
  created_at: string;
}

/** Une version d'un classeur ingéré (`dataio._source_dict`).
 *
 *  `sha256` et `credit_application` sont servis par le backend sur TOUTES les
 *  routes `dataio` : ils étaient absents de ce contrat, donc invisibles du
 *  compilateur — et c'est précisément l'empreinte qui rend une révision
 *  comparable à une autre (principe 3, comparaison des SHA-256 entre analyses). */
export interface DataSource {
  id: number;
  original_name: string;
  kind: string;
  status: 'STAGED' | 'COMMITTED';
  revision: number;
  is_current: boolean;
  dataset_key: string;
  uploaded_at: string;
  committed_at: string | null;
  supersedes: number | null;
  n_tables: number;
  /** Empreinte du fichier déposé. Chaîne vide tant que l'inspection n'a pas eu
   *  lieu : une source sans empreinte n'est pas rejouable, à signaler plutôt
   *  qu'à interpréter. */
  sha256: string;
  /** Code du dossier de crédit rattaché (`fb__<code>`), `null` pour les sources
   *  administratives (simulateurs, référentiels) qui n'appartiennent à aucun
   *  dossier. */
  credit_application: string | null;
  preview?: DataPreview;
}

export interface DataPreview {
  kind: string;
  n_tables: number;
  is_reupload: boolean;
  tables: Array<{
    sheet: string; columns: string[]; n_columns: number; n_rows: number; sample: string[][];
  }>;
}

export interface SourceRow {
  id?: number;                                   // id de la ligne → édition ciblée
  values: Record<string, string | null>;
}

export interface SourceTable {
  id?: number;                                   // id de la table (présent = éditable)
  name: string;
  n_rows: number;
  n_cols: number;
  editable?: boolean;
  columns: Array<{ name: string; dtype: string }>;
  rows: SourceRow[];
}

export interface SourceTablesResponse {
  source: DataSource;
  tables: SourceTable[];
}

// --- Portefeuille de crédits (Module Crédits Agricoles, admin) ---
export interface LoanRow {
  id: string;
  date: string;
  operator: string;
  type: string;
  amountRequested: number;
  amountApproved: number;
  amountDisbursed: number;
  currency: string;
  duration: number;
  /** Taux **MENSUEL** en points de pourcentage. Son unité est servie à côté :
   *  affiché sans elle, « 2 » se lit 2 %/an au lieu de 24 %/an. */
  rate: number;
  rateUnit?: string;
  /** Taux **ANNUEL** figé avec le prêt (`portfolio/rates.py`). `null` sur une
   *  ligne héritée que `_accorder_les_taux()` n'a pas encore complétée — il
   *  n'est alors PAS reconstitué côté front (cf. `lib/loanRateDisplay.ts`). */
  annualRate?: number | null;
  annualRateUnit?: string;
  dueDate: string;
  manager: string;
  investor: string;
  source: string;
  status: string;
  statusCode: string;
  score: number;
  guarantee: string;
  progress: number;
  frequency: string;
  startDate: string;
  outstanding: number;
  repaid: number;
}

export interface SummaryCard {
  title: string;
  value: string;
  icon: string;
  trendValue?: string;
  trendDirection?: 'up' | 'down';
}

export interface LoanTxn {
  id: number;
  date: string;
  kind: string;
  type: string;
  amount: number | null;
  currency: string;
  originalAmount: number | null;
  originalCurrency: string;
  paymentMethod: string;
  ref: string;
  status: string;
  verifiedBy: string;
  balance: number;
  subwalletId: number | null;
}

export interface ScheduleRow {
  number: number;
  date: string;
  principal: number;
  interest: number;
  total: number;
  balance: number;
}

export interface LoanConfig {
  currentConfig: {
    /** MENSUEL — `config_payload()` sert son unité dans `rateUnit`. */
    rate: number;
    rateUnit?: string;
    /** ANNUEL, `null` tant que le serveur ne l'a pas figé. Jamais déduit du mensuel. */
    annualRate?: number | null;
    annualRateUnit?: string;
    duration: number; frequency: string; status: string; statusCode: string; startDate: string;
  };
  history: Array<{ date: string; action: string; user: string; details: string }>;
  schedule?: ScheduleRow[];
  totals?: { total_principal: number; total_interest: number; total_payments: number; apr: number };
  currency?: string;
}

// --- Espace client crédits (Credits.jsx) — sous-portefeuilles par module, garanties,
// paiements/réajustement (backend `portfolio`, endpoints `/portfolio/mine*`). ---
export interface LoanSubWallet {
  id: number;
  moduleKey: string;
  label: string;
  allocatedAmount: number;
  balance: number;
}

export interface LoanGuarantee {
  id: number;
  type: string;
  label: string;
  description: string;
  value: number | null;
}

export interface ClientLoan extends LoanRow {
  subwallets: LoanSubWallet[];
  guarantees: LoanGuarantee[];
  transactions: LoanTxn[];
  schedule: ScheduleRow[];
  totals?: { total_principal: number; total_interest: number; total_payments: number; apr: number };
}

export interface LoanAlert { reference: string; operator: string; level: string; message: string }

export interface ReferenceRange {
  chain_code: string;
  chain_libelle: string;
  name: string;
  systeme: string;
  unite: string;
  cycle_months: number | null;
  parametre_cle: string;
  rendement: [number | null, number | null];
  cout: [number | null, number | null];
  prix: [number | null, number | null];
  perte_max: number | null;
  statut: string;
  a_valider: boolean;
}

// --- Investissements (backend Django `investments` — schéma canonique, fusion des 3
// modèles mock historiques d'AdminConsole/AdminInvestments/InvestorSpace) ---
export interface InvestmentProject {
  id: number;
  code: string;
  title: string;
  sector: string;
  location: string;
  promoter: string;
  status: string; // P01..P13
  fundingTarget: number;
  /** ENCAISSÉ (B10) — jamais les réservations, qui vivent sur l'offre. */
  fundedAmount: number;
  progressPercent: number;
  disbursedAmount: number;
  returnedAmount: number;
  distributedAmount: number;
  riskScore: number;
  globalScore: number;
  managerName: string;
  managerSub: string;
  isInvestable: boolean;
}

export interface InvestmentOffer {
  id: number;
  code: string;
  projectId: number;
  /** `investments.Offer.TypeOfTitle` : OBLIGATION (dette) | ACTION (capital). */
  typeOfTitle: string;
  couponRate: number;
  maturityMonths: number;
  minTicket: number;
  bondUnitValue: number;
  minBonds: number;
  maxBonds: number;
  availableBonds: number;
  fundingGoal: number;
  /** Engagements pris (réservations) — une intention, pas de l'argent reçu. */
  reservedAmount: number;
  /** Argent réellement encaissé sur l'offre. */
  fundedAmount: number;
  minFundingAmount: number;
  oversubscriptionPolicy: string;
  subscriptionDeadline: string | null;
  closedAt: string | null;
  status: string;
  /** Unité de chaque taux de cette ligne, déclarée par le serveur (`units`).
   *  Le module stocke ses taux dans DEUX unités jusque dans la même table :
   *  `couponRate` en points de pourcentage (9.0), `loanToValue` en fraction
   *  (0.6). Lire ce dictionnaire — jamais supposer. */
  units?: Record<string, string>;
}

export interface InvestorProfile {
  id: number;
  userSub: string;
  investorType: string;
  kycStatus: string;
  riskProfile: string;
  status: string;
  assignedManagerSub: string;
}

export interface InvestmentSubscription {
  id: number;
  investorId: number;
  offerId: number;
  /** RÉSERVÉ — un engagement, pas un placement. */
  amount: number;
  /** Servi après arbitrage de sursouscription. */
  allocatedAmount: number;
  /** Réellement ENCAISSÉ (B10) — la seule grandeur qui vaut « investi ». */
  settledAmount: number;
  refundedAmount: number;
  bonds: number;
  queueRank: number | null;
  status: string;
  paymentStatus: string;
  /** Taux de coupon FIGÉ à la souscription, en POURCENTS (ex. 12.5). */
  couponRate: number;
  subscriptionDate: string;
  reservedAt: string | null;
  settledAt: string | null;
  refundedAt: string | null;
  nextPaymentDate: string | null;
  totalReceived: number;
  subPortfolioId: number | null;
  /** Unité de chaque taux de cette ligne, déclarée par le serveur (`units`).
   *  Le module stocke ses taux dans DEUX unités jusque dans la même table :
   *  `couponRate` en points de pourcentage (9.0), `loanToValue` en fraction
   *  (0.6). Lire ce dictionnaire — jamais supposer. */
  units?: Record<string, string>;
}

export interface InvestmentMovement {
  id: number;
  type: string;
  investorId: number | null;
  projectId: number | null;
  amount: number;
  currency: string;
  status: string;
  geographicZone: string;
  dateTime: string;
}

export interface PortfolioAllocation {
  /** Total historique — additionne DEUX grandeurs qui ne se valent pas (voir la
   *  ventilation ci-dessous). Conservé pour compatibilité ; à ne pas afficher
   *  seul sous le libellé « obligations ». */
  bonds: number;
  /** Argent reçu et comptabilisé (B10), rapprochable d'une pièce. */
  bondsFromSubscriptions?: number;
  /** Positions obligataires à montant saisi libre, aux termes issus des défauts
   *  du modèle, rattachées à aucune offre : jamais passées par un encaissement. */
  bondsFromObligationPositions?: number;
  obligationPositionsCount?: number;
  /** Non nul = deux écrans afficheront deux « investi » pour le même
   *  investisseur. À afficher, pas à taire. */
  reconciliationWarning?: string | null;
  cash: number;
  /** Aucun produit actions n'existe encore : trou produit assumé, pas inventé. */
  stocks: number;
}

// --- Métriques investisseur (backend `investments/metrics.py`, annexe D du prompt
// HAZINA). Ces chiffres sont CALCULÉS PAR LE SERVEUR sur flux datés réels : le front
// les affiche, il ne les recompose pas.
//
// UNITÉS : le module servait deux conventions dans la même réponse (XIRR en fraction,
// coupon en points de pourcentage). Il n'en sert plus qu'une — la FRACTION — et il la
// DÉCLARE, champ par champ, dans `units`. Un consommateur ne devine jamais l'unité
// d'un taux financier : il lit `units`. Voir `investorSpaceWire.rateToPercent`.

/** Contexte obligatoire de tout agrégat monétaire : la devise est VÉRIFIÉE sur les
 *  flux, jamais postulée. `mixedCurrency` vrai = l'agrégat additionne des devises
 *  sans taux journalisé, donc il n'est pas exploitable : afficher l'avertissement. */
export interface CurrencyNote {
  currency: string;
  currenciesObserved: string[];
  conversionRate: number | null;
  mixedCurrency: boolean;
  mixedCurrencyWarning: string | null;
}

/** Période RÉELLEMENT couverte par les flux — pas une période déclarée. */
export interface MetricsPeriod {
  from: string | null;
  to: string;
  flowsCount: number;
  basis: string;
}

/** Une position valorisée, servie uniquement à son titulaire (`valuation.positions`,
 *  absent de la vue institution). C'est ce détail qui rend une alerte de défaut
 *  exploitable : un agrégat ne dit jamais QUELLE ligne a décroché. */
export interface ValuationPosition {
  subscriptionId: number;
  offerCode: string;
  projectCode: string;
  projectStatus: string;
  typeOfTitle: string;
  sector: string;
  location: string;
  settledAmount: number;
  /** Remboursements de CAPITAL reçus — distincts des coupons. */
  capitalRepaid: number;
  couponsReceived: number;
  principalAtPar: number;
  capitalOutstanding: number;
  /** Peut être NÉGATIF : une moins-value latente est une information. */
  latentGain: number;
  /** PAIR | PROVISION_P12 | EXPERTISE_DATEE | PAIR_FAUTE_D_EXPERTISE */
  valuationMethod: string;
  /** Taux de recouvrement retenu sur un P12, en fraction. `null` hors défaut. */
  recoveryRate: number | null;
  /** Perte ESTIMÉE sur cette position (0 hors dépréciation). */
  impairment: number;
  valuationNote: string;
}

export interface InvestorValuation {
  capitalOutstanding: number;
  /** Détail par position — présent côté investisseur, absent côté institution. */
  positions?: ValuationPosition[];
  /** Gain LATENT — non encaissé. Ne jamais l'additionner au réalisé. */
  latentGain: number;
  latentGainIsLatent: boolean;
  /** Capital restant dû + gain latent, borné à zéro. */
  totalValue: number;
  positionsCount: number;
  byMethod: Record<string, { positionsCount: number; amount: number }>;
  methodNotes: string[];
  /** Méthode de valorisation, à afficher avec le chiffre (annexe D). */
  method: string;
}

/** Taux de défaut en valeur ET en nombre — les deux, toujours, avec leurs bases. */
export interface DefaultRates {
  byValue: number;
  byCount: number;
  defaultedValue: number;
  defaultedProjects: number;
  totalProjects: number;
  totalValue: number;
  alertThreshold: number;
  alert: boolean;
}

/** Une ligne de ventilation : montant ET part, servis par le serveur. */
export interface ExposureLine {
  key: string;
  amount: number;
  share: number;
}

export interface ConcentrationMetrics {
  exposureBySector: ExposureLine[];
  exposureByLocation: ExposureLine[];
  herfindahlSector: number;
  herfindahlGeography: number;
  /** Axe le plus concentré des deux — celui qui pénalise le score de santé. */
  herfindahlRetained: number;
  retainedAxis: string;
  threshold: number;
  highConcentration: boolean;
  largestExposureShare: number;
  largestExposureProject: string | null;
  largestSector: string | null;
  largestSectorShare: number;
  largestLocation: string | null;
  largestLocationShare: number;
  projectsCount: number;
  sectorsCount: number;
  locationsCount: number;
  basisAmount: number;
}

export interface LateProjects {
  share: number;
  lateProjects: number;
  totalProjects: number;
  projectsWithSchedule: number;
  /** Avertissement de couverture : sans échéancier, le retard est un plancher. */
  scheduleCoverageWarning: string | null;
}

/** Score de santé publiable tel quel : formule, paramètres réellement appliqués,
 *  entrées et pénalités — de quoi refaire le calcul à la main. */
export interface HealthScore {
  score: number;
  rawScore: number;
  clamped: boolean;
  formula: string;
  parameters: { a: number; b: number; c: number; h0: number };
  inputs: { defaultRate: number; herfindahl: number; lateShare: number };
  penalties: { default: number; concentration: number; late: number };
}

export interface NextPayment {
  nextPaymentDate: string | null;
  /** `repayment_schedule` | `subscription.next_payment_date` | `null`. */
  nextPaymentSource: string | null;
  upcomingCount: number;
  offersWithSchedule: number;
  offersCount: number;
  /** Motif écrit pour être AFFICHÉ quand aucune date n'est établissable. */
  unavailableReason: string | null;
}

export interface InvestorMetrics extends CurrencyNote {
  totalInvested: number;
  totalSettled: number;
  totalRefunded: number;
  totalDistributed: number;
  /** Capital restant dû + gain latent — grandeur DISTINCTE du total investi. */
  totalValue: number;
  positionsCount: number;
  /** XIRR sur flux réels, en FRACTION. `null` = n'existe pas encore. */
  realizedReturn: number | null;
  /** Motif d'indisponibilité, destiné à être AFFICHÉ tel quel. */
  realizedReturnUnavailableReason: string | null;
  /** Coupon contractuel pondéré. Unité déclarée par `units.expectedCouponRate`. */
  expectedCouponRate: number;
  expectedCouponBasis: number;
  expectedCouponPositions: number;
  valuation: InvestorValuation;
  defaultRates: DefaultRates;
  concentration: ConcentrationMetrics;
  lateProjects: LateProjects;
  health: HealthScore;
  nextPayment: NextPayment;
  nextPaymentDate: string | null;
  period: MetricsPeriod;
  /** Unité de chaque taux, chemin pointé → `fraction` | `points_sur_100`. */
  units: Record<string, string>;
  asOf: string;
  scope: string;
}

export interface InvestmentPipelineStage {
  stage: string;
  label: string;
  count: number;
  aggregateTarget: number;
}

/** `GET /investments/pipeline` — `projects` est TOUJOURS vide pour un investisseur
 *  (asymétrie d'information : les dossiers P01→P05 ne sortent qu'agrégés). */
export interface InvestmentPipeline {
  stages: InvestmentPipelineStage[];
  projects: InvestmentProject[];
}

/** `GET /investments/offers/open` — `metrics.open_offers_summary()`. Forme DISTINCTE
 *  de `InvestmentOffer` : projection restreinte, mais désormais complète pour
 *  souscrire (bornes, typologie) et pour juger (score de risque du projet).
 *
 *  `couponRate` est ici en POINTS DE POURCENTAGE (9.0 = 9 %), tel que stocké sur
 *  `Offer.coupon_rate` — la conversion en fraction n'a lieu que dans
 *  `investments/metrics/mine`, qui déclare ses unités. Deux endpoints, deux
 *  conventions : ne pas transposer l'une sur l'autre. */
export interface OpenOfferSummary {
  offerId: number;
  offerCode: string;
  projectCode: string;
  title: string;
  sector: string;
  location: string;
  typeOfTitle: string;
  paymentFrequency: string;
  couponRate: number;
  maturityMonths: number;
  minTicket: number;
  bondUnitValue: number;
  minBonds: number;
  maxBonds: number;
  availableBonds: number;
  fundingGoal: number;
  riskScore: number;
  globalScore: number;
  riskCategory: string;
  reservedAmount: number;
  fundedAmount: number;
  minFundingAmount: number;
  oversubscriptionPolicy: string;
  subscriptionDeadline: string | null;
  /** Unité de chaque taux de cette projection (`{couponRate: "percent"}`).
   *  `metrics/mine` sert des fractions, `offers/open` des points de
   *  pourcentage : deux endpoints, deux conventions, les deux DÉCLARÉES. */
  units?: Record<string, string>;
}

export interface ObligationPosition {
  id: number;
  name: string;
  couponAmount: number;
  investedAmount: number;
  rate: number;
  termMonths: number;
  status: string;
  dateCreated: string;
  /** Unité de chaque taux de cette ligne, déclarée par le serveur (`units`).
   *  Le module stocke ses taux dans DEUX unités jusque dans la même table :
   *  `couponRate` en points de pourcentage (9.0), `loanToValue` en fraction
   *  (0.6). Lire ce dictionnaire — jamais supposer. */
  units?: Record<string, string>;
}

export interface BondWithdrawal {
  id: number;
  positionId: number;
  amount: number;
  penaltyRate: number;
  reason: string;
  status: string;
  date: string;
  /** Unité de chaque taux de cette ligne, déclarée par le serveur (`units`).
   *  Le module stocke ses taux dans DEUX unités jusque dans la même table :
   *  `couponRate` en points de pourcentage (9.0), `loanToValue` en fraction
   *  (0.6). Lire ce dictionnaire — jamais supposer. */
  units?: Record<string, string>;
}

export interface BondConversion {
  id: number;
  positionId: number;
  coupons: number;
  value: number;
  shares: number;
  status: string;
  date: string;
}

export interface TechnicalAnalysis {
  projectId: number;
  landSize: number;
  productionCapacity: number;
  productionCycleMonths: number;
  yieldForecast: number;
  climateRisk: string;
  mitigation: string;
}

export interface FinancialAnalysis {
  projectId: number;
  investmentBreakdown: Record<string, number>;
  revenueForecast: Record<string, unknown>;
  costStructure: Record<string, number>;
  cashflowProjection: Record<string, unknown>;
  ebitdaMargin: number;
  dscr: number;
  irr: number;
  financialScore: number;
}

export interface Collateral {
  offerId: number;
  debtType: string;
  guarantees: string[];
  collateralValue: number;
  /** FRACTION (0.6 = 60 %) — l'unité est déclarée dans `units`. */
  loanToValue: number;
  /** Unité de chaque taux de cette ligne, déclarée par le serveur (`units`).
   *  Le module stocke ses taux dans DEUX unités jusque dans la même table :
   *  `couponRate` en points de pourcentage (9.0), `loanToValue` en fraction
   *  (0.6). Lire ce dictionnaire — jamais supposer. */
  units?: Record<string, string>;
}

export interface AnalystObservation {
  id: number;
  projectId: number;
  category: string;
  riskFlag: string;
  observation: string;
  recommendation: string;
}

export interface ProjectQuestion {
  id: number;
  projectId: number;
  question: string;
  questionDate: string;
  answer: string;
  answerDate: string | null;
  answeredBy: string;
  status: string;
}

export interface PerformanceReport {
  id: number;
  projectId: number;
  reportingPeriod: string;
  submissionDate: string;
  actualRevenue: number;
  forecastRevenue: number;
  actualCosts: number;
  forecastCosts: number;
  actualProduction: number;
  forecastProduction: number;
  /** Écart de REVENU — nom historique, identique à `revenueDeviationPercent`. */
  deviationPercent: number;
  revenueDeviationPercent: number;
  costDeviationPercent: number;
  productionDeviationPercent: number;
  /** SENS de chaque écart, décidé par le serveur. Un écart de +20 % sur les coûts
   *  et un écart de +20 % sur le revenu ont la même forme et le sens inverse :
   *  l'écran lit ce booléen, il ne rejoue pas la règle métier. */
  unfavorable: { revenue: boolean; costs: boolean; production: boolean };
  /** Une prévision a-t-elle été posée ? Sans elle, un écart de 0 % ne veut pas
   *  dire « conforme », il veut dire « rien à comparer ». */
  hasForecast: { revenue: boolean; costs: boolean; production: boolean };
  deviationComments: string;
  validationStatus: string;
  validatedBy: string;
  validationDate: string | null;
}

// --- Support (backend Django `support`) — tickets CRM (Support.jsx) : fil de messages
// réel + assignation d'agent (niveau L1/L2/L3), plutôt qu'une simulation locale. ---
export interface TicketRow {
  id: number;
  publicId: string;
  category: string;
  priority: string;
  status: string;
  level: string;
  assignedTo: string;
  assignedTeam: string;
  subject: string;
  description: string;
  createdAt: string;
  clientName: string;
  clientSub: string;
  waitingOn: 'agent' | 'client';
  rejectType: string;
  slaFirstResponseDue: string | null;
  slaResolutionDue: string | null;
  slaBreachedFirstResponse: boolean;
  slaBreachedResolution: boolean;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  rejectedReason: string;
  reopenedCount: number;
  satisfactionRating: number | null;
  satisfactionComment: string;
  suggestedActions: string[];
  availableActions: string[];
  hasMmAnomaly: boolean;
  awaitingSince: string | null;
  assignee: { sub: string; displayName: string; role: string } | null;
  pendingFinancialAction: {
    id: number; amount: string; currency: string;
    initiatedBy: string; initiatedByName: string; createdAt: string;
  } | null;
}

export interface SupportDashboardStats {
  open: number;
  escalated: number;
  resolved24h: number;
  avgSatisfaction: number | null;
  byCategory: Record<string, number>;
  outOfSla: number;
}

export interface TicketMessage {
  id: number;
  author: { displayName: string; initials: string; role: string; isSystem: boolean };
  authorSub: string;
  authorName: string;
  authorRole: string;
  text: string;
  isInternal: boolean;
  createdAt: string;
  meta: { actionSource: string; simulated: boolean };
}

export interface ClientProfile360 {
  id: string;
  publicRef: string;
  displayName: string;
  initials: string;
  segment: string;
  memberSince: string | null;
  kyc: {
    status: string; level: string; missingDocuments: string[];
    lastReviewedAt: string | null; limitations: string;
  };
  risk: { level: string; flags: string[]; score: number | null };
  finances: {
    balanceFc: string | null; balanceUsd: string | null;
    loansActive: number; loansInArrears: number; lastTransactionAt: string | null;
  };
  supportHistory: {
    totalTickets: number; openTickets: number;
    lastTickets: Array<{ id: string; subject: string; status: string; created: string }>;
    avgSatisfaction: number | null; isRepeatIssue: boolean; repeatIssueHint: string;
  };
  contact: { phoneMasked: string; emailMasked: string; preferredChannel: string; language: string };
  warnings: string[];
}

// --- RBAC (backend Django `rbac`) — source de vérité unique des 16 rôles + capacités,
// remplace les constantes ROLES/PERMISSIONS_MATRIX/USER_LEVELS codées en dur dans
// Users.jsx/Roles.jsx. ---
export interface RbacCapabilities {
  read: boolean;
  create: boolean;
  validate: boolean;
  disburse: boolean;
  audit: boolean;
  config: boolean;
}

export interface RbacMe {
  role: string;
  level: number;
  zone: string;
  capabilities: RbacCapabilities;
  isSupervisor: boolean;
  viewOverride: string;
}

export interface RbacRole {
  id: string;
  label: string;
  level: number;
  type: string;
  permissions: RbacCapabilities;
  isSupervisor: boolean;
  isCustom: boolean;
  isOverridden: boolean;
}

export interface RbacUser {
  sub: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  level: number;
  zone: string;
  assignmentId: number | null;
  perOperationCeiling: number | null;
  status: string; // "Actif" | "Suspendu"
  lastLogin: string | null;
  viewOverride: string;
  security: { locked: boolean; pinResetRequired: boolean; mfaPolicyRequired: boolean };
}

// --- Caisses (backend Django `caisses`) — retraits/régularisations à palier
// auto/manager/quorum, séances de caisse, rattachement partenaire Mobile Money. ---
export interface WithdrawalRequestRow {
  detail: string;
  requestId: number;
  amount: number;
  status: string; // FlowStatus : "pending_validation" | "posted" | "rejected" | ...
  autoValidated: boolean;
  requiredApprovals: number;
  approvalsCount: number;
  movementId: number | null;
}

/**
 * Réponse discriminée de POST /caisses/wallets/mine/deposit.
 *
 * `kind: "movement"` → dépôt interne réglé ; `kind: "payment_order"` → dépôt
 * externe confié à Makuta, crédité seulement à `status: "CONFIRMED"`. La
 * discrimination vit dans `@/components/treasury/depositOutcome` — ce type reste
 * volontairement permissif (champs optionnels) pour ne pas mentir sur une forme
 * que seul le serveur arrête.
 */
export interface WalletDepositResult {
  kind?: 'movement' | 'payment_order';
  detail?: string;
  movementId?: number | null;
  amount?: number | string;
  reference?: string;
  status?: string;
  currency?: string;
  direction?: string;
  awaitingReconciliation?: boolean;
  failureDetail?: string | null;
}

/**
 * Ordre de paiement (fournisseur Makuta) tel que servi au client — montants en
 * CHAÎNES (`str(Decimal)`), jamais en float : c'est la pièce comparée au relevé
 * de l'opérateur. `awaitingReconciliation` empêche le front de proposer un
 * rejeu (un ordre indéterminé peut avoir abouti chez le fournisseur).
 */
export interface PaymentOrderRow {
  reference: string;
  status: string; // PaymentOrder.Status : PENDING | SENT | AWAITING_CONFIRMATION | INDETERMINATE | CONFIRMED | REFUSED | CANCELLED
  detail: string;
  direction: string; // 'COLLECTION' (dépôt) | 'PAYOUT' (retrait)
  operation: string;
  amount: string;
  currency: string;
  counterparty: string;
  walletId: number;
  treasuryAccountCode: string | null;
  providerReference: string | null;
  movementId: number | null;
  reversalMovementId: number | null;
  awaitingReconciliation: boolean;
  failureDetail: string | null;
  createdAt: string | null;
  sentAt: string | null;
  settledAt: string | null;
  createdBy: string;
}

export interface RegularizationOrderRow {
  detail: string;
  orderId: number;
  amount: number;
  status: string;
  autoValidated: boolean;
  requiredApprovals: number;
  approvalsCount: number;
  movementId: number | null;
  ticketId: number | null;
}

export interface CashRegisterSessionRow {
  id: number;
  accountCode: string;
  status: 'OPEN' | 'CLOSED' | 'DISCREPANCY';
  openedBy: string;
  openingCount: number;
  openingBalanceExpected: number;
  openedAt: string;
  cashInTotal: number;
  closedBy: string;
  closingCount: number | null;
  closingBalanceExpected: number | null;
  discrepancy: number | null;
  closedAt: string | null;
}

export interface KycMine {
  kycStatus: string;
  kycLevel: string; // "T1" | "T2" | "T3"
  monthlyLimit: number;
  withdrawnThisMonth: Record<string, number>;
}

// --- Agences (backend Django `agencies`) — score de conformité par agence + plan
// d'évolution de catégorie réseau (checklist de prérequis). ---
export interface AgencyComplianceScore {
  score: number | null;
  components: Array<{ code: string; label: string; weight: number; score: number | null }>;
}

export interface EvolutionPlanItemRow {
  id: number;
  label: string;
  order: number;
  isDone: boolean;
  doneBy: string;
  doneAt: string | null;
}

export interface EvolutionPlanRow {
  id: number;
  agencyCode: string;
  fromType: string;
  toType: string;
  reason: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  items: EvolutionPlanItemRow[];
}

// Plan comptable SYSCOHADA révisé (Accounting.jsx > Plan Comptable).
export interface LedgerAccount {
  code: string; // hiérarchique : 2 chiffres (compte principal) / 3 (sous-compte) / 4 (divisionnaire)
  name: string;
  classNo: number; // 1-8 (classe 9 facultative, non utilisée)
  nature: 'ACTIF' | 'PASSIF' | 'CHARGE' | 'PRODUIT'; // sens normal du solde
  isCoreActivity: boolean; // false = présent uniquement pour la conformité SYSCOHADA, pas utilisé par AGRICAP
  currencies: string[]; // ex. ["CDF", "USD"] si le compte est bi-monnaie
  parent: number | null; // id (PK) du compte parent, pas son code
}

// Générateur d'États Financiers (FinancialStatementsViewer.jsx).
export interface LedgerStatementRow {
  code: string;
  name: string;
  nature: 'ACTIF' | 'PASSIF' | 'CHARGE' | 'PRODUIT';
  debit: number;
  credit: number;
  balance: number; // déjà signé "normal" (positif = sens attendu selon la nature)
  risque?: boolean; // present sur "creances" : créance litigieuse/douteuse ou en souffrance
}

export interface SigRow { label: string; amount: number }

export interface CashflowCategory { key: string; label: string; amount: number }
export interface CashflowStatement { categories: CashflowCategory[]; variationTresorerie: number }

// ─────────────────────────────────────────────────────────────────
// Module Crédits Agricoles — backend Django /api/credits/
// ─────────────────────────────────────────────────────────────────

export type CreditApplicationStatus =
  | 'draft' | 'submitted' | 'in_analysis' | 'approved'
  | 'pending_disbursement' | 'active' | 'closed'
  | 'rejected' | 'adjourned';

export interface CreditClient {
  sub: string;
  displayName: string;
  phone: string;
}

export interface CreditValueChain {
  code: string;
  label: string;
  cycle_months?: number;
  base_rate?: number;
}

/** Feuille de besoins telle que sérialisée dans `CreditApplication.needsSheet`.
 *
 *  Le sérialiseur (`workflow.serialize_application`) n'émet que six clés :
 *  `id, parsedOk, grandTotal, currency, warnings, anomalies`. `area_ha` y était
 *  déclaré **non optionnel** alors qu'il n'est jamais émis — l'écran analyste
 *  affichait donc une superficie vide en toutes circonstances, sans qu'aucun
 *  outil ne puisse le signaler.
 *
 *  `totalByModule` et `uploadedAt` restent optionnels : ils proviennent de la
 *  réponse de `needs-sheet/parse/`, pas de ce sérialiseur. */
export interface CreditNeedsSheet {
  id?: number;
  grandTotal: number;
  currency: string;
  parsedOk: boolean;
  warnings?: string[];
  /** Signaux relevés au parsing — la première chose qu'un analyste regarde sur
   *  une feuille de besoins.
   *
   *  Producteur unique : `credits.needs_parser` (`anomalies: list[str]`, que des
   *  f-strings prêtes à l'affichage). Si un jour une anomalie devient structurée
   *  (`{code, message}`), c'est ici qu'il faut le déclarer — sinon les écrans
   *  rendront des « [object Object] » sans qu'aucun outil ne le signale. */
  anomalies?: string[];
  totalByModule?: Record<string, number>;
  uploadedAt?: string;
}

/**
 * Une ligne du détail de score, telle que le backend la sert réellement.
 *
 * Ce type déclarait `criterion`, une clé qu'aucune des deux sources n'émet :
 * `scoring.py` et `dataio_simulator.py` servent toutes deux `code` + `label`.
 * L'écart était invisible à `tsc` — le type mentait, donc le compilateur
 * validait `b.criterion.replace(...)` sur un `undefined` garanti à l'exécution.
 *
 * `label` est déjà rédigé en français par le backend (« Fiabilité technique ») :
 * il s'affiche tel quel, sans dérivation cosmétique depuis le code.
 */
export interface CreditScoreBreakdown {
  code: string;
  label: string;
  /** Points PONDÉRÉS déjà calculés par le serveur (`score × poids / 100`).
   *  Leur somme tombe exactement sur le score global — c'est l'invariant que
   *  l'analyste vérifie de tête (CLAUDE.md §5.2). `null` = critère NON
   *  CALCULABLE, exclu de la pondération : ne jamais l'afficher comme un 0,
   *  ce serait une note fabriquée par l'écran. */
  points: number | null;
  /** Poids du critère : la colonne se lit « 8,5 / 25 ». */
  maxPoints: number;
  weight?: number;
  weightedScore?: number | null;
  /** Score du critère sur 100, `null` quand il n'est pas calculable. */
  score?: number | null;
  /** Servi par le simulateur (`dataio_simulate`) : `false` porte la RAISON dans
   *  `detail`. Absent sur `scoring.py`, qui ne projette que des critères calculés. */
  calculable?: boolean;
  detail?: string;
}

/** Projection de la dernière analyse dans l'ancien format `score_result`
 *  (`credits/scoring.py::CreditScoringEngine`).
 *
 *  ⚠ Sans analyse exécutée, `score` et `proposedRate` sont **ABSENTS** — pas
 *  nuls. C'est un contrat, pas un hasard (`_sans_analyse`) : une clé absente se
 *  détecte, une clé nulle se propage en `NaN`. Ne jamais lire `score` sans
 *  garder `analyseDisponible` (ou l'absence de la clé) d'abord. */
export interface CreditScoreResult {
  score?: number;
  eligible: boolean;
  valuationNote: string;
  proposedRate?: number;
  minScoreRequired?: number;
  breakdown?: CreditScoreBreakdown[];
  /** `false` = le moteur n'a jamais tourné sur ce dossier. `unavailable` en dit
   *  la raison et l'action (`ANALYSE_REQUISE`). */
  analyseDisponible?: boolean;
  unavailable?: { code: string; message: string };
  /** Provenance du score : quelle analyse, quelle feuille de besoins, quel
   *  moteur. Sans elle, `score_result` serait un chiffre sans auteur. */
  analyse?: {
    id: number;
    recommandation: CreditRecommandation;
    scoreLettre: 'A' | 'B' | 'C' | 'D';
    dscr: number | null;
    dscrStress: number | null;
    executeLe: string | null;
    versionMoteur: string;
    needsSourceId: number | null;
    needsSourceRevision: number | null;
    needsSourceSha256: string;
  };
  scheduleDraft?: Array<{ month: number; payment: number; principal: number; interest: number; balance: number }>;
  // Totaux servis par le serveur (`dataio_simulator.dataio_simulate`) : le front
  // ne somme jamais l'échéancier lui-même.
  scheduleTotals?: { totalPrincipal: number; totalInterest: number; totalPayments: number; count: number };
}

/** Actif sous-jacent d'un gage, tel qu'imbriqué dans une garantie
 *  `materiel`/`foncier` par `credits.guarantees.get_guarantee_summary`. */
export interface CreditGuaranteeAsset {
  id: number;
  name: string;
  /** Catégorie du registre : materiel | foncier | vehicule | stock | autre */
  category: string;
  /** Valeur déclarée par le client — ne couvre RIEN. */
  declaredValue: number;
  /** Valeur retenue après décote — la seule qui entre dans la couverture. */
  retainedValue: number | null;
  currency: string;
  status: string;
  verifiedAt: string | null;
}

export interface CreditGuaranteeItem {
  id: number;
  /** Codes canoniques du backend (principe 6). */
  type: 'epargne' | 'morale' | 'materiel' | 'foncier';
  status: 'pending' | 'active' | 'released' | 'expired';
  /** Montant réellement couvert, après décote. */
  coveredAmount?: number | null;
  createdAt: string;
  // Gage sur actif (materiel / foncier)
  asset?: CreditGuaranteeAsset;
  // Nantissement épargne
  holdAmount?: number;
  holdCurrency?: string;
  holdReference?: string;
  holdPlacedAt?: string | null;
  availableBalance?: number | null;
  // Caution solidaire
  guarantorName?: string;
  guarantorPhone?: string;
  confirmedAt?: string | null;
  expiresAt?: string | null;
  isExpired?: boolean;
  daysLeft?: number | null;
}

/** Couverture agrégée d'un dossier.
 *  Calculée sur les **valeurs retenues** des garanties ACTIVES uniquement —
 *  une garantie en attente de confirmation ne couvre rien. */
export interface CreditGuaranteeCoverage {
  retainedTotal: number;
  currency: string;
  requestedAmount: number | null;
  ratio: number | null;
  activeCount: number;
}

export interface CreditGuaranteeSet {
  count: number;
  guaranteeType: 'epargne' | 'morale' | 'materiel' | 'foncier' | null;
  items: CreditGuaranteeItem[];
  coverage?: CreditGuaranteeCoverage;
}

export interface CreditDisbursement {
  status: 'pending' | 'confirmed' | 'cancelled';
  amount: number;
  currency: string;
  requestedBySub: string;
  requestedAt: string;
  confirmedBySub: string | null;
  confirmedAt: string | null;
  loanId: number | null;
  journalEntryId: number | null;
  notes: string | null;
}

export interface CreditModuleAllocation {
  module: string;
  cost: number;
  financingPct: number;
  amountFinanced: number;
  source: 'needs_sheet' | 'referential' | 'manual';
}

/** Dossier de crédit, tel que réellement sérialisé par
 *  `backend/credits/workflow.py::serialize_application`.
 *
 *  Jusqu'en juillet 2026 ce type déclarait huit champs en snake_case
 *  (`value_chain`, `amount_requested`, `score_result`…) que le backend émet en
 *  camelCase. Les clés ne se croisaient jamais : les écrans affichaient « — »
 *  sur des données pourtant présentes, et TypeScript ne signalait rien puisque
 *  c'était le type qui mentait. Toute évolution de `serialize_application` doit
 *  être répercutée ici — c'est le seul garde-fou du front. */
export interface CreditApplication {
  code: string;
  status: CreditApplicationStatus;
  client: CreditClient;
  valueChain: CreditValueChain | null;
  needsSheet: CreditNeedsSheet | null;
  amountRequested: number;
  amountApproved: number | null;
  currency: string;
  areaHa: number | null;
  /** Codes canoniques du backend : `actif`/`immobilier` sont des alias d'affichage. */
  guaranteeType: 'epargne' | 'morale' | 'materiel' | 'foncier' | '' | null;
  scoreResult: CreditScoreResult | null;
  isOnBehalfOf?: boolean;
  initiatedBySub?: string | null;
  submittedAt: string | null;
  submittedBySub?: string | null;
  pendingClientConsent?: boolean;
  reviewedBySub?: string | null;
  reviewedAt?: string | null;
  approvalComment?: string | null;
  rejectionReasonCode?: string | null;
  /** Attention : `rejectionComment` sur le détail, `rejectionMessage` sur la réponse de rejet. */
  rejectionComment?: string | null;
  clientConsentAt?: string | null;
  clientConsentExpires?: string | null;
  /** Le décaissement ne vit QUE dans cet objet. Il n'existe aucun `disbursedAt`
   *  ni `disbursedAmount` à la racine — les lire produit des cartes vides. */
  disbursement: CreditDisbursement | null;
  guarantees: CreditGuaranteeSet;
  moduleAllocations: CreditModuleAllocation[];
  /** Ajouté par `ViewContextService.serialize_for_role`, pas par le sérialiseur
   *  de base : absent des réponses de transition (`approve`, `reject`…). */
  availableActions?: string[];
  createdAt: string;
  updatedAt: string;
}

// Réponse prefill
export interface CreditPrefillDebt {
  activeLoansCount: number;
  totalEncoursUsd: number;
  monthlyCapacityUsd: number | null;
  debtRatioPct: number | null;
  debtRatingLabel: string;
}

export interface CreditPrefillResult {
  client: { sub: string; displayName: string; phone: string };
  kyc: {
    level?: string;
    levelLabel?: string;
    status?: string;
    monthlyLimit?: number | null;
  };
  debt: CreditPrefillDebt;
  valueChains: Array<{
    code: string;
    label: string;
    cycle_months: number;
    cost_per_hectare_usd: number;
    base_rate: number;
    min_score_required: number;
    /** Unité de référence de la filière (`ha`, `ruche`, `sujet`, `m2`, `sac`,
     *  `t`), telle que la porte `ReferentielFiliere.unite_reference`.
     *
     *  OPTIONNELLE parce que `credits/prefill.py::_get_active_value_chains` ne
     *  la sert PAS encore (il ne lit que `ValueChain`, qui n'a pas ce champ).
     *  Tant qu'elle manque, le formulaire ne peut pas nommer l'unité d'un
     *  dossier apicole avant la première simulation : il retombe sur celle que
     *  le serveur renvoie dans `refData.uniteReference`. Manque serveur signalé,
     *  non comblé côté front — inventer une table filière → unité dans le
     *  navigateur serait un référentiel de plus (principes 6 et 8). */
    unite_reference?: string | null;
  }>;
  suggestedValueChainCode: string | null;
  onBehalfOf: boolean;
  consentRequired?: boolean;
  consentDeadlineHours?: number;
  lastNeedsSheet: {
    application_code: string;
    uploaded_at: string;
    area_ha: number | null;
    currency: string;
    grand_total: number;
    value_chain_code: string | null;
  } | null;
  defaults: { currency: string; area_ha: number | null; value_chain_code: string | null };
}

// Résultat parse needs sheet
export interface NeedsParseResult {
  id: number;
  grandTotal: number;
  currency: string;
  area_ha: number | null;
  parsedOk: boolean;
  warnings: string[];
  anomalies: string[];
  totalByModule: Record<string, number>;
}

/** Une ligne du plan de financement par module, telle que le serveur la
 *  RECALCULE (contrat §1). Le front n'en dérive aucun montant : `partDemandee`
 *  vient du serveur (`coutFichier × pct/100`, arrondi côté serveur), pas d'un
 *  produit refait dans le navigateur (principe 4 / anti-gaming). */
export interface CreditModuleFinancingLine {
  /** Code canonique du module (`semences`, `maindoeuvre`…). */
  module: string;
  /** Coût lu des DataRecord de la feuille — jamais du payload (principe 1). */
  coutFichier: number;
  /** Part demandée à AGRICAP, en % entier 0..100 (choix du client). */
  pct: number;
  /** Montant demandé sur ce module = `coutFichier × pct/100`, arrondi serveur. */
  partDemandee: number;
}

/** Dimension du projet telle que le SERVEUR l'a retenue pour la simulation.
 *
 *  Sous-ensemble volontairement étroit de `refData` (`dataio_simulate`). Le bloc
 *  complet porte aussi `refTotals` (les montants de référence du référentiel),
 *  `dscr`, `rateAnnual`, `durationMonths`, `source`… : ce sont des PLAGES et des
 *  paramètres de moteur, que le principe 7 interdit de servir au demandeur. Ils
 *  ne sont pas typés ici pour qu'aucun écran client ne puisse les lire sans
 *  d'abord les déclarer — et donc sans que la question se pose.
 *
 *  Ce qui EST typé : l'unité de référence de la filière et la dimension
 *  effectivement utilisée. Une unité n'est ni un barème ni un seuil ; sans elle
 *  le demandeur ne peut pas dimensionner son projet (30 ruches, 100 m², 5 ha),
 *  et c'est précisément ce qui déclenche `DIMENSION_INCOHERENTE` à l'analyse. */
export interface CreditSimulateRefData {
  /** Unité EXIGÉE par le référentiel de la filière (`ha`, `ruche`, `sujet`,
   *  `m2`, `sac`, `t`). `null` quand aucun référentiel n'est actif. */
  uniteReference?: string | null;
  /** Unité de la dimension que le serveur a effectivement utilisée. */
  uniteDossier?: string | null;
  /** Quantité retenue, dans `uniteDossier`. */
  quantiteReference?: number | null;
  /** Code du `ReferentielFiliere` retenu — sert à dire d'où vient l'unité. */
  referentielFiliere?: string | null;
}

// Résultat simulate
export interface CreditSimulateResult {
  /** `null` quand AUCUN critère n'est calculable : le serveur refuse alors de
   *  servir un 0 qui passerait pour une note (`unavailable.code =
   *  SCORE_NON_CALCULABLE`). L'écran affiche l'état vide, jamais un zéro. */
  score: number | null;
  eligible: boolean;
  valuationNote: string;
  proposedRate: number;
  minScoreRequired: number;
  breakdown: CreditScoreBreakdown[];
  /** Motif d'un score non servi — jamais un message générique (principe 5). */
  unavailable?: { code: string; message: string };
  /** Base de calcul de la note quand un critère a été exclu : « pas de moyenne
   *  sans effectif » (CLAUDE.md §4.6). */
  scoreCouverture?: {
    poidsCalculable: number;
    poidsTotal: number;
    nbCriteresExclus: number;
    renormalise: boolean;
  };
  /** Dimension retenue par le serveur (cf. `CreditSimulateRefData`). */
  refData?: CreditSimulateRefData;
  /** Lignage de la feuille de besoins scorée, servi en mode `application_code`. */
  needsSource?: { id?: number; revision?: number | null; sha256?: string | null };
  /** Détail du financement par module (contrat §1). Présent uniquement quand
   *  `module_financing` a été envoyé ET que le backend le prend en charge : un
   *  serveur pas encore à jour ne sert pas ces champs, d'où l'optionnalité. Le
   *  front ne recompose jamais ces montants — il les affiche tels quels. */
  moduleFinancing?: CreditModuleFinancingLine[];
  /** Montant demandé effectivement scoré = Σ `partDemandee` (et NON le total
   *  feuille). Le DSCR et l'échéancier sont calculés dessus, côté serveur. */
  montantDemandeAjuste?: number;
}

// Dashboard par rôle
export interface CreditDashboardClient {
  role: 'client';
  summary: {
    totalApplications: number;
    activeCredits: number;
    pendingApplications: number;
    rejectedApplications: number;
    closedCredits: number;
    totalEncoursUsd: number;
    consentNeeded: number;
  };
  recentApplications: Array<{ code: string; status: string; amount_requested: number; currency: string; created_at: string }>;
}

export interface CreditDashboardAgent {
  role: 'agent';
  summary: {
    totalApplications: number;
    pendingSubmission: number;
    inAnalysis: number;
    adjourned: number;
    pendingDisbursement: number;
    approved: number;
    activeCredits: number;
    staleApplications: number;
    consentExpiringSoon: number;
  };
  monthlyDisbursements: { count: number; volumeUsd: number };
}

/** Corbeille du comité — `GET /credits/dashboard/?view=committee`.
 *  Servie par `dashboard._committee_dashboard`, réservée à `COMMITTEE_ROLES`
 *  (403 sinon). Les lignes de `pendingApplications` viennent d'un `.values()`
 *  Django : elles sont en **snake_case** (et `value_chain__label` porte
 *  littéralement le double underscore), contrairement au reste du payload. */
export interface CreditDashboardCommittee {
  role: 'credit_committee';
  summary: {
    pendingReview: number;
    totalVolumeUsd: number;
    /** Plafond de délégation `gest_zone`, en USD. Au-delà, le comité statue. */
    delegationThresholdUsd: number;
  };
  /** Max 20 lignes, triées par montant décroissant. Le serveur ne renvoie pas
   *  de total : `summary.pendingReview` est le compte complet, la liste est
   *  tronquée à 20 — l'écran doit le dire. */
  pendingApplications: Array<{
    code: string;
    status: string;
    amount_requested: number;
    currency: string;
    value_chain__label: string | null;
    created_at: string;
  }>;
}

export type CreditDashboard =
  | CreditDashboardClient
  | CreditDashboardAgent
  | CreditDashboardCommittee
  | Record<string, unknown>;

/** Actif gageable du registre `assets`.
 *  `value` est declaree par le client ; `valeurRetenue` est fixee par l'agent
 *  apres verification et decote — c'est elle, et elle seule, qui couvre un credit. */
export interface AssetRow {
  id: number;
  name: string;
  /** materiel | foncier | vehicule | stock | autre */
  type: string;
  value: number;
  currency: string;
  description: string;
  localisation: string;
  /** declare | verifie | rejete | gage | libere */
  status: string;
  image: string;
  documents: unknown[];
  valeurRetenue: number | null;
  isPledgeable: boolean;
  /** Type de garantie canonique deduit de la categorie : materiel | foncier | null */
  guaranteeType: string | null;
  motifRejet: string | null;
  verifieLe: string | null;
  createdAt: string;
  /** Presents uniquement pour le staff */
  verifieParSub?: string | null;
  gageApplication?: string | null;
  owner?: { sub: string; displayName: string; phone: string };
}

// ─── Caution solidaire — parcours du garant (lot 6) ─────────────────────────
// Contrat : `docs/status-fragments/lot6-backend.md` §1, publié figé par
// `lot6-backend`. Ajout strict : aucun type existant n'est modifié ici.
//
// Enveloppe hybride assumée côté serveur, et reproduite telle quelle : clés de
// **liste** en snake_case (comme `assets/mine`), clés d'**item** en camelCase
// (comme `serialize_application`). Ce n'est pas une incohérence introduite par
// le lot 6, c'est la convention déjà en place dans les deux fichiers.

/** Groupe ou coopérative **commun** au demandeur et au garant — ce qui justifie
 *  la sollicitation. La caution solidaire n'existe qu'entre membres d'un même
 *  groupe (SPEC §2.5, règle 1). */
export interface GuaranteeRequestGroup {
  id: number;
  name: string;
  /** Nature du groupement : `AVEC`, `COOPERATIVE`… (libellé serveur). */
  type: string;
}

export interface GuaranteeRequestApplicant {
  displayName: string;
  sharedGroups: GuaranteeRequestGroup[];
}

/** Statuts servis par le contrat §1.1. `active` est l'équivalent backend du
 *  `constituted` de la SPEC — la caution constituée par l'agent après consentement. */
export type GuaranteeRequestStatus =
  | 'pending_consent' | 'consented' | 'declined' | 'expired'
  | 'active' | 'released' | 'called';

/** Une demande de caution adressée au garant connecté.
 *
 *  Ce que ce type **ne porte pas**, volontairement (principe 7, anti-gaming) :
 *  la décote de 70 %, la contribution de la caution à la couverture du dossier,
 *  le score du demandeur, les plafonds d'engagement du garant. Le garant voit
 *  son engagement, pas les règles du moteur. */
export interface GuaranteeRequest {
  /** Identifiant à passer dans `POST /guarantee-requests/<id>/consent/`. */
  id: number;
  applicationCode: string;
  status: GuaranteeRequestStatus;
  applicant: GuaranteeRequestApplicant;
  /** `code` canonique du référentiel (`MAIS`, `RIZ`…), `label` prêt à afficher.
   *
   *  **Nullable**, contrairement à l'exemple du contrat §1.1 : le serializer réel
   *  émet `null` quand le dossier n'a pas encore de filière rattachée
   *  (`credits/guarantees.py`, `… if chain else None`). Divergence signalée à
   *  `lot6-backend` ; le type suit le code, pas l'exemple de documentation. */
  valueChain: { code: string; label: string } | null;
  /** Montant du crédit demandé — contexte, ce n'est PAS l'engagement du garant.
   *  Nullable : le serializer sert `amount_approved or amount_requested`, tous
   *  deux facultatifs sur un dossier en cours de constitution. */
  loanAmount: number | null;
  loanCurrency: string;
  /** Montant de l'engagement solidaire du garant. Arrêté par le serveur ; jamais
   *  dérivé de `loanAmount` côté client.
   *
   *  **Impossible à `null` par construction**, confirmé par `lot6-backend` :
   *  `assert_can_guarantee` refuse un montant ≤ 0 (`GUARANTOR_INVALID_AMOUNT`)
   *  *avant* la création de la caution — une demande à 0 ou nulle n'existe pas
   *  en base. Le type reste nullable comme **filet**, pas comme cas métier : si
   *  `null` était observé, c'est un défaut backend à remonter, pas un état à
   *  gérer. L'écran ne met alors ni 0 ni tiret dans la phrase d'engagement — il
   *  dit que le montant manque (en rouge) et le signale en console
   *  (`guaranteeRequestShape.js`, `warnMissing`). */
  coveredAmount: number | null;
  coveredCurrency: string;
  /** ISO 8601 avec offset. Le compte à rebours s'affiche depuis cette date.
   *  Jamais nul sur une caution créée par ce flux (confirmé `lot6-backend`) ;
   *  nullable ici comme filet, au même titre que `coveredAmount`. */
  consentExpiresAt: string | null;
  consentedAt: string | null;
  declinedAt: string | null;
  /** Expiration constatée par le serveur — jamais déduite de l'horloge du client.
   *
   *  **À privilégier sur `status`** pour tout affichage d'état : l'expiration
   *  n'est matérialisée en base qu'à la lecture (pas d'ordonnanceur dans le
   *  projet), donc une demande périmée reste servie en `pending_consent` avec
   *  `isExpired: true`. Côté front, `displayStatusMeta()` et `isActionable()`
   *  font cet arbitrage — aucun écran ne doit lire `status` seul. */
  isExpired: boolean;
  createdAt: string;
}

export interface GuaranteeRequestList {
  total_rows: number;
  /** Fenêtre de consentement **configurée** (`InstitutionConfig`), en heures.
   *  Sert à nommer la durée sans jamais écrire « 72 h » en dur : le comité peut
   *  la changer sans redéploiement (principe 8). */
  consent_window_hours: number;
  items: GuaranteeRequest[];
}

/** Réponse de `POST /guarantee-requests/<id>/consent/` — l'item mis à jour. */
export interface GuaranteeConsentResult {
  detail: string;
  item: GuaranteeRequest;
}

/** Recommandation du moteur — barème 4 niveaux (SPEC Moteur §2).
 *  Le moteur RECOMMANDE, l'humain décide (principe 2) : ce champ ne déclenche
 *  jamais une transition, il éclaire l'analyste. */
export type CreditRecommandation =
  | 'approbation'
  | 'approbation_cond'
  | 'revue'
  | 'refus';

/** Un des 5 critères pondérés. `points = score × poids / 100`. */
export interface CreditAnalyseCritere {
  score: number;
  poids: number;
  points: number;
  details: {
    commentaire?: string;
    totalPlan?: number;
    totalReferentiel?: number;
    ecartMoyenPct?: number;
    referentiel?: string;
    /** Dimension du projet retenue par le moteur, DANS L'UNITÉ DU RÉFÉRENTIEL
     *  (`scorer_technique`). `null` = dimension absente du dossier : le critère
     *  technique vaut alors 0 et le dit, il n'est pas inventé. */
    quantiteReference?: number | null;
    /** Unité de cette dimension (`ha`, `ruche`, `sujet`, `m2`, `sac`, `t`).
     *  C'est celle du référentiel : le moteur REFUSE (422 `DIMENSION_INCOHERENTE`)
     *  plutôt que de convertir des ruches en hectares. */
    uniteReference?: string;
    /** Conservé pour l'historique du contrat, et `null` dès que la filière ne se
     *  mesure pas en hectares — afficher « 30 ha » pour 30 ruches serait pire
     *  que ne rien afficher. Préférer `quantiteReference` + `uniteReference`. */
    superficieHa?: number | null;
    ecartsHorsPlage?: Array<{
      indicateur: string;
      valeur?: number;
      reference?: number;
      ecartPct: number;
      message: string;
    }>;
    dscr?: number;
    dscrStress?: number;
    /** Le §4.6 exige qu'un DSCR soit livré avec son facteur dominant, pas seul.
     *  Remontés à la RACINE des détails par `analyse.py` (`diagnostic.pop`) —
     *  tout le reste du diagnostic vit dans `diagnostic` ci-dessous. */
    facteurDominant?: string;
    levier?: string;
    /** Diagnostic complet du critère DSCR, tel que sérialisé par le moteur.
     *  `alternativesDiffere` était déclaré ici à la racine des détails alors que
     *  le serveur l'imbrique : le contrat décrivait une réponse qui n'existe
     *  pas, et seul le fait que `DscrPanel` soit en `.jsx` a masqué l'écart. */
    diagnostic?: {
      /** Provenance du numérateur du DSCR. `projection_referentiel` = les
       *  cash-flows sont une hypothèse du référentiel, pas une donnée déclarée :
       *  l'écran doit le dire (§4.6, incertitude assumée). */
      hypotheseCashFlows?: {
        origine: 'projection_referentiel' | 'fourni';
        commentaire?: string;
        revenuBrut?: number;
        chargesPlan?: number;
        margeNetteCycle?: number;
        rendementUnitaire?: number;
        uniteRendement?: string;
        superficieHa?: number | null;
      };
      /** Le mois le plus tendu : un DSCR global sain peut cacher un mois à 0,2.
       *  Objet vide quand aucune échéance n'est exigible. */
      moisLePlusTendu?: {
        mois?: number; dscr?: number; echeance?: number; cashFlow?: number;
      };
      serviceDette?: number;
      cashFlowTotal?: number;
      /** Courbe « différé N mois → DSCR X » : le levier chiffré, pas une phrase.
       *  Présente seulement si le dossier porte un différé. */
      alternativesDiffere?: Array<{ differeMois: number; dscr: number; serviceDette: number }>;
      [k: string]: unknown;
    };
    ratioCouverture?: number;
    constituees?: boolean;
    [k: string]: unknown;
  };
}

/** Une ligne de l'échéancier prévisionnel. Montants déjà arrondis au centime
 *  côté serveur — le front n'en recalcule aucun (principe 4). */
export interface CreditEcheancierLigne {
  mois: number;
  phase: 'différé' | 'amortissement' | 'franchise';
  capital: number;
  interets: number;
  interetsCapitalises?: number;
  echeance: number;
  crd: number;
}

/** Tarification figée AVEC l'analyse (`analyse.py::_tarification_api`).
 *
 *  Le taux n'est pas un nombre isolé : c'est un chemin — taux de base de la
 *  filière, bande de score atteinte, ajustement de cette bande, plancher de
 *  sécurité, taux proposé. Servi entier pour qu'un analyste (et un auditeur deux
 *  ans plus tard) puisse refaire le raisonnement sans ouvrir la base.
 *
 *  ⚠ STAFF UNIQUEMENT (principe 7) : la grille apprendrait au demandeur qu'un
 *  point de score de plus lui fait gagner 2 points de taux. Aucun écran client
 *  ne doit lire ce bloc.
 *
 *  Chaque champ hors `tauxPropose` peut manquer : les analyses antérieures à la
 *  grille unique n'ont rien figé, et le serveur ne les re-tarife PAS avec la
 *  grille d'aujourd'hui (principe 3 — on ne réécrit pas ce qu'un analyste a lu). */
export interface CreditTarification {
  /** Taux annuel proposé, en points (20.5 = 20,5 %/an). */
  tauxPropose: number;
  /** Assiette : le taux de base de la FILIÈRE, jamais le taux d'instruction. */
  tauxBase?: number | null;
  /** Borne basse de la bande de score atteinte. `null` = aucune bande
   *  applicable (grille incomplète) — le serveur l'a loggé, l'écran le dit. */
  bandeScoreMin?: number | null;
  /** Ajustement de la bande, en points de taux (signé). */
  ajustement?: number | null;
  /** Plancher de sécurité : la bonification ne descend pas sous ce taux. */
  plancher?: number | null;
  /** `true` = le plancher a mordu, le taux proposé n'est PAS base + ajustement. */
  plancherApplique?: boolean | null;
  /** `bareme` = grille lue en base (recalibrable par le comité, principe 8) ;
   *  `defaut` = grille de secours du code, à faire vivre en base. */
  origineGrille?: 'bareme' | 'defaut' | string | null;
  devise?: string;
}

/** Résultat complet d'une exécution du moteur — vue ANALYSTE.
 *
 *  Immuable : une ré-analyse crée une nouvelle ligne, elle n'en modifie aucune
 *  (principe 3). L'écart entre deux analyses successives est lui-même un signal.
 *
 *  Anti-gaming (principe 7) : ce contrat expose barèmes, tolérances et plages —
 *  il ne doit JAMAIS être servi à un client. La vue client est `analyseResume`. */
export interface CreditAnalyse {
  id: number;
  reference: string;
  referentiel: string;
  /** Paramètres du crédit tel qu'analysé. `modeDiffere` est indispensable pour
   *  relire une analyse passée : sans lui, on ne sait pas si les intérêts du
   *  différé ont été payés ou capitalisés — deux échéanciers très différents. */
  parametres: {
    dureeMois: number;
    differeMois: number;
    tauxAnnuel: number;
    modeDiffere: 'interets_seuls' | 'franchise_totale';
    capital: number;
    devise: string;
  };
  scoreGlobal: number;
  recommandation: CreditRecommandation;
  /** Tarification figée à l'exécution. `null` pour une analyse antérieure à la
   *  grille unique : l'écran affiche « non tarifée », il ne recalcule rien. */
  tarification: CreditTarification | null;
  dscr: number | null;
  dscrStress: number | null;
  criteres: {
    technique: CreditAnalyseCritere;
    dscr: CreditAnalyseCritere;
    stress: CreditAnalyseCritere;
    comportemental: CreditAnalyseCritere;
    garanties: CreditAnalyseCritere;
  };
  indicateursHorsPlage: Array<{ indicateur: string; message: string; ecartPct?: number }>;
  justifications: Array<{
    indicateur: string; justification: string; agent: string; date: string;
  }>;
  echeancier: CreditEcheancierLigne[];

  /** Totaux de l'échéancier, calculés côté serveur.
   *  `crdFinal` DOIT valoir 0 — c'est une propriété invariante (CLAUDE.md §5).
   *  Un écran qui le lisse au lieu de le signaler masque un défaut du moteur. */
  totaux: {
    totalInterets: number;
    totalInteretsCapitalises: number;
    totalCapital: number;
    serviceDette: number;
    crdFinal: number;
    nbEcheances: number;
  };

  /** Devise de l'analyse. Ne PAS emprunter celle du prêt portefeuille : c'est
   *  un autre agrégat, et le repli serait une erreur de lignage. */
  devise: string;

  /** Provenance du référentiel utilisé.
   *  `estIndicatif` distingue une plage estimée d'une plage apprise sur des
   *  dossiers réels — on ne donne pas la même autorité aux deux (principe 10). */
  referentielInfo: {
    code: string;
    filiere: string;
    source: string;
    estIndicatif: boolean;
    nCasReels: number;
    version: number;
  };

  /** Lettre servie par le moteur, dérivée de `BaremeScore` et **figée par
   *  analyse** : un recalibrage ultérieur ne réécrit pas la lettre d'un dossier
   *  déjà instruit. Ne la dérive jamais côté front — c'est la grille en dur du
   *  navigateur qui a produit les divergences 50/55 et `>`/`>=`. */
  scoreLettre: 'A' | 'B' | 'C' | 'D';

  /** Traçabilité : identifie la révision exacte de la feuille de besoins scorée.
   *  Deux analyses successives sont comparables par ces trois champs (principe 3).
   *
   *  `datasetKey` est OPTIONNEL parce que `analyse.py::serialiser` ne l'émet pas
   *  encore — alors que `needs_sheet.py::needs_source_lineage` l'émet, lui, sur
   *  la même notion de lignage. Deux formes de lignage coexistent donc côté
   *  serveur, et le front doit reconstruire `fb__<code>` pour retrouver la
   *  lignée des révisions : la convention de nommage est dupliquée hors du
   *  backend, ce qui viole le principe 6. Correctif attendu côté serveur
   *  (ajouter `datasetKey` au lignage de l'analyse) ; le front le consomme dès
   *  qu'il arrive et cesse alors de deviner (`useNeedsRevisions`). */
  lignage: {
    needsSourceId: number | null;
    revision: number | null;
    sha256: string;
    datasetKey?: string | null;
  };

  /** Poids effectivement appliqués, tels que lus en base au moment du calcul. */
  poidsAppliques: Record<string, number>;

  executeLe: string;
  versionMoteur: string;
}

/** Vue CLIENT — volontairement pauvre.
 *  Le client voit sa lettre et des pistes ; jamais les barèmes, les seuils, les
 *  tolérances par module ni les plages du référentiel (principe 7). */
export interface CreditAnalyseResume {
  reference: string;
  scoreLettre: 'A' | 'B' | 'C' | 'D';
  pointsForts: string[];
  pointsAAmeliorer: string[];
  analyseLe: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comité de crédit — procès-verbal append-only (`credits/committee.py`)
// ─────────────────────────────────────────────────────────────────────────────

/** Un vote nominatif. Append-only : un membre ne vote qu'une fois (409 au second). */
export interface CommitteeVoteEntry {
  /** `sub` IdP du votant — le serveur ne résout pas le nom ici. */
  voter: string;
  decision: 'approve' | 'reject';
  /** Motif obligatoire côté serveur (422 `COMMITTEE_DECISION_INVALID` si vide). */
  comment: string;
  conditions: string | null;
  votedAt: string;
}

/** PV du comité pour un dossier — `GET /credits/applications/<code>/committee-votes/`.
 *  Lecture ouverte à `COMMITTEE_ROLES | CAN_AUDIT` (403 sinon) ; le VOTE, lui,
 *  est réservé à `COMMITTEE_ROLES`. */
export interface CommitteeVotesSummary {
  applicationCode: string;
  /** Nombre de votes concordants requis (`InstitutionConfig`, pas une constante front). */
  quorum: number;
  requiresCommittee: boolean;
  /** Plafond de délégation au-delà duquel le comité est saisi, en USD. */
  thresholdUsd: number;
  votes: CommitteeVoteEntry[];
  tally: { approve: number; reject: number };
  resolved: boolean;
  decision: 'approve' | 'reject' | null;
}

/** Résultat d'un vote — `POST /credits/applications/<code>/committee-vote/` (201).
 *  Refus possibles : 422 `COMMITTEE_DECISION_INVALID`, 409 `COMMITTEE_STATE_INVALID`,
 *  422 `COMMITTEE_NOT_REQUIRED`, 409 `MAKER_CHECKER_VIOLATION`,
 *  409 `COMMITTEE_ALREADY_VOTED`. */
export interface CommitteeVoteResult {
  vote: CommitteeVoteEntry;
  tally: { approve: number; reject: number };
  quorum: number;
  resolved: boolean;
  decision: 'approve' | 'reject' | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Barèmes de score (principe 8 : les règles vivent en base) — `credits/baremes.py`
// ─────────────────────────────────────────────────────────────────────────────

/** Point d'une courbe par morceaux. Stocké en JSONField brut : le serveur
 *  accepte des nombres comme des chaînes numériques — ne pas présumer `number`. */
export interface BaremeCurvePoint {
  x: number | string;
  y: number | string;
}

/** Impact simulé d'un barème sur le golden set, AVANT activation.
 *  Aucun de ces chiffres n'est recalculable côté front (zéro calcul métier client). */
export interface BaremeImpactPreview {
  baremeCode: string;
  type: 'courbe' | 'regles';
  goldenSet: {
    nbDossiers: number;
    nbEvalues: number;
    /** Provenance littérale du golden set, à afficher telle quelle. */
    source: string;
  };
  /** Vide si `type === 'regles'` ou si la courbe proposée est vide. */
  sampleGrid: Array<{
    x: number;
    scoreAvant: number | null;
    scoreApres: number;
    delta: number | null;
  }>;
  /** Un dossier non évaluable ne porte QUE `applicationCode` et `evaluable: false`. */
  impacts: Array<
    | { applicationCode: string; evaluable: false }
    | {
        applicationCode: string;
        evaluable: true;
        scoreGlobalAvant: number;
        scoreGlobalApres: number;
        deltaScore: number;
        recommandationAvant: CreditRecommandation;
        recommandationApres: CreditRecommandation;
        recommandationChange: boolean;
        lettreAvant: 'A' | 'B' | 'C' | 'D';
        lettreApres: 'A' | 'B' | 'C' | 'D';
      }
  >;
  resume: {
    nbScoreChange: number;
    nbRecommandationFlip: number;
    nbLettreFlip: number;
    deltaScoreMoyen: number;
    deltaScoreMax: number;
  };
}

/** Révision de barème (maker-checker : le proposeur ne peut pas activer). */
export interface BaremeRevision {
  id: number;
  baremeCode: string;
  version: number;
  status: 'draft' | 'active' | 'archived' | 'rejected';
  comment: string | null;
  proposedBySub: string;
  proposedAt: string | null;
  decidedBySub: string | null;
  decidedAt: string | null;
  /** Servis uniquement sur les réponses « détaillées » (proposition, activation,
   *  et `pendingRevision` d'un barème) — absents de l'historique `revisions`. */
  points?: BaremeCurvePoint[];
  parametres?: Record<string, unknown>;
  impactPreview?: BaremeImpactPreview;
}

/** Barème de score. Réservé au staff (principe 7 : jamais servi à un client). */
export interface Bareme {
  code: string;
  libelle: string | null;
  /** `'regles'` uniquement pour le barème `DECISION` (seuils), `'courbe'` sinon. */
  type: 'courbe' | 'regles';
  points: BaremeCurvePoint[];
  parametres: Record<string, unknown>;
  actif: boolean;
  version: number;
  updatedAt: string | null;
  pendingRevision: BaremeRevision | null;
  /** Historique, sans `impactPreview` ni `points`. */
  revisions?: BaremeRevision[];
}

export interface BaremeListResult {
  baremes: Bareme[];
  totalRows: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates de fichiers (principe 11) — `dataio/views_templates.py`
// ─────────────────────────────────────────────────────────────────────────────

export interface FileTemplateSchemaSheet {
  name: string;
  position: number;
  columns: string[];
  n_columns: number;
  /** `{ nom_colonne: 'text'|'number'|'percent'|'range'|'date' }`. */
  types: Record<string, string>;
  row_labels: string[];
}

/** Schéma DÉRIVÉ du classeur à l'activation — c'est lui, et rien d'autre, qui
 *  sert de règle de validation aux fichiers client (principe 11). Clés en
 *  snake_case : elles viennent du dérivateur Python, pas d'un serializer. */
export interface FileTemplateSchema {
  sheets: FileTemplateSchemaSheet[];
  sheet_names: string[];
  synthesis_sheet: string | null;
  rubriques: string[];
  derived_at: string;
}

/** Diff du schéma dérivé vs le template actif — servi à l'upload uniquement. */
export interface FileTemplateDiff {
  sheetsAdded: string[];
  sheetsRemoved: string[];
  sheetsColumnsChanged: string[];
  rubriquesAdded: string[];
  rubriquesRemoved: string[];
  hasPrevious: boolean;
}

export interface FileTemplateRow {
  id: number;
  /** `FEUILLE_BESOINS` aujourd'hui ; champ libre côté modèle. */
  kind: string;
  version: number;
  status: 'pending' | 'active' | 'archived';
  originalName: string;
  sha256: string;
  uploadedBy: string | null;
  uploadedAt: string;
  activatedBy: string | null;
  activatedAt: string | null;
  supersedes: number | null;
  sheetNames: string[];
  rubriques: string[];
  /** Présent seulement sur les réponses d'upload et d'activation. */
  schema?: FileTemplateSchema;
}

export interface FileTemplateListResult {
  active: { id: number; version: number; kind: string; activatedAt: string | null } | null;
  /** Tronquée à 100 par le serveur, sans indication de total (dette backend). */
  templates: FileTemplateRow[];
}

/** 201 à l'upload. Refus 422 : `EXTENSION_INVALIDE`, `FICHIER_TROP_VOLUMINEUX`,
 *  `CLASSEUR_ILLISIBLE` (portés par `ApiError.errors`). */
export interface FileTemplateUploadResult extends FileTemplateRow {
  schema: FileTemplateSchema;
  diff: FileTemplateDiff;
  message: string;
}

/** 200 à l'activation (pas de `diff` ici). Refus 409 : `STATUT_INVALIDE`,
 *  `MAKER_EGAL_CHECKER`. */
export interface FileTemplateActivateResult extends FileTemplateRow {
  schema: FileTemplateSchema;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Référentiel filières `reference_data` (maker-checker)
// ─────────────────────────────────────────────────────────────────────────────

/** Filière servie par `/reference-data/value-chains/`.
 *  Les montants et ratios sont sérialisés en **chaînes** (`str(Decimal)`) :
 *  les afficher via le formateur unique, ne jamais les additionner côté front. */
export interface ReferenceValueChain {
  code: string;
  label: string;
  cycleMonths: number;
  costPerHectareUsd: string;
  costPerHectareCdf: string;
  /** Poids par module, somme = 100 côté serveur. */
  moduleWeights: Record<string, number>;
  riskFactor: string;
  minScoreRequired: number;
  baseRate: string;
  harvestMonths: number[];
  eligibleGuarantees: string[];
}

/** Résumé de diff d'un upload de référentiel. `{}` tant que l'upload n'a pas
 *  été validé — d'où les champs optionnels. */
export interface ReferenceDiffSummary {
  added?: string[];
  removed?: string[];
  modified?: Array<{ code: string; label: string; changes: string[] }>;
  unchanged?: number;
  totalNew?: number;
}

export interface ReferenceUploadRow {
  id: number;
  fileType: 'value_chains' | 'suppliers' | 'rates' | string;
  version: string;
  uploadedBy: string;
  uploadedAt: string;
  activatedBy: string | null;
  activatedAt: string | null;
  status: 'pending_validation' | 'active' | 'archived' | 'rejected' | string;
  rowCount: number;
  diff: ReferenceDiffSummary;
}

/** 201 sur upload valide. En cas d'invalidité, le serveur répond 422 avec un
 *  corps DIFFÉRENT dont `errors` est un tableau de **chaînes** — normalisé en
 *  `{code, message}` par `api.referenceData.upload`. */
export interface ReferenceUploadResult {
  valid: true;
  uploadId: number;
  status: string;
  rowCount: number;
  diff: ReferenceDiffSummary;
  message: string;
}

export interface ReferenceUploadActivateResult {
  status: string;
  activatedAt: string;
  activatedBy: string;
  chainsCreated: number;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Référentiel technico-économique v3 — `referentiel/views.py`
// ─────────────────────────────────────────────────────────────────────────────

/** Seul endpoint du lot en snake_case (pas de serializer camelisant). */
export interface ReferentielVersion {
  id: number;
  label: string;
  imported_at: string;
  is_active: boolean;
  n_ranges: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Journal d'audit — `audit/views.py`
// ─────────────────────────────────────────────────────────────────────────────

/** Filtres communs à `/audit/entries` ET `/audit/export` : un export doit
 *  porter EXACTEMENT le périmètre affiché, sans quoi le CSV ment. */
export interface AuditFilters {
  entity_type?: string;
  entity_id?: string;
  /** `sub` IdP de l'acteur. Le serveur accepte aussi `actor` (alias historique). */
  acteur?: string;
  actor?: string;
  /** Seule la valeur `financial` a un effet serveur. */
  category?: 'financial';
  /** Code dossier — matché sur `details.applicationCode` ou `details.reference`. */
  dossier?: string;
  /** Sous-chaîne cherchée dans `action` (insensible à la casse). */
  etape?: string;
  /** Date (`YYYY-MM-DD`) ou datetime ISO. */
  depuis?: string;
  /** Date (`YYYY-MM-DD`, jour inclus) ou datetime ISO. */
  jusqu?: string;
}

export interface AuditEntryRow {
  id: number;
  timestamp: string;
  /** `sub` IdP brut — peut être vide (action système). */
  user: string;
  /** Nom résolu par le serveur ; retombe sur le sub, puis sur « Système ». */
  userName: string;
  role: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  ip: string | null;
}

/** Réponse de `/audit/entries?meta=1`. L'affichage est plafonné à `cap` lignes
 *  alors que `totalRows` compte le périmètre entier : `truncated` doit être dit
 *  à l'utilisateur, et l'export CSV (non plafonné) proposé comme sortie complète. */
export interface AuditEntriesPage {
  entries: AuditEntryRow[];
  totalRows: number;
  returned: number;
  truncated: boolean;
  cap: number;
}
