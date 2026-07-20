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
  rate: number;
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
  currentConfig: { rate: number; duration: number; frequency: string; status: string; statusCode: string; startDate: string };
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
  fundedAmount: number;
  progressPercent: number;
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
  typeOfTitle: string;
  couponRate: number;
  maturityMonths: number;
  minTicket: number;
  bondUnitValue: number;
  minBonds: number;
  maxBonds: number;
  availableBonds: number;
  fundingGoal: number;
  fundedAmount: number;
  status: string;
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
  amount: number;
  bonds: number;
  status: string;
  paymentStatus: string;
  couponRate: number;
  subscriptionDate: string;
  nextPaymentDate: string | null;
  totalReceived: number;
  subPortfolioId: number | null;
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
  bonds: number;
  cash: number;
  stocks: number;
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
}

export interface BondWithdrawal {
  id: number;
  positionId: number;
  amount: number;
  penaltyRate: number;
  reason: string;
  status: string;
  date: string;
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
  loanToValue: number;
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
  deviationPercent: number;
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
  /** Signaux relevés par l'analyse documentaire — la première chose qu'un
   *  analyste regarde sur une feuille de besoins. */
  anomalies?: unknown[];
  totalByModule?: Record<string, number>;
  uploadedAt?: string;
}

export interface CreditScoreBreakdown {
  criterion: string;
  points: number;
  maxPoints: number;
  detail?: string;
}

export interface CreditScoreResult {
  score: number;
  eligible: boolean;
  valuationNote: string;
  proposedRate?: number;
  minScoreRequired?: number;
  breakdown?: CreditScoreBreakdown[];
  scheduleDraft?: Array<{ month: number; payment: number; principal: number; interest: number; balance: number }>;
}

export interface CreditGuaranteeItem {
  id: number;
  type: 'epargne' | 'morale';
  status: 'pending' | 'active' | 'released' | 'expired';
  createdAt: string;
  holdAmount?: number;
  holdCurrency?: string;
  holdReference?: string;
  holdPlacedAt?: string | null;
  availableBalance?: number | null;
  guarantorName?: string;
  guarantorPhone?: string;
  confirmedAt?: string | null;
  expiresAt?: string | null;
  isExpired?: boolean;
  daysLeft?: number | null;
}

export interface CreditGuaranteeSet {
  count: number;
  guaranteeType: 'epargne' | 'morale' | null;
  items: CreditGuaranteeItem[];
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

// Résultat simulate
export interface CreditSimulateResult {
  score: number;
  eligible: boolean;
  valuationNote: string;
  proposedRate: number;
  minScoreRequired: number;
  breakdown: CreditScoreBreakdown[];
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

export type CreditDashboard = CreditDashboardClient | CreditDashboardAgent | Record<string, unknown>;

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
