/**
 * Formes de réponse que `src/types/api.ts` ne couvre pas encore, et helpers de
 * présentation du backoffice crédit.
 *
 * Historique — ce fichier a d'abord servi à contourner une divergence de contrat :
 * `types/api.ts` déclarait `CreditApplication` en snake_case alors que
 * `credits/workflow.py::serialize_application` émet du camelCase. **Cette
 * divergence est résolue** : le type partagé a été migré et les écrans du
 * backoffice consomment désormais `CreditApplication` directement. `WireApplication`
 * et ses satellites ont été supprimés d'ici — ils n'avaient de raison d'être que
 * tant que le type partagé mentait.
 *
 * Ce qui reste est légitime et non dupliqué :
 *   - la corbeille du comité (`CreditDashboard` est une union dont la branche
 *     comité n'est pas typée) ;
 *   - l'entrée de journal d'audit (le type inline de `api.ts` omet `userName`,
 *     que le backend résout pourtant depuis le `sub`) ;
 *   - les plafonds de troncature serveur, pour que les écrans les annoncent ;
 *   - les formateurs et libellés partagés par les quatre écrans.
 *
 * Références backend :
 *   - `backend/credits/dashboard.py`  → `_committee_dashboard`
 *   - `backend/audit/views.py`        → `entries`, `_row`
 */

// ── Corbeille du comité (`GET /api/credits/dashboard/?view=committee`) ─────────

export interface WireCommitteeApplication {
  code: string;
  status: string;
  amount_requested: number;
  currency: string;
  value_chain__label: string | null;
  created_at: string;
}

export interface WireCommitteeDashboard {
  role: 'credit_committee';
  summary: {
    pendingReview: number;
    totalVolumeUsd: number;
    delegationThresholdUsd: number;
  };
  /** Tronquée à 20 lignes côté serveur — voir `PENDING_LIST_CAP`. */
  pendingApplications: WireCommitteeApplication[];
}

/** `_committee_dashboard` sert au maximum 20 dossiers (`[:20]`). Le compteur
 *  honnête d'une liste tronquée est `summary.pendingReview`, pas `length`. */
export const PENDING_LIST_CAP = 20;

// ── Journal d'audit (`GET /api/audit/entries`) ────────────────────────────────

export interface WireAuditEntry {
  id: number;
  timestamp: string;
  user: string;
  /** Nom résolu depuis le `sub` par le backend ; absent du type partagé. */
  userName?: string;
  role: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  ip: string | null;
}

/** `audit.views.entries` coupe à `qs[:500]` sans indicateur de troncature. */
export const AUDIT_ROWS_CAP = 500;

// ── État du consentement client ───────────────────────────────────────────────

export type ConsentState = 'none' | 'pending' | 'expired' | 'given';

/**
 * Traduit les trois champs servis par le backend en un état d'affichage.
 *
 * Aucun calcul métier ici : `pendingClientConsent` est décidé par le serveur
 * (`CreditApplication.pending_client_consent`). Le seul état dérivé côté front
 * est « expiré », que le backend n'expose pas — il replie ce cas dans un
 * `pendingClientConsent = false` indistinguable d'un dossier sans consentement
 * requis. Comparer `clientConsentExpires` à l'horloge locale est un pis-aller
 * assumé et signalé (endpoint manquant : un champ `clientConsentExpired`).
 *
 * Signature structurelle plutôt que `CreditApplication` : la fonction n'a besoin
 * que de ces quatre champs, et reste ainsi utilisable sur une ligne de liste
 * comme sur un dossier complet.
 */
export function consentState(app: {
  isOnBehalfOf?: boolean;
  pendingClientConsent?: boolean;
  clientConsentAt?: string | null;
  clientConsentExpires?: string | null;
}): ConsentState {
  if (!app.isOnBehalfOf) return 'none';
  if (app.clientConsentAt) return 'given';
  if (app.pendingClientConsent) return 'pending';
  if (app.clientConsentExpires && new Date(app.clientConsentExpires).getTime() < Date.now()) {
    return 'expired';
  }
  return 'none';
}

// ── Formatage ─────────────────────────────────────────────────────────────────

/** Formateur unique de montants : jamais de `toLocaleString()` nu dans un écran. */
export function fmtAmount(amount: number | null | undefined, currency: string): string {
  if (amount == null) return '—';
  return `${amount.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${currency}`;
}

export function fmtDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString('fr-FR') : '—';
}

export function fmtDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('fr-FR') : '—';
}

/** Ancienneté en jours pleins depuis une date serveur — usage tri/affichage. */
export function ageInDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000);
}

export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: 'text-gray-400 bg-gray-500/20' },
  submitted: { label: 'Soumis', color: 'text-blue-300 bg-blue-500/20' },
  in_analysis: { label: 'En analyse', color: 'text-yellow-300 bg-yellow-500/20' },
  approved: { label: 'Approuvé', color: 'text-emerald-300 bg-emerald-500/20' },
  pending_disbursement: { label: 'En décaissement', color: 'text-purple-300 bg-purple-500/20' },
  active: { label: 'Actif', color: 'text-green-300 bg-green-500/20' },
  closed: { label: 'Clôturé', color: 'text-gray-400 bg-gray-600/20' },
  rejected: { label: 'Rejeté', color: 'text-red-300 bg-red-500/20' },
  adjourned: { label: 'Ajourné', color: 'text-orange-300 bg-orange-500/20' },
};

export function statusOf(status: string): { label: string; color: string } {
  return STATUS_LABELS[status] ?? { label: status, color: 'text-gray-400 bg-gray-500/20' };
}
