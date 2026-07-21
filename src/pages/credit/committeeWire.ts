/**
 * Écran comité de crédit — types et libellés de présentation.
 *
 * Les FORMES de payload ne sont plus déclarées ici : le contrat partagé
 * (`src/types/api.ts`) porte désormais `CommitteeVoteEntry`,
 * `CommitteeVotesSummary`, `CommitteeVoteResult` et `CreditDashboardCommittee`,
 * alignés sur le backend. Une seule nomenclature par concept (principe 6) : cet
 * écran ré-exporte ces types, il n'en redéclare aucun.
 *
 * Source de vérité backend, lue avant écriture (aucune clé devinée) :
 *   - `backend/credits/committee.py::votes_summary`   → `CommitteeVotesSummary`
 *   - `backend/credits/committee.py::_serialize_vote` → `CommitteeVoteEntry`
 *   - `backend/credits/committee.py::cast_vote`       → `CommitteeVoteResult`
 *   - `backend/credits/dashboard.py::_committee_dashboard` → corbeille
 *   - `backend/credits/views.py::committee_votes / committee_vote` (403/404/409/422)
 *
 * Ce qui reste ici est de la présentation : libellés, couleurs, et le
 * sous-ensemble d'analyse que l'écran lit. Aucun seuil, aucun barème, aucun
 * quorum n'est recopié côté front (principes 7 et 8).
 */
import type {
  CommitteeVoteEntry,
  CommitteeVotesSummary,
  CommitteeVoteResult,
  CreditAnalyse,
  CreditDashboardCommittee,
} from '@/types/api';

export type {
  CommitteeVoteEntry,
  CommitteeVotesSummary,
  CommitteeVoteResult,
  CreditDashboardCommittee,
};

/** Les deux seuls sens de vote acceptés par `cast_vote` (`CommitteeVote.Decision`). */
export type CommitteeDecision = 'approve' | 'reject';

/** Ligne de la corbeille — `.values()` Django, donc snake_case (et `__label`). */
export type CommitteeRow = CreditDashboardCommittee['pendingApplications'][number];

/** Libellés d'un sens de vote. Un code inconnu s'affiche tel quel, jamais deviné. */
export const DECISION_LABELS: Record<string, { label: string; className: string }> = {
  approve: { label: "Pour l'approbation", className: 'text-emerald-300 bg-emerald-500/20' },
  reject: { label: 'Pour le rejet', className: 'text-red-300 bg-red-500/20' },
};

export function decisionLabel(code: string | null | undefined): {
  label: string; className: string;
} {
  if (!code) return { label: '—', className: 'text-slate-400 bg-white/10' };
  return DECISION_LABELS[code] ?? { label: code, className: 'text-slate-300 bg-white/10' };
}

/**
 * Extrait de l'analyse moteur affiché par l'écran comité.
 *
 * Le comité a besoin de la recommandation, pas du barème : ce sous-ensemble de
 * `CreditAnalyse` est ce que l'écran lit, rien de plus.
 */
export interface CommitteeMoteur {
  scoreGlobal: number;
  scoreLettre: string;
  recommandation: string;
  dscr: number | null;
  dscrStress: number | null;
  executeLe: string;
}

/** Projection — aucune valeur n'est recalculée, seulement recopiée. */
export function toMoteur(a: CreditAnalyse): CommitteeMoteur {
  return {
    scoreGlobal: a.scoreGlobal,
    scoreLettre: a.scoreLettre,
    recommandation: a.recommandation,
    dscr: a.dscr,
    dscrStress: a.dscrStress,
    executeLe: a.executeLe,
  };
}

/** État de chargement de l'analyse d'un dossier — « absente » n'est pas une panne. */
export type MoteurEntry =
  | { state: 'loading' }
  | { state: 'ok'; data: CommitteeMoteur }
  | { state: 'absent'; message: string }
  | { state: 'error'; message: string };

/** Code du 404 « aucune analyse exécutée » (`views.analyse_detail`). */
export const ANALYSE_ABSENTE = 'ANALYSE_ABSENTE';

/** Couleur de la lettre servie par le moteur. La lettre vient du serveur : on la
 *  colore, on ne la dérive jamais d'un score côté front. */
export const LETTRE_CLASSES: Record<string, string> = {
  A: 'text-emerald-300 bg-emerald-500/20',
  B: 'text-lime-300 bg-lime-500/20',
  C: 'text-yellow-300 bg-yellow-500/20',
  D: 'text-red-300 bg-red-500/20',
};

export function lettreClass(lettre: string | null | undefined): string {
  if (!lettre) return 'text-slate-400 bg-white/10';
  return LETTRE_CLASSES[lettre] ?? 'text-slate-300 bg-white/10';
}
