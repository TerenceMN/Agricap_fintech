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

/**
 * Canaux de dépôt canoniques (miroir de `SavingsPlan.Channel` côté serveur). Le
 * mode d'ajustement DOIT être l'un d'eux : l'ancienne modale proposait
 * `virement`/`especes`/… que le serveur refuse en `MODE_UNKNOWN` (principe 6 —
 * une seule nomenclature par concept). Le front mappe pour l'affichage, mais
 * n'envoie que ces codes.
 */
export const DEPOSIT_MODES: readonly { id: string; label: string }[] = [
  { id: 'agent', label: 'Agent Agricap' },
  { id: 'mobile_money', label: 'Mobile Money' },
  { id: 'bank', label: 'Banque' },
  { id: 'wallet', label: 'Portefeuille' },
] as const;

/** Libellé fr d'un mode de dépôt. Un code inconnu se montre tel quel. */
export function depositModeLabel(mode: string): string {
  return DEPOSIT_MODES.find((m) => m.id === mode)?.label ?? mode;
}

/** Libellé fr d'une action de taux. Code inconnu montré tel quel — jamais deviné. */
export function rateActionLabel(action: string): string {
  return RATE_ACTION_LABELS[action as SavingsRateAction] ?? action;
}

/**
 * Restitution lisible d'une ligne d'HISTORIQUE de taux servie par le serveur.
 * Ne calcule rien : les taux (annuel ET mensuel) viennent du serveur, on ne fait
 * que les mettre en forme. Le mensuel garde 4 décimales (c'est `annuel / 12`,
 * arrondi serveur), les autres 3.
 */
export function describeRateChange(row: RateChangeRow): { actionLabel: string; detail: string } {
  const parts = [
    `Taux annuel ${formatPct(row.annualRate)}`,
    `mensuel ${formatPct(row.monthlyRate, 4)}`,
    `statut ${rateStatusLabel(row.status)}`,
  ];
  if (row.reason) parts.push(`motif : ${row.reason}`);
  return { actionLabel: rateActionLabel(row.action), detail: parts.join(' · ') };
}

/**
 * Nombre de dépôts nécessaires, tel qu'affiché. `null` = non calculable (aucun
 * versement périodique) : on le DIT, on ne rend jamais « ∞ » comme un nombre —
 * c'était le défaut de l'ancienne modale (§4.6). Le nombre lui-même vient du
 * serveur, on ne le recalcule pas.
 */
export function depositsNeededLabel(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Non calculable (aucun versement périodique)';
  }
  return `${value}`;
}

/** Libellés fr des actions du journal d'audit d'un groupe (codes serveur). */
export const GROUP_AUDIT_LABELS: Record<string, string> = {
  'savings.group.create': 'Création du groupe',
  'savings.group.update': 'Mise à jour des paramètres',
  'savings.group.assign_member': 'Affectation de membre',
  'savings.group.integration_decision': "Décision d'adhésion",
};

/** Libellé fr d'une action d'audit de groupe. Code inconnu montré tel quel. */
export function groupAuditLabel(action: string): string {
  return GROUP_AUDIT_LABELS[action] ?? action;
}

/**
 * Résumé lisible du `details` d'une entrée d'audit de groupe servie par le
 * serveur. Ciblé sur les clés connues ; renvoie une chaîne vide plutôt que
 * d'exposer un dictionnaire brut ou d'inventer du sens sur une action inconnue.
 */
export function summarizeGroupAudit(entry: GroupAuditRow): string {
  const d = (entry.details ?? {}) as Record<string, unknown>;
  switch (entry.action) {
    case 'savings.group.assign_member': {
      const name = d.groupName ? String(d.groupName) : null;
      const who = d.userSub ? String(d.userSub) : 'Un membre';
      return name ? `${who} affecté au groupe « ${name} »` : `${who} retiré de son groupe`;
    }
    case 'savings.group.update': {
      const bits: string[] = [];
      if (d.rate !== undefined && d.rate !== null && `${d.rate}` !== '') {
        bits.push(`taux ${d.rate} %`);
      }
      if (d.frequency) bits.push(`fréquence ${frequencyLabel(String(d.frequency))}`);
      return bits.join(', ');
    }
    case 'savings.group.integration_decision': {
      const decision = String(d.decision ?? '');
      if (decision === 'approved') return 'Demande approuvée';
      if (decision === 'rejected') return 'Demande rejetée';
      return decision;
    }
    default:
      return '';
  }
}
