/**
 * Module épargne — endpoints d'ADMINISTRATION (config de taux, ajustement des modalités,
 * affectation de groupe, fiche détaillée, journal d'audit) et logique PURE associée.
 *
 * Pourquoi un module séparé de `api.ts` : ces endpoints n'existaient pas quand le module
 * central a été figé, et le chantier « persistance des taux d'épargne » corrige un défaut
 * précis — les modales admin (`SavingsRateModal`, `SavingsAdjustmentModal`, `SavingsRow`,
 * `AssignGroupModal`, `GroupManagementModal`) écrivaient la configuration de taux, les
 * ajustements et l'audit dans `localStorage`, et calculaient le taux mensuel côté client
 * (`val / 12`). Rien n'était partagé, rien ne survivait à un vidage de cache, aucun
 * auditeur ne voyait quoi que ce soit.
 *
 * Deux règles tenues sans exception ici (CLAUDE.md §5) :
 *   1. AUCUN chiffre métier n'est calculé côté client. Le taux mensuel, les métriques
 *      d'ajustement et la projection de croissance sont TOUS servis par le serveur ; ce
 *      module ne fait que router les appels et METTRE EN FORME (libellés, formatage) ce
 *      qu'il reçoit. La seule « validation » locale est un garde-fou d'ergonomie (bornes
 *      de saisie) que le serveur re-vérifie et qui n'engage rien.
 *   2. Les erreurs remontent en `ApiError` (importé de `./api`), donc `toFieldErrors`
 *      (`err instanceof ApiError`) déplie correctement les refus 422 multi-causes.
 */
import { ApiError } from './api';
import { tokens, refresh } from './oidc';

interface RequestOpts {
  method?: string;
  body?: unknown;
  retry?: boolean;
}

/**
 * Transport minimal, fidèle à celui de `api.ts` : Bearer injecté, un seul rafraîchissement
 * sur 401, et surtout la MÊME normalisation des refus — un 422 du pipeline épargne porte
 * plusieurs `{code, message}`, les aplatir ferait disparaître les causes à corriger. On
 * relève une `ApiError` (la classe de `api.ts`) pour que le dépliage partagé fonctionne.
 */
async function request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = 'GET', body, retry = true } = opts;
  const headers: Record<string, string> = {};
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && (await refresh())) {
    return request<T>(path, { ...opts, retry: false });
  }
  if (!res.ok) {
    let detail = '';
    let code: string | null = null;
    let errors: Array<{ code: string; message: string }> = [];
    try {
      const parsed = (await res.json()) as {
        detail?: string;
        code?: string;
        errors?: Array<string | { code?: string; message?: string }>;
      };
      detail = parsed.detail || detail;
      code = parsed.code ?? null;
      if (Array.isArray(parsed.errors)) {
        errors = parsed.errors.map((e) =>
          typeof e === 'string'
            ? { code: 'ERREUR', message: e }
            : { code: e.code || 'ERREUR', message: e.message || '' });
        if (!detail && errors.length) detail = errors[0].message;
      }
    } catch { /* corps non-JSON */ }
    if (!detail) detail = `Erreur ${res.status}`;
    throw new ApiError(res.status, detail, code, errors);
  }
  const ct = res.headers.get('content-type') || '';
  return (ct.includes('application/json') ? await res.json() : (res as unknown)) as T;
}

/* ─────────────────────────────── Types servis ─────────────────────────────── */

export type SavingsRateStatus = 'actif' | 'suspendu' | 'bloque';
export type SavingsRateAction = 'rate_update' | 'block' | 'suspend' | 'resume';

/** Une ligne de l'historique append-only des changements de taux (servie par le serveur). */
export interface RateChangeRow {
  id: number;
  annualRate: number;
  monthlyRate: number;
  status: SavingsRateStatus;
  action: SavingsRateAction;
  effectiveDate: string;
  reason: string;
  actor: string;
  date: string;
}

/** Configuration de taux COURANTE d'un plan + historique. Tout est servi ; rien n'est
 *  recalculé côté client (`monthlyRate` compris). */
export interface RateConfig {
  planId: number;
  annualRate: number;
  monthlyRate: number;
  status: SavingsRateStatus;
  maxAnnualRate: number;
  history: RateChangeRow[];
}

export interface AdjustmentProjectionRow {
  num: number;
  date: string;
  deposit: number;
  projected: number;
}

/** Métriques d'ajustement — CALCULÉES SERVEUR. `depositsNeeded` à `null` = non calculable
 *  (pas de versement périodique), jamais rendu comme un nombre ou « ∞ ». */
export interface AdjustmentMetrics {
  remaining: number;
  depositsNeeded: number | null;
  projectedMaturity: string | null;
  projection: AdjustmentProjectionRow[];
}

export interface AdjustmentRow {
  id: number;
  targetAmount: number;
  depositMode: string;
  frequency: string;
  periodicDeposit: number;
  reason: string;
  actor: string;
  date: string;
}

export interface AdjustmentConfig {
  planId: number;
  targetAmount: number;
  currentBalance: number;
  depositMode: string;
  frequency: string;
  periodicDeposit: number;
  currency: string;
  metrics: AdjustmentMetrics;
  history: AdjustmentRow[];
}

export interface GroupMemberHistoryRow {
  sub: string;
  name: string;
  joinedAt: string;
  /** `null` tant qu'aucun mouvement d'argent n'est rattaché à un groupe : on ne fabrique
   *  pas de cotisation individuelle (§4.6). */
  contribution: number | null;
}

export interface GroupDetail {
  id: number;
  name: string;
  type: string;
  description: string;
  rate: number;
  frequency: string;
  balance: number;
  membersCount: number;
  members: string[];
  status: string;
  adminSub: string;
  createdAt: string;
  memberHistory: GroupMemberHistoryRow[];
  requests: Array<{ id: number; userName: string; reason: string; status: string; date: string }>;
  contributionsTracked: boolean;
}

export interface GroupAuditRow {
  id: number;
  action: string;
  actor: string;
  details: Record<string, unknown>;
  date: string;
}

export interface RateChangePayload {
  action: SavingsRateAction;
  annualRate?: number | string;
  effectiveDate?: string;
  reason?: string;
}

export interface AdjustmentPayload {
  targetAmount?: number | string;
  periodicDeposit?: number | string;
  frequency?: string;
  depositMode?: string;
  reason?: string;
}

/* ─────────────────────────────── Endpoints ─────────────────────────────── */

export const savingsAdminApi = {
  rateConfig: {
    get: (planId: number | string) => request<RateConfig>(`/savings/plans/${planId}/rate-config`),
    apply: (planId: number | string, payload: RateChangePayload) =>
      request<RateConfig>(`/savings/plans/${planId}/rate-config`, { method: 'POST', body: payload }),
  },
  adjustment: {
    get: (planId: number | string) => request<AdjustmentConfig>(`/savings/plans/${planId}/adjustment`),
    apply: (planId: number | string, payload: AdjustmentPayload) =>
      request<AdjustmentConfig>(`/savings/plans/${planId}/adjustment`, { method: 'POST', body: payload }),
  },
  groups: {
    detail: (groupId: number | string) => request<GroupDetail>(`/savings/groups/${groupId}`),
    audit: (groupId: number | string) => request<GroupAuditRow[]>(`/savings/groups/${groupId}/audit`),
    /** Affecte un titulaire (par `sub`) à un groupe, ou le désaffecte (`groupId` `null`/`'none'`). */
    assign: (userSub: string, groupId: number | string | null) =>
      request<{ userSub: string; groupId: number | null; groupName: string | null }>(
        '/savings/groups/assign', { method: 'POST', body: { userSub, groupId } }),
  },
};

/* ─────────────────────────── Logique PURE (testée) ─────────────────────────── */

/** Libellé fr d'un statut de taux. Un code inconnu se montre tel quel — jamais deviné. */
export function rateStatusLabel(status: string): string {
  const map: Record<string, string> = { actif: 'Actif', suspendu: 'Suspendu', bloque: 'Bloqué' };
  return map[status] ?? status;
}

/** Classe de couleur (Tailwind) associée au statut, pour un badge cohérent. */
export function rateStatusTone(status: string): string {
  const map: Record<string, string> = {
    actif: 'text-emerald-400 border-emerald-500/30',
    suspendu: 'text-amber-400 border-amber-500/30',
    bloque: 'text-red-400 border-red-500/30',
  };
  return map[status] ?? 'text-slate-400 border-slate-500/30';
}

export const RATE_ACTION_LABELS: Record<SavingsRateAction, string> = {
  rate_update: 'Modification du taux',
  block: 'Blocage (taux 0%)',
  suspend: 'Suspension',
  resume: 'Réactivation',
};

/** Pourcentage formaté fr-FR (le nombre vient du serveur, on ne fait que l'afficher). */
export function formatPct(value: number | null | undefined, fractionDigits = 3): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('fr-FR', {
    minimumFractionDigits: 0, maximumFractionDigits: fractionDigits,
  })} %`;
}

/** Montant formaté fr-FR + devise accolée. Aucune conversion : on affiche tel quel. */
export function formatAmount(value: number | null | undefined, currency: string | null): string {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const formatted = v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${formatted} ${currency}` : formatted;
}

/**
 * Garde-fou de SAISIE du taux annuel (pas un calcul métier) : borne 0..max. Le serveur
 * reste l'autorité — il re-vérifie et renvoie `RATE_ABOVE_MAX`/`RATE_NEGATIVE`. Ce contrôle
 * évite juste un aller-retour évident. Renvoie un message d'erreur ou `null`.
 */
export function validateAnnualRate(raw: string, maxRate: number): string | null {
  const value = parseFloat(String(raw).replace(',', '.'));
  if (!Number.isFinite(value)) return 'Taux invalide.';
  if (value < 0) return 'Le taux ne peut pas être négatif.';
  if (value > maxRate) return `Le taux ne peut excéder ${maxRate} %.`;
  return null;
}

/** Libellé fr d'une fréquence de dépôt. */
export function frequencyLabel(freq: string): string {
  const map: Record<string, string> = {
    hebdomadaire: 'Hebdomadaire', bimensuel: 'Bimensuel', mensuel: 'Mensuel',
    trimestriel: 'Trimestriel', annuel: 'Annuel',
  };
  return map[freq] ?? freq;
}
