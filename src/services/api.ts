// Couche service : appels au backend Django (moteur d'analyse crédit).
// Logique : injecte le Bearer, rafraîchit une fois sur 401, calcule le montant
// total d'une ligne côté client, et regroupe les endpoints par domaine.

import { tokens, refresh } from './oidc';
import type {
  AgencyComplianceScore, AnalyseFormPayload, AnalysisResult, AnalystObservation, ApplicationSummary, AssetRow, BesoinInput,
  BondConversion, BondWithdrawal, CashRegisterSessionRow, ClientLoan, Collateral, DataSource,
  EvolutionPlanRow, FinancialAnalysis, InvestmentMovement,
  InvestmentOffer, InvestmentProject, InvestmentSubscription, InvestorProfile, KycMine, LedgerAccount, LoanAlert,
  LoanConfig, LoanRow, LoanTxn, Me, ObligationPosition, PerformanceReport, PortfolioAllocation,
  ProjectQuestion, RbacMe, RbacRole, RbacUser, ReferenceRange, RegularizationOrderRow, ScheduleRow, SourceTablesResponse,
  SummaryCard, TechnicalAnalysis, TicketMessage, TicketRow, VenteInput, WithdrawalRequestRow,
} from '@/types/api';

interface RequestOpts {
  method?: string;
  body?: unknown;
  isForm?: boolean;
  retry?: boolean;
}

/** Erreur métier renvoyée par le backend.
 *
 *  `code` est le contrat stable — `message` est du texte destiné à l'affichage et
 *  peut être reformulé à tout moment. Un écran qui route sur le texte casse
 *  silencieusement au premier reformulage côté serveur, sans erreur de
 *  compilation ni test rouge : router TOUJOURS sur `code`.
 *
 *  `errors` porte les validations multi-erreurs (422 du pipeline feuille de
 *  besoins), où chaque entrée a son propre `{code, message}`. */
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | null = null,
    public errors: Array<{ code: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = 'GET', body, isForm = false, retry = true } = opts;
  const headers: Record<string, string> = {};
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: isForm ? (body as BodyInit) : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && (await refresh())) {
    return request<T>(path, { ...opts, retry: false });
  }
  if (!res.ok) {
    let detail = `Erreur ${res.status}`;
    let code: string | null = null;
    let errors: Array<{ code: string; message: string }> = [];
    try {
      const body = (await res.json()) as {
        detail?: string;
        code?: string;
        errors?: Array<{ code?: string; message?: string }>;
      };
      detail = body.detail || detail;
      code = body.code ?? null;
      // 422 multi-erreurs du pipeline de validation : chaque entrée porte son code.
      if (Array.isArray(body.errors)) {
        errors = body.errors.map((e) => ({
          code: e.code || 'ERREUR',
          message: e.message || '',
        }));
        if (!detail && errors.length) detail = errors[0].message;
      }
    } catch { /* corps non-JSON : on garde le message par défaut */ }
    // Une ligne concise (page/route appelante identifiable via `path`) — pas de stack trace,
    // volontairement : les erreurs métier attendues (ex. 404 "pas encore configuré") ne sont
    // pas des bugs à investiguer, juste un signal utile en dev.
    console.warn(`[API] ${method} ${path} -> ${res.status}${code ? ` [${code}]` : ''} ${detail}`);
    throw new ApiError(res.status, detail, code, errors);
  }
  const ct = res.headers.get('content-type') || '';
  return (ct.includes('application/json') ? await res.json() : (res as unknown)) as T;
}

/** Téléchargement authentifié d'une réponse NON-JSON (export CSV du journal).
 *
 *  `request()` ne convient pas ici : il présuppose du JSON. Et une simple
 *  `<a href>` ne convient pas non plus — l'API s'authentifie par en-tête
 *  `Authorization`, jamais par cookie : le navigateur enverrait une requête
 *  anonyme et l'utilisateur téléchargerait un 401 déguisé en fichier. D'où le
 *  fetch explicite, avec le même retry 401 → `refresh()` que `request`.
 *
 *  Renvoie le blob ET le nom de fichier proposé par le serveur
 *  (`Content-Disposition`), qui porte l'horodatage de l'export. */
async function requestBlob(
  path: string,
  retry = true,
): Promise<{ blob: Blob; filename: string | null; totalRows: number | null }> {
  const headers: Record<string, string> = {};
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;

  const res = await fetch(`/api${path}`, { method: 'GET', headers });

  if (res.status === 401 && retry && (await refresh())) {
    return requestBlob(path, false);
  }
  if (!res.ok) {
    let detail = `Erreur ${res.status}`;
    let code: string | null = null;
    try {
      const body = (await res.json()) as { detail?: string; code?: string };
      detail = body.detail || detail;
      code = body.code ?? null;
    } catch { /* corps non-JSON */ }
    console.warn(`[API] GET ${path} -> ${res.status}${code ? ` [${code}]` : ''} ${detail}`);
    throw new ApiError(res.status, detail, code, []);
  }

  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const total = res.headers.get('x-total-rows');
  return {
    blob: await res.blob(),
    filename: match ? match[1] : null,
    totalRows: total !== null && total !== '' ? Number(total) : null,
  };
}

/** Déclenche l'enregistrement d'un blob sous `filename` côté navigateur. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Sérialise les filtres du journal d'audit — partagé par la consultation et
 *  l'export, pour garantir que le CSV porte le périmètre affiché. */
function auditQuery(filters?: import('@/types/api').AuditFilters, extra?: Record<string, string>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...(filters || {}), ...(extra || {}) })) {
    if (value !== undefined && value !== null && value !== '') q.set(key, String(value));
  }
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

/** Montant total d'une ligne = quantité × coût unitaire × fréquence (logique client). */
export function montantLigne(b: BesoinInput): number {
  const n = (v: unknown) => Number(String(v ?? '').replace(',', '.')) || 0;
  return Math.round(n(b.quantite) * n(b.cout_unitaire) * (n(b.frequence) || 1) * 100) / 100;
}

/** Recette prévisionnelle d'une vente = quantité × (1 − perte) × prix (logique client). */
export function recetteVente(v: VenteInput): number {
  const n = (x: unknown) => Number(String(x ?? '').replace(',', '.')) || 0;
  return Math.round(n(v.quantite) * (1 - n(v.taux_perte)) * n(v.prix_unitaire) * 100) / 100;
}

export const api = {
  // Identité (profil résolu depuis le jeton IdP).
  me: () => request<Me>('/me'),

  // Crédit (client) — analyse par formulaire ou upload d'annexe.
  analyseForm: (payload: AnalyseFormPayload) =>
    request<AnalysisResult>('/credits/applications', { method: 'POST', body: payload }),
  analyseUpload: (form: FormData) =>
    request<AnalysisResult>('/credits/applications', { method: 'POST', body: form, isForm: true }),
  listApplications: () => request<ApplicationSummary[]>('/credits/applications'),
  application: (code: string) => request<AnalysisResult>(`/credits/applications/${code}`),
  reportUrl: (code: string, format: 'excel' | 'word') =>
    `/api/credits/applications/${code}/rapport?format=${format}`,
  justify: (code: string, form: FormData) =>
    request(`/credits/applications/${code}/justifications`, { method: 'POST', body: form, isForm: true }),

  // ── Module Crédits Agricoles complet (Étapes 1-7) ────────────────────────
  credits: {
    // Tableau de bord (rôle-aware)
    /** `view=committee` sert la corbeille du comite (reserve a la direction). */
    dashboard: (view?: 'committee') =>
      request<import('@/types/api').CreditDashboard>(
        `/credits/dashboard/${view ? `?view=${view}` : ''}`,
      ),

    // Préremplissage
    prefill: (clientSub?: string) =>
      request<import('@/types/api').CreditPrefillResult>(
        `/credits/application/prefill/${clientSub ? `?client_sub=${encodeURIComponent(clientSub)}` : ''}`),

    // Feuille de besoins
    parseNeedsSheet: (form: FormData) =>
      request<import('@/types/api').NeedsParseResult>(
        '/credits/needs-sheet/parse/', { method: 'POST', body: form, isForm: true }),
    templateUrl: (vcCode?: string) =>
      `/api/credits/needs-sheet-template/${vcCode ? `?value_chain_code=${encodeURIComponent(vcCode)}` : ''}`,

    // Simulation sans sauvegarde
    simulate: (data: {
      /** Depuis le lot 2 : le backend lit les DataRecord de la feuille ingeree
       *  et IGNORE les montants du payload. C'est le principe 1 — ce qui est
       *  score est ce qui est en base. */
      application_code?: string;
      client_sub?: string;
      value_chain_code?: string;
      needs_sheet_id?: number;
      area_ha?: number;
      amount_requested?: number;
      currency?: string;
      /** Financement par module (contrat §1) : `{ moduleCode: pct }`, pct entier
       *  0..100. La part demandée = `cout_fichier × pct/100` ; le montant scoré
       *  devient `Σ parts demandées` (et non le total feuille). Les COÛTS restent
       *  lus des DataRecord — seul le % de demande vient d'ici (principe 1). */
      module_financing?: Record<string, number>;
    }) => request<import('@/types/api').CreditSimulateResult>('/credits/simulate/', { method: 'POST', body: data }),

    // CRUD dossiers
    list: (params?: { status?: string; value_chain_code?: string }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.value_chain_code) q.set('value_chain_code', params.value_chain_code);
      const qs = q.toString();
      return request<import('@/types/api').CreditApplication[]>(`/credits/applications/${qs ? `?${qs}` : ''}`);
    },
    create: (data: {
      client_sub?: string;
      value_chain_code?: string;
      area_ha?: number;
      currency?: string;
      amount_requested: number;
      needs_sheet_id?: number;
      guarantee_type?: string;
      prefill_snapshot?: Record<string, unknown>;
    }) => request<import('@/types/api').CreditApplication>('/credits/applications/', { method: 'POST', body: data }),
    get: (code: string) =>
      request<import('@/types/api').CreditApplication>(`/credits/applications/${code}/`),

    // Scoring
    score: (code: string) =>
      request<import('@/types/api').CreditScoreResult>(`/credits/applications/${code}/score/`, { method: 'POST', body: {} }),

    // ── Moteur d'analyse (SPEC Moteur) ──────────────────────────────────
    // Routes alignées sur la convention du module (`applications/<code>/`) et
    // NON sur celles de la SPEC (`admin/demandes/<ref>/`), qui décrivent des
    // modèles inexistants ici (DemandeCredit, PlanFinancierUpload).

    /** Analyse complète — réservée au staff : elle expose barèmes et plages. */
    analyse: (code: string) =>
      request<import('@/types/api').CreditAnalyse>(`/credits/applications/${code}/analyse/`),

    /** Canal de justification d'un indicateur hors plage. Journalisé. */
    justifyIndicator: (code: string, data: { indicateur: string; justification: string }) =>
      request<import('@/types/api').CreditAnalyse>(
        `/credits/applications/${code}/analyse/justifier/`, { method: 'POST', body: data }),

    /** Ré-exécute le moteur : crée une NOUVELLE analyse, ne modifie pas l'ancienne
     *  (principe 3). Sert le simulateur analyste de RateMaturityModal. */
    reanalyser: (code: string, data?: {
      duree_mois?: number; differe_mois?: number; taux_annuel?: number;
      mode_differe?: 'interets_seuls' | 'franchise_totale';
    }) => request<import('@/types/api').CreditAnalyse>(
      `/credits/applications/${code}/reanalyser/`, { method: 'POST', body: data ?? {} }),

    /** Vue CLIENT — sans barèmes ni seuils (principe 7). */
    analyseResume: (code: string) =>
      request<import('@/types/api').CreditAnalyseResume>(
        `/credits/applications/${code}/analyse-resume/`),

    // Workflow
    submit: (code: string) =>
      request<import('@/types/api').CreditApplication>(`/credits/applications/${code}/submit/`, { method: 'POST', body: {} }),
    startAnalysis: (code: string) =>
      request<import('@/types/api').CreditApplication>(`/credits/applications/${code}/start-analysis/`, { method: 'POST', body: {} }),
    approve: (code: string, data: { amount_approved: number; comment?: string }) =>
      request<import('@/types/api').CreditApplication>(`/credits/applications/${code}/approve/`, { method: 'POST', body: data }),
    reject: (code: string, data: { reason_code?: string; comment?: string }) =>
      request<import('@/types/api').CreditApplication>(`/credits/applications/${code}/reject/`, { method: 'POST', body: data }),
    adjourn: (code: string, data: { comment: string }) =>
      request<import('@/types/api').CreditApplication>(`/credits/applications/${code}/adjourn/`, { method: 'POST', body: data }),
    reopenAnalysis: (code: string) =>
      request<import('@/types/api').CreditApplication>(`/credits/applications/${code}/reopen-analysis/`, { method: 'POST', body: {} }),
    consent: (code: string, data: { method?: string }) =>
      request<import('@/types/api').CreditApplication>(`/credits/applications/${code}/client-consent/`, { method: 'POST', body: data }),

    // Décaissement
    disbursement: (code: string) =>
      request<import('@/types/api').CreditDisbursement | null>(`/credits/applications/${code}/disbursement/`),
    requestDisbursement: (code: string, data?: { notes?: string }) =>
      request<import('@/types/api').CreditApplication>(`/credits/applications/${code}/disbursement/request/`, { method: 'POST', body: data || {} }),
    confirmDisbursement: (code: string) =>
      request<Record<string, unknown>>(`/credits/applications/${code}/disbursement/confirm/`, { method: 'POST', body: {} }),
    cancelDisbursement: (code: string) =>
      request<import('@/types/api').CreditApplication>(`/credits/applications/${code}/disbursement/cancel/`, { method: 'POST', body: {} }),

    // Garanties
    guarantees: (code: string) =>
      request<import('@/types/api').CreditGuaranteeSet>(`/credits/applications/${code}/guarantees/`),
    placeSavingsGuarantee: (code: string, data: { savings_plan_id: number; amount: number; notes?: string }) =>
      request<import('@/types/api').CreditGuaranteeSet>(`/credits/applications/${code}/guarantees/savings/`, { method: 'POST', body: data }),
    registerMoralGuarantee: (code: string, data: {
      guarantor_name: string; guarantor_phone: string;
      guarantor_id_number: string; guarantor_sub?: string; notes?: string;
    }) => request<import('@/types/api').CreditGuaranteeSet>(`/credits/applications/${code}/guarantees/moral/`, { method: 'POST', body: data }),
    confirmGuarantee: (code: string, guaranteeId: number) =>
      request<import('@/types/api').CreditGuaranteeSet>(`/credits/applications/${code}/guarantees/${guaranteeId}/confirm/`, { method: 'POST', body: {} }),
    /** Gage sur un actif verifie du client. 422 + code si une des 5 regles echoue. */
    placeAssetGuarantee: (code: string, assetId: number) =>
      request<import('@/types/api').CreditGuaranteeSet>(`/credits/applications/${code}/guarantees/asset/`, { method: 'POST', body: { asset_id: assetId } }),
    releaseGuarantee: (code: string, guaranteeId: number) =>
      request<import('@/types/api').CreditGuaranteeSet>(`/credits/applications/${code}/guarantees/${guaranteeId}/release/`, { method: 'POST', body: {} }),

    // ── Caution solidaire, côté garant (lot 6) ────────────────────────────
    // Contrat : `docs/status-fragments/lot6-backend.md` §1.
    //
    // Ces deux appels ne sont PAS sous `/applications/<code>/` : le garant est un
    // tiers, il n'a pas accès au dossier du demandeur. Il ne voit que les lignes
    // dont il est le garant désigné — le serveur filtre sur `guarantor ==
    // request.user`, y compris pour un admin.

    /** Demandes de caution adressées au garant connecté.
     *  Sans `status`, **toutes** sont servies, expirées comprises : l'écran doit
     *  pouvoir afficher « expirée » sans l'inférer d'une date passée. */
    guaranteeRequests: (params?: { status?: string }) => {
      const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : '';
      return request<import('@/types/api').GuaranteeRequestList>(`/credits/guarantee-requests/${qs}`);
    },

    /** Consentement du garant — acte juridique, journalisé et irréversible.
     *
     *  `accept: false` est un refus explicite, pas une absence de réponse : il
     *  ferme la demande (`declined`) au lieu de la laisser expirer. Les deux
     *  valeurs passent par le même appel, d'où le booléen obligatoire.
     *
     *  Refus possibles (§1.2) : `ACCEPT_REQUIRED` 400, `GUARANTOR_NOT_DESIGNATED`
     *  403, 404 sans code, `GUARANTOR_ALREADY_ANSWERED` / `INVALID_GUARANTEE_STATE`
     *  409, `GUARANTOR_CONSENT_EXPIRED` 410, et les cinq règles de capacité en 422
     *  — intégralement re-vérifiées à ce moment, pas seulement à la désignation. */
    consentGuaranteeRequest: (requestId: number, accept: boolean) =>
      request<import('@/types/api').GuaranteeConsentResult>(
        `/credits/guarantee-requests/${requestId}/consent/`,
        { method: 'POST', body: { accept } },
      ),

    // ── Comité de crédit (CLAUDE.md §7.1.4) ───────────────────────────────
    // Le comité statue sur les dossiers au-dessus du plafond de délégation. Le
    // PV est append-only : un vote enregistré ne se corrige pas (principe 3).

    /** PV du comité pour un dossier : quorum requis, votes nominatifs déjà
     *  exprimés, décompte et résolution. Lecture ouverte au comité ET à l'audit
     *  (403 pour les autres) — un auditeur doit pouvoir reconstituer la décision.
     *
     *  `quorum` et `thresholdUsd` viennent d'`InstitutionConfig` : ne jamais les
     *  coder en dur côté front (principe 8). */
    committeeVotes: (code: string) =>
      request<import('@/types/api').CommitteeVotesSummary>(
        `/credits/applications/${code}/committee-votes/`),

    /** Vote d'un membre du comité — réservé à `COMMITTEE_ROLES` (403 sinon).
     *
     *  `comment` est le motif obligatoire (principe : chaque décision exige son
     *  motif) ; le serveur refuse un commentaire vide en 422
     *  `COMMITTEE_DECISION_INVALID`. Autres refus : 409 `COMMITTEE_STATE_INVALID`
     *  (dossier hors `in_analysis`), 422 `COMMITTEE_NOT_REQUIRED` (montant sous
     *  le plafond — le comité n'a pas à être saisi), 409
     *  `MAKER_CHECKER_VIOLATION` (l'instructeur du dossier ne vote pas), 409
     *  `COMMITTEE_ALREADY_VOTED` (un vote par membre, définitif).
     *
     *  Quand le quorum est atteint, le serveur résout le dossier dans la foulée
     *  (approbation ou rejet) : la réponse porte alors `resolved: true`. */
    committeeVote: (code: string, data: {
      decision: 'approve' | 'reject';
      comment: string;
      conditions?: string;
    }) => request<import('@/types/api').CommitteeVoteResult>(
      `/credits/applications/${code}/committee-vote/`, { method: 'POST', body: data }),

    // ── Barèmes de score (principe 8 + CLAUDE.md §7.1.5) ───────────────────
    // Les courbes de score vivent en base et sont modifiables par le comité
    // sans redéploiement, sous maker-checker et avec prévisualisation de
    // l'impact sur le golden set AVANT activation.
    baremes: {
      /** Liste des barèmes avec leur historique de révisions.
       *  Réservé au staff (403 sinon) — un barème exposé à un client rendrait
       *  le score jouable (principe 7). */
      list: () => request<import('@/types/api').BaremeListResult>('/credits/baremes/'),

      /** Détail d'un barème (courbe active, révision en attente, historique).
       *  404 `BAREME_INTROUVABLE`. */
      get: (code: string) =>
        request<import('@/types/api').Bareme>(`/credits/baremes/${encodeURIComponent(code)}/`),

      /** Propose une nouvelle révision (statut `draft`) — le barème actif n'est
       *  PAS modifié : il faudra un second acteur pour activer (maker ≠ checker).
       *  Réservé au comité (403 sinon).
       *
       *  Champs omis = valeurs actives conservées. Refus : 422
       *  `BAREME_CONTENU_INVALIDE` (moins de 2 points, y hors [0,100], x
       *  dupliqués…), 409 `BAREME_REVISION_ETAT` (une révision draft existe déjà).
       *
       *  La réponse porte `impactPreview` : l'impact chiffré sur le golden set. */
      propose: (code: string, data: {
        points?: Array<import('@/types/api').BaremeCurvePoint>;
        parametres?: Record<string, unknown>;
        comment?: string;
      }) => request<import('@/types/api').BaremeRevision>(
        `/credits/baremes/${encodeURIComponent(code)}/`, { method: 'POST', body: data }),

      /** Prévisualise l'impact d'une courbe SANS rien persister — c'est l'outil
       *  qui rend la modification d'un barème décidable plutôt que devinée.
       *  Réservé au comité (403 sinon). */
      preview: (code: string, data: {
        points?: Array<import('@/types/api').BaremeCurvePoint>;
        parametres?: Record<string, unknown>;
      }) => request<import('@/types/api').BaremeImpactPreview>(
        `/credits/baremes/${encodeURIComponent(code)}/preview/`, { method: 'POST', body: data }),

      /** Active une révision `draft` (le barème précédent passe en `archived`).
       *  Refus : 404 `BAREME_REVISION_INTROUVABLE`, 409 `BAREME_REVISION_ETAT`
       *  (révision déjà décidée), 409 `MAKER_CHECKER_VIOLATION` (le proposeur ne
       *  peut pas activer sa propre révision). */
      activateRevision: (revisionId: number) =>
        request<import('@/types/api').BaremeRevision>(
          `/credits/baremes/revisions/${revisionId}/activate/`, { method: 'POST', body: {} }),
    },
  },

  // Référentiel (transparence).
  ranges: (chain?: string) =>
    request<{ version: string | null; ranges: ReferenceRange[] }>(
      `/referentiel/ranges${chain ? `?chain=${chain}` : ''}`),
  chains: () => request<Array<{ code: string; libelle: string; specialite: string }>>('/referentiel/chains'),
  config: () => request<Record<string, unknown>>('/referentiel/config'),
  /** Historique des versions du référentiel — sans écran jusqu'ici, alors que
   *  c'est ce qui permet de savoir SOUS QUELLE version un dossier a été scoré. */
  referentielVersions: () => request<unknown>('/referentiel/versions'),

  // Données (admin) — ingestion hybride : upload → aperçu → commit (manuel) → historique.
  dataSources: () => request<DataSource[]>('/dataio/sources'),
  uploadSource: (form: FormData) => request<DataSource>('/dataio/sources', { method: 'POST', body: form, isForm: true }),
  commitSource: (id: number) => request<{ detail: string; commit: unknown }>(`/dataio/sources/${id}/commit`, { method: 'POST', body: {} }),
  sourceTables: (id: number) => request<SourceTablesResponse>(`/dataio/sources/${id}/tables`),
  // Édition admin : corrections + suppressions de lignes (re-synchronise le typé).
  updateTableRecords: (
    tableId: number,
    records: Array<{ id: number; values: Record<string, string | null> }>,
    del: number[] = [],
  ) =>
    request<{ detail: string; changed: number; deleted: number; typed: unknown }>(
      `/dataio/tables/${tableId}/records`, { method: 'POST', body: { records, delete: del } }),
  // Renommer le titre d'une table.
  renameTable: (tableId: number, name: string) =>
    request<{ detail: string; id: number; name: string; old_name: string }>(
      `/dataio/tables/${tableId}`, { method: 'PATCH', body: { name } }),
  // Suppression d'une source entière (et de ses données).
  deleteSource: (id: number) =>
    request<{ detail: string; deleted: boolean }>(`/dataio/sources/${id}`, { method: 'DELETE' }),
  history: (key?: string) => request<DataSource[]>(`/dataio/history${key ? `?key=${encodeURIComponent(key)}` : ''}`),

  /**
   * Templates de fichiers versionnés — le PRINCIPE 11 vit ici.
   *
   * Le schéma de validation des fichiers client est DÉRIVÉ du template actif à
   * son activation, jamais codé en dur. Le cycle est maker-checker : `upload`
   * dépose en `pending` (maker), `activate` bascule en `active` et archive le
   * précédent (checker ≠ maker — le serveur refuse sinon).
   *
   * `detail` n'est pas un confort : il sert le schéma dérivé COMPLET et le diff
   * calculé côté serveur. Sans lui, seul le maker voyait ces informations (elles
   * ne transitaient que dans la réponse d'`upload`) — le checker, qui par
   * construction n'a pas fait le dépôt, activait à l'aveugle. Un contrôle
   * maker-checker sans l'information qui le fonde n'est pas un contrôle.
   *
   * Retours typés `unknown` : le panneau appelant caste vers ses propres types.
   * Mieux vaut ça qu'une forme inventée ici — un type qui ment fait taire `tsc`
   * au lieu de l'alerter.
   */
  templates: {
    list: () => request<unknown>('/dataio/templates/'),
    detail: (id: number) => request<unknown>(`/dataio/templates/${id}`),
    upload: (form: FormData) =>
      request<unknown>('/dataio/templates/upload', { method: 'POST', body: form, isForm: true }),
    activate: (id: number) =>
      request<unknown>(`/dataio/templates/${id}/activate`, { method: 'POST', body: {} }),
  },

  // Portefeuille de crédits (Module Crédits Agricoles — admin).
  portfolio: {
    loans: (params?: { status?: string; search?: string }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.search) q.set('search', params.search);
      const qs = q.toString();
      return request<LoanRow[]>(`/portfolio/loans${qs ? `?${qs}` : ''}`);
    },
    createLoan: (data: Record<string, unknown>) =>
      request<LoanRow & { detail: string }>('/portfolio/loans', { method: 'POST', body: data }),
    // Rattache un dossier de gestion à une demande analysée par le moteur.
    fromApplication: (code: string) =>
      request<LoanRow & { detail: string }>(`/portfolio/loans/from-application/${code}`, { method: 'POST', body: {} }),
    loan: (ref: string) => request<LoanRow & { notes: unknown[]; config: LoanConfig }>(`/portfolio/loans/${ref}`),
    updateLoan: (ref: string, data: Record<string, unknown>) =>
      request<LoanRow>(`/portfolio/loans/${ref}`, { method: 'PATCH', body: data }),
    deleteLoan: (ref: string) => request<{ detail: string }>(`/portfolio/loans/${ref}`, { method: 'DELETE' }),
    config: (ref: string) => request<LoanConfig>(`/portfolio/loans/${ref}/config`),
    saveConfig: (ref: string, data: Record<string, unknown>) =>
      request<LoanConfig>(`/portfolio/loans/${ref}/config`, { method: 'POST', body: data }),
    transactions: (ref: string) =>
      request<{ currency: string; transactions: LoanTxn[] }>(`/portfolio/loans/${ref}/transactions`),
    addTransaction: (ref: string, data: Record<string, unknown>) =>
      request<{ currency: string; transactions: LoanTxn[] }>(`/portfolio/loans/${ref}/transactions`, { method: 'POST', body: data }),
    notes: (ref: string) => request<unknown[]>(`/portfolio/loans/${ref}/notes`),
    addNote: (ref: string, text: string) =>
      request<unknown[]>(`/portfolio/loans/${ref}/notes`, { method: 'POST', body: { text } }),
    action: (ref: string, action: string, data: Record<string, unknown> = {}) =>
      request<{ ok: boolean; detail: string; credit: LoanRow }>(`/portfolio/loans/${ref}/action`, { method: 'POST', body: { action, ...data } }),
    loanSchedule: (ref: string) =>
      request<{ schedule: ScheduleRow[]; totals: { total_principal: number; total_interest: number; total_payments: number; apr: number }; currency: string }>(
        `/portfolio/loans/${ref}/schedule`),
    summary: () => request<SummaryCard[]>('/portfolio/summary'),
    alerts: () => request<LoanAlert[]>('/portfolio/alerts'),
    // Espace client (Credits.jsx) : auto-service — demande, sous-portefeuilles par
    // module, paiements, réajustement — scopé au dossier du client courant.
    mine: {
      list: () => request<ClientLoan[]>('/portfolio/mine'),
      submit: (data: Record<string, unknown>) =>
        request<ClientLoan>('/portfolio/mine', { method: 'POST', body: data }),
      detail: (ref: string) => request<ClientLoan>(`/portfolio/mine/${ref}`),
      pay: (ref: string, subwalletId: number, amount: number, beneficiary: string, description = '') =>
        request<ClientLoan>(`/portfolio/mine/${ref}/pay`, {
          method: 'POST', body: { subwalletId, amount, beneficiary, description },
        }),
      rebalance: (ref: string, fromId: number, toId: number, amount: number) =>
        request<ClientLoan>(`/portfolio/mine/${ref}/rebalance`, {
          method: 'POST', body: { fromId, toId, amount },
        }),
    },
  },

  // Investissements (Module Investissements — admin + espace investisseur). Schéma
  // canonique côté backend : remplace agricapDataService.js/investmentData.js/
  // investorSpaceData.js (3 modèles mock incompatibles) par une seule API réelle.
  investments: {
    projects: {
      list: (status?: string) =>
        request<InvestmentProject[]>(`/investments/projects${status ? `?status=${status}` : ''}`),
      detail: (code: string) => request<InvestmentProject>(`/investments/projects/${code}`),
      create: (data: Record<string, unknown>) =>
        request<InvestmentProject>('/investments/projects', { method: 'POST', body: data }),
      update: (code: string, data: Record<string, unknown>) =>
        request<InvestmentProject>(`/investments/projects/${code}`, { method: 'PATCH', body: data }),
      transition: (code: string, toStatus: string) =>
        request<InvestmentProject>(`/investments/projects/${code}/action`, { method: 'POST', body: { toStatus } }),
      technicalAnalysis: (code: string) => request<TechnicalAnalysis>(`/investments/projects/${code}/technical-analysis`),
      financialAnalysis: (code: string) => request<FinancialAnalysis>(`/investments/projects/${code}/financial-analysis`),
    },
    offers: {
      list: (projectCode?: string) =>
        request<InvestmentOffer[]>(`/investments/offers${projectCode ? `?project=${projectCode}` : ''}`),
      open: () => request<InvestmentOffer[]>('/investments/offers/open'),
      create: (data: Record<string, unknown>) =>
        request<InvestmentOffer>('/investments/offers', { method: 'POST', body: data }),
      collateral: (offerId: number) => request<Collateral>(`/investments/offers/${offerId}/collateral`),
    },
    investors: {
      list: () => request<InvestorProfile[]>('/investments/investors'),
      create: (data: Record<string, unknown>) =>
        request<InvestorProfile>('/investments/investors', { method: 'POST', body: data }),
      me: () => request<InvestorProfile>('/investments/investors/me'),
      action: (id: number, action: string) =>
        request<InvestorProfile>(`/investments/investors/${id}/action`, { method: 'POST', body: { action } }),
    },
    subscriptions: {
      list: (investorId?: number) =>
        request<InvestmentSubscription[]>(`/investments/subscriptions${investorId ? `?investor=${investorId}` : ''}`),
      mine: () => request<InvestmentSubscription[]>('/investments/subscriptions/mine'),
      subscribe: (offerId: number, bonds: number) =>
        request<InvestmentSubscription>('/investments/subscriptions', {
          method: 'POST', body: { offerId, bonds, idempotencyKey: crypto.randomUUID() },
        }),
    },
    movements: (filters?: { investor?: number; zone?: string }) => {
      const q = new URLSearchParams();
      if (filters?.investor) q.set('investor', String(filters.investor));
      if (filters?.zone) q.set('zone', filters.zone);
      const qs = q.toString();
      return request<InvestmentMovement[]>(`/investments/movements${qs ? `?${qs}` : ''}`);
    },
    schedules: (offerId?: number) =>
      request<unknown[]>(`/investments/schedules${offerId ? `?offer=${offerId}` : ''}`),
    subPortfolios: {
      list: () => request<Array<{ id: number; name: string; description: string }>>('/investments/sub-portfolios'),
      create: (name: string, description = '') =>
        request<{ id: number; name: string; description: string }>('/investments/sub-portfolios', {
          method: 'POST', body: { name, description },
        }),
    },
    observations: (projectCode: string) =>
      request<AnalystObservation[]>(`/investments/observations?project=${projectCode}`),
    questions: {
      list: (opts?: { all?: boolean; projectCode?: string }) => {
        const q = new URLSearchParams();
        if (opts?.all) q.set('all', '1');
        if (opts?.projectCode) q.set('project', opts.projectCode);
        const qs = q.toString();
        return request<ProjectQuestion[]>(`/investments/questions${qs ? `?${qs}` : ''}`);
      },
      create: (projectCode: string, question: string) =>
        request<{ id: number }>('/investments/questions', { method: 'POST', body: { projectCode, question } }),
      answer: (id: number, answer: string) =>
        request<{ id: number; status: string }>(`/investments/questions/${id}/answer`, {
          method: 'POST', body: { answer },
        }),
    },
    performanceReports: {
      list: (projectCode?: string) =>
        request<PerformanceReport[]>(`/investments/performance-reports${projectCode ? `?project=${projectCode}` : ''}`),
      create: (projectCode: string, data: Record<string, unknown>) =>
        request<{ id: number; deviationPercent: number }>('/investments/performance-reports', {
          method: 'POST', body: { projectCode, ...data },
        }),
    },
    obligations: {
      list: () => request<ObligationPosition[]>('/investments/obligations'),
      subscribe: (data: Record<string, unknown>) =>
        request<{ id: number }>('/investments/obligations', { method: 'POST', body: data }),
      withdraw: (positionId: number, data: Record<string, unknown>) =>
        request<{ id: number; status: string }>(`/investments/obligations/${positionId}/withdraw`, {
          method: 'POST', body: data,
        }),
      convert: (positionId: number, coupons: number) =>
        request<{ id: number; shares: number }>(`/investments/obligations/${positionId}/convert`, {
          method: 'POST', body: { coupons },
        }),
      withdrawals: (positionId: number) =>
        request<BondWithdrawal[]>(`/investments/obligations/${positionId}/withdrawals`),
      conversions: (positionId: number) =>
        request<BondConversion[]>(`/investments/obligations/${positionId}/conversions`),
    },
    secondaryMarket: {
      list: () => request<unknown[]>('/investments/secondary-market'),
      create: (subscriptionId: number, askPrice: number) =>
        request<{ id: number }>('/investments/secondary-market', {
          method: 'POST', body: { subscriptionId, askPrice },
        }),
    },
    dashboardMetrics: () =>
      request<{ totalProjects: number; totalInvested: number; activeInvestors: number; kycPending: number }>(
        '/investments/dashboard-metrics'),
    portfolioAllocation: () => request<PortfolioAllocation>('/investments/portfolio-allocation'),
  },

  // Agences (Agencies.jsx) — cycle de vie création/suspension/déblocage/fermeture.
  agencies: {
    list: () => request<unknown[]>('/agencies/'),
    create: (data: Record<string, unknown>) => request<unknown>('/agencies/', { method: 'POST', body: data }),
    detail: (code: string) => request<unknown>(`/agencies/${code}`),
    update: (code: string, data: Record<string, unknown>) =>
      request<unknown>(`/agencies/${code}`, { method: 'PATCH', body: data }),
    action: (code: string, action: string, reason = '', extra: Record<string, unknown> = {}) =>
      request<unknown>(`/agencies/${code}/action`, { method: 'POST', body: { action, reason, ...extra } }),
    // Réactivation (déverrouillage après suspension, réouverture après fermeture) : exige
    // un document justificatif, donc multipart plutôt que JSON.
    actionWithDocument: (code: string, action: string, reason: string, document: File) => {
      const form = new FormData();
      form.append('action', action);
      form.append('reason', reason);
      form.append('document', document);
      return request<unknown>(`/agencies/${code}/action`, { method: 'POST', body: form, isForm: true });
    },
    reconciliation: (code: string) => request<unknown>(`/agencies/${code}/reconciliation`),
    statusHistory: (code: string) => request<unknown[]>(`/agencies/${code}/status-history`),
    auditTrail: (code: string) => request<unknown[]>(`/agencies/${code}/audit`),
    // Rapprochements structurés (ouvert -> assigné -> terminé) — distinct de `reconciliation`
    // ci-dessus (rapport de balance en lecture seule).
    reconciliations: {
      list: (filters?: { agency?: string; status?: string }) => {
        const q = new URLSearchParams();
        if (filters?.agency) q.set('agency', filters.agency);
        if (filters?.status) q.set('status', filters.status);
        const qs = q.toString();
        return request<Array<{
          id: number; agencyCode: string; periodStart: string; periodEnd: string; status: string;
          deltaAmount: number | null; currency: string; assignedTo: string; notes: string;
          isFinalClosure: boolean; openedAt: string; closedAt: string | null;
        }>>(`/agencies/reconciliations${qs ? `?${qs}` : ''}`);
      },
      open: (agencyCode: string, periodStart: string, periodEnd: string) =>
        request<unknown>('/agencies/reconciliations', {
          method: 'POST', body: { agencyCode, periodStart, periodEnd },
        }),
      assign: (id: number, assigneeSub: string) =>
        request<unknown>(`/agencies/reconciliations/${id}/assign`, { method: 'POST', body: { assigneeSub } }),
      complete: (id: number, deltaAmount: string, currency: string, notes = '') =>
        request<unknown>(`/agencies/reconciliations/${id}/complete`, {
          method: 'POST', body: { deltaAmount, currency, notes },
        }),
    },
    complianceScore: (code: string) => request<AgencyComplianceScore>(`/agencies/${code}/compliance-score`),
    // Plan d'évolution de catégorie réseau — checklist de prérequis à cocher avant que le
    // type réel de l'agence ne change (remplace le changement instantané `action('evolve_type')`
    // pour tout nouveau câblage, conservé tel quel pour compatibilité ascendante).
    evolutionPlans: {
      list: (code: string) => request<EvolutionPlanRow[]>(`/agencies/${code}/evolution-plans`),
      start: (code: string, toType: string, reason = '') =>
        request<EvolutionPlanRow>(`/agencies/${code}/evolution-plans`, {
          method: 'POST', body: { toType, reason },
        }),
      checkItem: (planId: number, itemId: number) =>
        request<EvolutionPlanRow['items'][number]>(
          `/agencies/evolution-plans/${planId}/items/${itemId}/check`, { method: 'POST', body: {} }),
      complete: (planId: number) =>
        request<EvolutionPlanRow>(`/agencies/evolution-plans/${planId}/complete`, { method: 'POST', body: {} }),
      cancel: (planId: number, reason = '') =>
        request<EvolutionPlanRow>(`/agencies/evolution-plans/${planId}/cancel`, {
          method: 'POST', body: { reason },
        }),
    },
    // Maker-checker pour les actions sensibles (suspend/close/unlock_temporary/reopen).
    // Le maker crée une demande, le checker reçoit un code OTP par SMS et approuve/rejette.
    actionRequests: {
      list: (filters?: { agency?: string; status?: string }) => {
        const q = new URLSearchParams();
        if (filters?.agency) q.set('agency', filters.agency);
        if (filters?.status) q.set('status', filters.status);
        const qs = q.toString();
        return request<Array<{
          id: number; agencyCode: string; actionType: string; reason: string;
          hasDocument: boolean; requestedBy: string; status: string;
          approvedBy: string | null; decidedAt: string | null;
          rejectionNote: string | null; createdAt: string;
        }>>(`/agencies/action-requests${qs ? `?${qs}` : ''}`);
      },
      create: (agencyCode: string, actionType: string, reason: string, document?: File) => {
        const form = new FormData();
        form.append('agencyCode', agencyCode);
        form.append('actionType', actionType);
        form.append('reason', reason);
        if (document) form.append('document', document);
        return request<{ id: number; agencyCode: string; status: string }>(
          '/agencies/action-requests', { method: 'POST', body: form, isForm: true });
      },
      cancel: (id: number) =>
        request<{ id: number; status: string }>(
          `/agencies/action-requests/${id}/cancel`, { method: 'POST', body: {} }),
      notifyApprovers: (id: number) =>
        request<{ notified: number; smsSent: boolean }>(
          `/agencies/action-requests/${id}/notify-approvers`, { method: 'POST', body: {} }),
      requestCode: (id: number) =>
        request<{ challengeId: string; expiresAt: string; smsSent: boolean }>(
          `/agencies/action-requests/${id}/request-code`, { method: 'POST', body: {} }),
      verifyCode: (id: number, code: string, challengeId?: string) =>
        request<{ verified: boolean; challengeId: string }>(
          `/agencies/action-requests/${id}/verify-code`, { method: 'POST', body: challengeId ? { challengeId, code } : { code } }),
      approve: (id: number, code: string) =>
        request<{ id: number; status: string }>(
          `/agencies/action-requests/${id}/approve`, { method: 'POST', body: { code } }),
      reject: (id: number, note: string) =>
        request<{ id: number; status: string }>(
          `/agencies/action-requests/${id}/reject`, { method: 'POST', body: { note } }),
    },
    // Configuration des approbateurs désignés par (scope, actionType).
    approverConfigs: {
      list: (scope?: string) =>
        request<Array<{
          id: number; scope: string; actionType: string;
          approverSub: string; approverName: string; approverRole: string; approverPhone: string;
          assignedBy: string; assignedAt: string;
        }>>(`/agencies/approver-configs${scope ? `?scope=${scope}` : ''}`),
      create: (scope: string, actionType: string, approverSub: string, approverName: string, approverRole: string, approverPhone = '') =>
        request<{ id: number; scope: string; actionType: string; approverSub: string; approverName: string; approverRole: string; approverPhone: string }>(
          '/agencies/approver-configs', { method: 'POST', body: { scope, actionType, approverSub, approverName, approverRole, approverPhone } }),
      updatePhone: (id: number, phone: string) =>
        request<{ id: number; approverPhone: string }>(
          `/agencies/approver-configs/${id}/phone`, { method: 'PATCH', body: { approverPhone: phone } }),
      remove: (id: number) =>
        request<void>(`/agencies/approver-configs/${id}`, { method: 'DELETE' }),
    },
  },

  // Caisses/comptes de trésorerie (Wallets.jsx, Treasury.jsx) + portefeuilles clients
  // (ClientWallet.jsx).
  caisses: {
    accounts: {
      list: (agencyId?: number) =>
        request<unknown[]>(`/caisses/accounts${agencyId ? `?agency=${agencyId}` : ''}`),
      create: (data: Record<string, unknown>) =>
        request<unknown>('/caisses/accounts', { method: 'POST', body: data }),
      update: (code: string, data: Record<string, unknown>) =>
        request<unknown>(`/caisses/accounts/${code}`, { method: 'PATCH', body: data }),
      action: (code: string, data: Record<string, unknown>) =>
        request<unknown>(`/caisses/accounts/${code}/action`, { method: 'POST', body: data }),
      transfer: (fromCode: string, toCode: string, amount: number, reason = '') =>
        request<unknown>(`/caisses/accounts/${fromCode}/action`, {
          method: 'POST',
          body: { action: 'transfer', toCode, amount, reason, idempotencyKey: crypto.randomUUID() },
        }),
      addFlow: (code: string, amount: number, direction: 'in' | 'out', reason = '') =>
        request<unknown>(`/caisses/accounts/${code}/action`, {
          method: 'POST',
          body: { action: 'add_flow', amount, direction, reason, idempotencyKey: crypto.randomUUID() },
        }),
      block: (code: string) =>
        request<unknown>(`/caisses/accounts/${code}/action`, { method: 'POST', body: { action: 'block' } }),
      archive: (code: string) =>
        request<unknown>(`/caisses/accounts/${code}/action`, { method: 'POST', body: { action: 'archive' } }),
      reassign: (code: string, manager: string) =>
        request<unknown>(`/caisses/accounts/${code}/action`, {
          method: 'POST', body: { action: 'reassign', manager },
        }),
      // Discipline de caisse journalière (comptes `kind=CAISSE`) — comptage d'ouverture,
      // comptage de clôture comparé au solde système (écart au-delà de la tolérance ->
      // compte gelé automatiquement).
      registerOpen: (code: string, openingCount: number) =>
        request<CashRegisterSessionRow>(`/caisses/accounts/${code}/action`, {
          method: 'POST', body: { action: 'register_open', openingCount },
        }),
      registerClose: (code: string, closingCount: number) =>
        request<CashRegisterSessionRow>(`/caisses/accounts/${code}/action`, {
          method: 'POST', body: { action: 'register_close', closingCount },
        }),
      registerSessions: (code: string) =>
        request<CashRegisterSessionRow[]>(`/caisses/accounts/${code}/register-sessions`),
      setDailyCeiling: (code: string, dailyCeiling: number | null) =>
        request<unknown>(`/caisses/accounts/${code}/action`, {
          method: 'POST', body: { action: 'set_daily_ceiling', dailyCeiling },
        }),
      // Rattachement à un partenaire API (comptes `kind=MOBILE_MONEY`) + synchronisation de
      // connectivité (délègue au disjoncteur/health-check de `api.partners`).
      linkPartner: (code: string, partnerId: number | null) =>
        request<unknown>(`/caisses/accounts/${code}/action`, {
          method: 'POST', body: { action: 'link_partner', partnerId },
        }),
      syncPartner: (code: string) =>
        request<{ accountStatus: string; partnerSyncStatus: string; partnerCircuitState: string }>(
          `/caisses/accounts/${code}/action`, { method: 'POST', body: { action: 'sync_partner' } }),
    },
    wallets: {
      mine: () => request<unknown[]>('/caisses/wallets/mine'),
      deposit: (amount: number, currency = 'USD', channel = 'agent') =>
        request<unknown>('/caisses/wallets/mine/deposit', {
          method: 'POST', body: { amount, currency, channel, idempotencyKey: crypto.randomUUID() },
        }),
      withdraw: (amount: number, currency = 'USD') =>
        request<WithdrawalRequestRow>('/caisses/wallets/mine/withdraw', {
          method: 'POST', body: { amount, currency, idempotencyKey: crypto.randomUUID() },
        }),
      convert: (from: string, to: string, amount: number) =>
        request<{ detail: string; amount: number; result: number; fromCurrency: string; toCurrency: string }>(
          '/caisses/wallets/mine/convert',
          { method: 'POST', body: { from, to, amount, idempotencyKey: crypto.randomUUID() } }),
      movements: () => request<unknown[]>('/caisses/wallets/mine/movements'),
      myWithdrawalRequests: () => request<WithdrawalRequestRow[]>('/caisses/wallets/mine/withdrawal-requests'),
      // Résout/crée le portefeuille d'un client par son sub IdP (Support.jsx « Crédit
      // forcé ») — un agent connaît le client via son ticket, pas l'id interne du wallet.
      forUser: (sub: string, currency = 'USD') =>
        request<{ id: number; currency: string; balance: number; status: string; userSub: string }>(
          `/caisses/wallets/for-user/${encodeURIComponent(sub)}?currency=${encodeURIComponent(currency)}`),
    },
    withdrawalRequests: {
      list: () => request<WithdrawalRequestRow[]>('/caisses/withdrawal-requests'),
      approve: (id: number, otpCode?: string) =>
        request<WithdrawalRequestRow>(`/caisses/withdrawal-requests/${id}/approve`, {
          method: 'POST', body: { otpCode },
        }),
      reject: (id: number, reason = '') =>
        request<WithdrawalRequestRow>(`/caisses/withdrawal-requests/${id}/reject`, {
          method: 'POST', body: { reason },
        }),
      otpRequest: (id: number) =>
        request<{ challengeId: string; expiresAt: string }>(`/caisses/withdrawal-requests/${id}/otp`, {
          method: 'POST', body: {},
        }),
      otpVerify: (id: number, challengeId: string, code: string) =>
        request<{ verified: boolean }>(`/caisses/withdrawal-requests/${id}/otp/verify`, {
          method: 'POST', body: { challengeId, code },
        }),
    },
    regularizationOrders: {
      list: () => request<RegularizationOrderRow[]>('/caisses/regularization-orders'),
      create: (walletId: number, amount: number, reason = '', ticketId?: number) =>
        request<RegularizationOrderRow>('/caisses/regularization-orders', {
          method: 'POST', body: { walletId, amount, reason, ticketId, idempotencyKey: crypto.randomUUID() },
        }),
      approve: (id: number, otpCode?: string) =>
        request<RegularizationOrderRow>(`/caisses/regularization-orders/${id}/approve`, {
          method: 'POST', body: { otpCode },
        }),
      reject: (id: number, reason = '') =>
        request<RegularizationOrderRow>(`/caisses/regularization-orders/${id}/reject`, {
          method: 'POST', body: { reason },
        }),
      otpRequest: (id: number) =>
        request<{ challengeId: string; expiresAt: string }>(`/caisses/regularization-orders/${id}/otp`, {
          method: 'POST', body: {},
        }),
      otpVerify: (id: number, challengeId: string, code: string) =>
        request<{ verified: boolean }>(`/caisses/regularization-orders/${id}/otp/verify`, {
          method: 'POST', body: { challengeId, code },
        }),
    },
  },

  // Comptabilité en partie double (Accounting.jsx).
  ledger: {
    accounts: {
      list: () => request<LedgerAccount[]>('/ledger/accounts'),
      create: (data: Record<string, unknown>) =>
        request<LedgerAccount>('/ledger/accounts', { method: 'POST', body: data }),
    },
    entries: {
      list: () => request<unknown[]>('/ledger/entries'),
      create: (data: Record<string, unknown>) =>
        request<unknown>('/ledger/entries', {
          method: 'POST', body: { ...data, idempotencyKey: crypto.randomUUID() },
        }),
      reverse: (id: number, reason: string) =>
        request<unknown>(`/ledger/entries/${id}/reverse`, { method: 'POST', body: { reason } }),
    },
    trialBalance: (asOf?: string) => request<unknown[]>(`/ledger/trial-balance${asOf ? `?as_of=${asOf}` : ''}`),
    statements: (kind: string, asOf?: string) =>
      request<unknown>(`/ledger/statements/${kind}${asOf ? `?as_of=${asOf}` : ''}`),
    accountLines: (code: string) => request<unknown[]>(`/ledger/accounts/${code}/lines`),
  },

  // Taux de change 3 paliers (ExchangeRateManager, ClientWallet FX tab).
  fx: {
    rates: (tier?: string, currency?: string) => {
      const q = new URLSearchParams();
      if (tier) q.set('tier', tier);
      if (currency) q.set('currency', currency);
      const qs = q.toString();
      return request<unknown[]>(`/fx/rates${qs ? `?${qs}` : ''}`);
    },
    setRate: (data: Record<string, unknown>) => request<unknown>('/fx/rates', { method: 'POST', body: data }),
    current: (tier = 'CLIENT', currency = 'USD') =>
      request<unknown>(`/fx/rates/current?tier=${tier}&currency=${currency}`),
    // Synchronise le taux BCC du jour depuis bcc.cd (parsing HTML, pas d'API officielle) —
    // en cas d'échec, le formulaire manuel (setRate) reste le repli.
    syncBcc: () => request<Array<{ id: number; tier: string; currency: string; buy: number; sell: number; effectiveDate: string }>>(
      '/fx/rates/sync-bcc', { method: 'POST', body: {} }),
    convert: (amount: number, from: string, to: string, tier = 'CLIENT') =>
      request<{ amount: number; from: string; to: string }>(
        `/fx/convert?amount=${amount}&from=${from}&to=${to}&tier=${tier}`),
  },

  // Transactions & validation adaptative (Transactions.jsx, ValidationJournal.jsx,
  // SpecialCases.jsx, Supervision.jsx).
  transactions: {
    list: (status?: string) => request<unknown[]>(`/transactions/${status ? `?status=${status}` : ''}`),
    create: (data: Record<string, unknown>) =>
      request<unknown>('/transactions/', { method: 'POST', body: { ...data, idempotencyKey: crypto.randomUUID() } }),
    detail: (id: number) => request<unknown>(`/transactions/${id}`),
    approve: (id: number, otpCode?: string) =>
      request<unknown>(`/transactions/${id}/approve`, { method: 'POST', body: { otpCode } }),
    reject: (id: number, reason = '') =>
      request<unknown>(`/transactions/${id}/reject`, { method: 'POST', body: { reason } }),
    reverse: (id: number, reason = '') =>
      request<unknown>(`/transactions/${id}/reverse`, { method: 'POST', body: { reason } }),
    otpRequest: (id: number) => request<{ challengeId: string; expiresAt: string }>(`/transactions/${id}/otp/request`, { method: 'POST', body: {} }),
    otpVerify: (id: number, challengeId: string, code: string) =>
      request<{ verified: boolean }>(`/transactions/${id}/otp/verify`, {
        method: 'POST', body: { challengeId, code },
      }),
    bulkAction: (ids: number[], action: string) =>
      request<unknown[]>('/transactions/bulk-action', { method: 'POST', body: { ids, action } }),
    specialCases: () => request<unknown[]>('/transactions/special-cases'),
    escalateSpecialCase: (id: number, supervisorSub: string) =>
      request<unknown>(`/transactions/special-cases/${id}/escalate`, {
        method: 'POST', body: { supervisorSub },
      }),
    thresholds: () => request<unknown[]>('/transactions/thresholds'),
    setThreshold: (data: Record<string, unknown>) =>
      request<unknown>('/transactions/thresholds', { method: 'PATCH', body: data }),
    supervision: () => request<{ pendingCount: number; postedCount: number; specialCasesCount: number }>(
      '/transactions/supervision'),
  },

  // Journal d'audit partagé (AuditLog.jsx + onglet Audit de Users.jsx).
  /**
   * Journal d'audit — consultation et export, en LECTURE SEULE absolue.
   *
   * Les deux passent par `auditQuery` : c'est la garantie que le CSV exporté
   * porte EXACTEMENT le périmètre que l'auditeur a sous les yeux. Deux
   * sérialisations de filtres, c'est deux périmètres qui divergent en silence.
   *
   * Différence à restituer à l'utilisateur : `entries` est plafonné à 500 lignes
   * pour l'affichage, `export` est COMPLET sur le périmètre filtré. Un auditeur
   * qui croit voir tout alors qu'il voit 500 lignes tire de fausses conclusions —
   * d'où `totalRows`, à afficher dès qu'il dépasse le nombre de lignes rendues.
   */
  audit: {
    entries: (filters?: import('@/types/api').AuditFilters) =>
      request<Array<{
        id: number; timestamp: string; user: string; role: string; action: string;
        entityType: string; entityId: string; details: Record<string, unknown>; ip: string | null;
      }>>(`/audit/entries${auditQuery(filters)}`),

    /** Télécharge le CSV complet du périmètre filtré. Renvoie l'effectif réel
     *  exporté (`totalRows`) pour que l'écran puisse le confirmer. */
    export: async (filters?: import('@/types/api').AuditFilters) => {
      const { blob, filename, totalRows } = await requestBlob(`/audit/export${auditQuery(filters)}`);
      saveBlob(blob, filename || 'journal_audit.csv');
      return { totalRows };
    },
  },

  /**
   * Référentiel filières `ValueChain` — maker-checker, UI historiquement absente
   * (dette explicite du CLAUDE.md §6 : « maker-checker inaccessible hors API »).
   *
   * `activate` exige un checker ≠ maker ; le serveur refuse sinon. Le front ne
   * pré-juge jamais ce droit : il tente et relaie le refus serveur.
   */
  referenceData: {
    valueChains: () => request<unknown>('/reference-data/value-chains/'),
    uploads: () => request<unknown>('/reference-data/uploads/'),
    upload: (form: FormData) =>
      request<unknown>('/reference-data/upload/', { method: 'POST', body: form, isForm: true }),
    activate: (id: number) =>
      request<unknown>(`/reference-data/uploads/${id}/activate/`, { method: 'POST', body: {} }),
  },

  // RBAC (rôles/capacités/annuaire du personnel) — remplace les constantes codées en dur
  // de Users.jsx/Roles.jsx et le check de rôle string de Layout.jsx.
  rbac: {
    me: () => request<RbacMe>('/rbac/me'),
    roles: () => request<RbacRole[]>('/rbac/roles'),
    createRole: (data: Record<string, unknown>) =>
      request<RbacRole>('/rbac/roles', { method: 'POST', body: data }),
    updateRole: (roleId: string, data: Record<string, unknown>) =>
      request<RbacRole>(`/rbac/roles/${roleId}`, { method: 'PATCH', body: data }),
    supervisors: () => request<Array<{ sub: string; name: string; email: string; role: string }>>('/rbac/supervisors'),
    users: {
      list: () => request<RbacUser[]>('/rbac/users'),
      update: (sub: string, data: Record<string, unknown>) =>
        request<RbacUser>(`/rbac/users/${sub}`, { method: 'PATCH', body: data }),
      action: (sub: string, action: string) =>
        request<RbacUser>(`/rbac/users/${sub}/action`, { method: 'POST', body: { action } }),
    },
  },

  // Épargne individuelle + groupes (Savings.jsx + admin/savings/*).
  savings: {
    myPlans: () => request<unknown[]>('/savings/plans/mine'),
    createPlan: (data: Record<string, unknown>) =>
      request<unknown>('/savings/plans/mine', { method: 'POST', body: data }),
    deposit: (planId: number, amount: number, channel = 'agent') =>
      request<unknown>(`/savings/plans/${planId}/deposit`, { method: 'POST', body: { amount, channel } }),
    allPlans: () => request<unknown[]>('/savings/plans'),
    groups: {
      list: () => request<unknown[]>('/savings/groups'),
      mine: () => request<unknown[]>('/savings/groups/mine'),
      create: (data: Record<string, unknown>) =>
        request<unknown>('/savings/groups', { method: 'POST', body: data }),
      update: (groupId: number, data: Record<string, unknown>) =>
        request<unknown>(`/savings/groups/${groupId}`, { method: 'PATCH', body: data }),
      remove: (groupId: number) => request<unknown>(`/savings/groups/${groupId}`, { method: 'DELETE' }),
      requests: (groupId: number) => request<unknown[]>(`/savings/groups/${groupId}/requests`),
      join: (groupId: number, reason = '') =>
        request<unknown>(`/savings/groups/${groupId}/requests/join`, { method: 'POST', body: { reason } }),
      decide: (requestId: number, decision: 'approved' | 'rejected') =>
        request<unknown>(`/savings/groups/requests/${requestId}/decide`, { method: 'POST', body: { decision } }),
    },
    myGroupRequests: () => request<unknown[]>('/savings/requests/mine'),
    allGroupRequests: () => request<unknown[]>('/savings/requests'),
  },

  // Inventaire des actifs/garanties (AssetsInventory.jsx, étape Garanties de Credits.jsx).
  // Registre d'actifs gageables. Le client décrit ses actifs ; seul un agent
  // de terrain les vérifie et fixe leur valeur retenue (le statut n'est jamais
  // écrit depuis le front).
  assets: {
    /** `status` filtre par statut ; `pledgeable` ne garde que les actifs mobilisables. */
    mine: (params?: { status?: string; pledgeable?: boolean }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.pledgeable) qs.set('pledgeable', 'true');
      const suffix = qs.toString() ? `?${qs}` : '';
      return request<{ total_rows: number; items: AssetRow[] }>(`/assets/mine${suffix}`);
    },
    create: (data: Record<string, unknown>) => request<AssetRow>('/assets/mine', { method: 'POST', body: data }),
    update: (id: number, data: Record<string, unknown>) =>
      request<AssetRow>(`/assets/mine/${id}`, { method: 'PATCH', body: data }),
    remove: (id: number) => request<{ detail: string }>(`/assets/mine/${id}`, { method: 'DELETE' }),

    // ── Surface agent terrain ───────────────────────────────────────────────
    /** File de vérification : actifs déclarés en attente de contrôle. */
    pending: () => request<{ total_rows: number; items: AssetRow[] }>('/assets/pending'),
    /** La valeur retenue est calculée par le serveur (valeur constatée − décote). */
    verify: (id: number, data: { valeur_verifiee: number | string; documents?: unknown[] }) =>
      request<AssetRow>(`/assets/${id}/verify`, { method: 'POST', body: data }),
    reject: (id: number, motif: string) =>
      request<AssetRow>(`/assets/${id}/reject`, { method: 'POST', body: { motif } }),
  },

  // Contrats client (Contracts.jsx) — signature électronique simple partie.
  contracts: {
    mine: () => request<unknown[]>('/contracts/mine'),
    sign: (id: number, signature: string, agreed: boolean) =>
      request<unknown>(`/contracts/mine/${id}/sign`, { method: 'POST', body: { signature, agreed } }),
  },

  // Annuaire fournisseurs (Suppliers.jsx).
  suppliers: {
    list: () => request<unknown[]>('/suppliers/'),
    create: (data: Record<string, unknown>) => request<unknown>('/suppliers/', { method: 'POST', body: data }),
    action: (id: number, action: string) =>
      request<unknown>(`/suppliers/${id}/action`, { method: 'POST', body: { action } }),
  },

  // KYC/AML + documents (Compliance.jsx, ClientDocuments.jsx, InvestorDocuments.jsx).
  compliance: {
    kycProfiles: () => request<unknown[]>('/compliance/kyc'),
    myKyc: () => request<KycMine>('/compliance/kyc/mine'),
    validateKyc: (userSub: string) =>
      request<unknown>(`/compliance/kyc/${userSub}/validate`, { method: 'POST', body: {} }),
    myDocuments: () => request<unknown[]>('/compliance/documents/mine'),
    uploadDocument: (data: Record<string, unknown>) =>
      request<unknown>('/compliance/documents/mine', { method: 'POST', body: data }),
    // Revue d'un document (approve/reject) — recalcule le palier KYC (T1/T2/T3) du client.
    reviewDocument: (docId: number, status: 'approved' | 'rejected') =>
      request<{ id: number; status: string; kycLevel: string; monthlyLimit: number }>(
        `/compliance/documents/${docId}/review`, { method: 'POST', body: { status } }),
  },

  // Support client — tickets CRM (Support.jsx) + conversations investisseur↔gestionnaire
  // (chat de Holdings.jsx).
  support: {
    tickets: {
      list: (params?: Record<string, string>) => {
        const q = params ? '?' + new URLSearchParams(params).toString() : '';
        return request<TicketRow[]>(`/support/tickets${q}`);
      },
      create: (data: Record<string, unknown>) =>
        request<TicketRow>('/support/tickets', { method: 'POST', body: data }),
      update: (id: number, data: Record<string, unknown>) =>
        request<TicketRow>(`/support/tickets/${id}`, { method: 'PATCH', body: data }),
      messages: (id: number) => request<TicketMessage[]>(`/support/tickets/${id}/messages`),
      sendMessage: (id: number, text: string, isInternal = false) =>
        request<TicketMessage>(`/support/tickets/${id}/messages`, {
          method: 'POST', body: { text, isInternal },
        }),
      // Machine à états dédiée
      claim: (id: number) =>
        request<TicketRow>(`/support/tickets/${id}/claim`, { method: 'POST', body: {} }),
      assign: (id: number, agentSub: string) =>
        request<TicketRow>(`/support/tickets/${id}/assign`, { method: 'POST', body: { agentSub } }),
      escalate: (id: number, reason: string) =>
        request<TicketRow>(`/support/tickets/${id}/escalate`, { method: 'POST', body: { reason } }),
      resolve: (id: number, resolutionSummary: string) =>
        request<TicketRow>(`/support/tickets/${id}/resolve`, { method: 'POST', body: { resolutionSummary } }),
      reject: (id: number, params: { rejectType: string; reason: string; originalTicketId?: number | null }) =>
        request<TicketRow>(`/support/tickets/${id}/reject`, { method: 'POST', body: params }),
      reopen: (id: number) => request<TicketRow>(`/support/tickets/${id}/reopen`, { method: 'POST', body: {} }),
      setWaitingOn: (id: number, value: 'agent' | 'client') =>
        request<TicketRow>(`/support/tickets/${id}/waiting-on`, { method: 'POST', body: { value } }),
      rate: (id: number, rating: number, comment = '') =>
        request<TicketRow>(`/support/tickets/${id}/rate`, { method: 'POST', body: { rating, comment } }),
      verifyMm: (id: number, transactionRef?: string) =>
        request<{ verificationId: number; operator: string; transactionRef: string; status: string; amount: string | null; currency: string; verifiedAt: string | null }>(
          `/support/tickets/${id}/verify-mobile-money`,
          { method: 'POST', body: transactionRef ? { transactionRef } : {} }),
      forceCredit: (id: number, body: Record<string, unknown> = {}) =>
        request<{ actionId: number; status: string; amount: string; currency: string; initiatedBy: string; approvedBy: string; accountingRef: string; decidedAt: string | null }>(
          `/support/tickets/${id}/force-credit`, { method: 'POST', body }),
      stats: () => request<import('../types/api').SupportDashboardStats>('/support/dashboard/stats'),
      awaitClient: (id: number, question: string) =>
        request<TicketRow>(`/support/tickets/${id}/await-client`, { method: 'POST', body: { question } }),
      client360: (id: number) =>
        request<import('../types/api').ClientProfile360>(`/support/tickets/${id}/client-360`),
      revealContact: (id: number) =>
        request<{ phone: string | null; email: string | null; revealedAt: string; revealedBy: string }>(
          `/support/tickets/${id}/reveal-contact`, { method: 'POST', body: {} }),
    },
    conversations: {
      mine: () => request<unknown[]>('/support/conversations/mine'),
      start: (managerSub: string) =>
        request<{ id: number; investorSub: string; managerSub: string }>('/support/conversations', {
          method: 'POST', body: { managerSub },
        }),
      messages: (conversationId: number) =>
        request<Array<{ id: number; senderSub: string; text: string; createdAt: string }>>(
          `/support/conversations/${conversationId}/messages`),
      send: (conversationId: number, text: string) =>
        request<unknown>(`/support/conversations/${conversationId}/messages/send`, {
          method: 'POST', body: { text },
        }),
    },
  },

  // Notifications (ClientNotifications.jsx / InvestorNotifications.jsx).
  notifications: {
    mine: () => request<unknown[]>('/notifications/mine'),
    markRead: (id: number) => request<unknown>(`/notifications/${id}/read`, { method: 'POST', body: {} }),
  },

  // Statut des connexions API tierces (ApiPartners.jsx).
  partners: {
    list: () => request<unknown[]>('/partners/'),
    configure: (id: number, data: { baseUrl?: string; type?: string }) =>
      request<unknown>(`/partners/${id}`, { method: 'PATCH', body: data }),
    sync: (id: number) => request<unknown>(`/partners/${id}/sync`, { method: 'POST', body: {} }),
    test: (id: number) => request<{ partner: unknown; check: { ok: boolean; latencyMs: number | null;
      httpStatus: number | null; errorText: string; checkedAt: string } }>(
      `/partners/${id}/test`, { method: 'POST', body: {} }),
    logs: (id: number) => request<Array<{ type: string; ok: boolean; detail: string; latencyMs: number | null;
      timestamp: string }>>(`/partners/${id}/logs`),
  },

  // Agrégation lecture seule (Analytics.jsx, Dashboard.jsx, MultiCurrencyDashboard.jsx).
  analytics: {
    overview: () => request<{
      activeAgencies: number; suspendedAgencies: number; treasuryTotalUSD: number;
      pendingTransactions: number; postedTransactions: number;
    }>('/analytics/overview'),
    complianceScore: () => request<{
      score: number | null; deltaWow: number | null;
      components: Array<{ code: string; label: string; weight: number; score: number | null }>;
    }>('/analytics/compliance-score'),
  },

  // Moteur d'alertes configurable (Supervision.jsx).
  alerts: {
    list: (filters?: { status?: string; severity?: string }) => {
      const q = new URLSearchParams();
      if (filters?.status) q.set('status', filters.status);
      if (filters?.severity) q.set('severity', filters.severity);
      const qs = q.toString();
      return request<Array<{
        id: number; ruleCode: string | null; severity: string; title: string; body: string;
        sourceType: string; sourceId: string; status: string; triggeredAt: string;
        acknowledgedBy: string; acknowledgedAt: string | null;
        resolvedBy: string; resolvedAt: string | null; resolutionNote: string;
      }>>(`/alerts/${qs ? `?${qs}` : ''}`);
    },
    acknowledge: (id: number) => request<unknown>(`/alerts/${id}/acknowledge`, { method: 'POST', body: {} }),
    resolve: (id: number, resolutionNote = '') =>
      request<unknown>(`/alerts/${id}/resolve`, { method: 'POST', body: { resolutionNote } }),
    rules: {
      list: () => request<Array<{
        id: number; code: string; name: string; description: string; metric: string;
        operator: string; threshold: number; severity: string; enabled: boolean;
      }>>('/alerts/rules'),
      update: (id: number, data: Record<string, unknown>) =>
        request<unknown>(`/alerts/rules/${id}`, { method: 'PATCH', body: data }),
    },
  },
  sms: {
    test: (phone: string, message: string) =>
      request<{ sent: boolean; phone: string; message: string }>(
        '/sms/test', { method: 'POST', body: { phone, message } }),
  },
};

export { ApiError };
