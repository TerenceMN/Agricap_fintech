/**
 * Formes de payload du comité de crédit, telles que le backend les émet.
 *
 * Source de vérité lue avant écriture (aucune clé inventée — un type deviné a
 * déjà produit un `undefined` en production ce mois-ci) :
 *   - `backend/credits/committee.py::votes_summary`   → `CommitteeVotesSummary`
 *   - `backend/credits/committee.py::_serialize_vote` → `CommitteeVoteEntry`
 *   - `backend/credits/committee.py::cast_vote`       → `CommitteeVoteResult`
 *   - `backend/credits/views.py::committee_votes / committee_vote` (statuts HTTP)
 *
 * Pourquoi ici et pas dans `src/types/api.ts` : ce fichier appartient à l'écran
 * comité. `types/api.ts` est tenu par un autre agent ; si ces types y arrivent,
 * la compatibilité reste assurée — TypeScript est structurel et les champs sont
 * identiques. `decision` est volontairement typé `string` en LECTURE (le serveur
 * décide du vocabulaire, le front ne le contraint pas) et `CommitteeDecision`
 * en ÉCRITURE (le front n'envoie que ce que `CommitteeVote.Decision` accepte).
 */

/** Les deux seuls sens de vote acceptés par `cast_vote` (`CommitteeVote.Decision`). */
export type CommitteeDecision = 'approve' | 'reject';

/** Un vote nominatif du procès-verbal — append-only côté serveur (principe 3). */
export interface CommitteeVoteEntry {
  /** `voter_sub` : identifiant IdP du votant. Le backend ne résout pas de nom ici. */
  voter: string;
  decision: string;
  /** Motif obligatoire : `cast_vote` refuse un commentaire vide (422). */
  comment: string;
  /** `conditions or None` côté serveur → jamais `''`, mais `null`. */
  conditions: string | null;
  votedAt: string;
}

/** `GET /api/credits/applications/<code>/committee-votes/`. */
export interface CommitteeVotesSummary {
  applicationCode: string;
  /** Quorum lu d'`InstitutionConfig` (principe 8), avec repli loggé côté serveur. */
  quorum: number;
  requiresCommittee: boolean;
  thresholdUsd: number;
  votes: CommitteeVoteEntry[];
  tally: { approve: number; reject: number };
  resolved: boolean;
  decision: string | null;
}

/** `POST /api/credits/applications/<code>/committee-vote/` (201). */
export interface CommitteeVoteResult {
  vote: CommitteeVoteEntry;
  tally: { approve: number; reject: number };
  quorum: number;
  resolved: boolean;
  decision: string | null;
}

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
 * `CreditAnalyse` est ce que l'écran lit, rien de plus. Aucun seuil, aucune
 * pondération n'est recopié côté front (principes 7 et 8).
 */
export interface CommitteeMoteur {
  scoreGlobal: number;
  scoreLettre: string;
  recommandation: string;
  dscr: number | null;
  dscrStress: number | null;
  executeLe: string;
}

/** État de chargement de l'analyse d'un dossier — « absente » n'est pas une panne. */
export type MoteurEntry =
  | { state: 'loading' }
  | { state: 'ok'; data: CommitteeMoteur }
  | { state: 'absent'; message: string }
  | { state: 'error'; message: string };

/** Code du 404 « aucune analyse exécutée » (`views.analyse_detail`). */
export const ANALYSE_ABSENTE = 'ANALYSE_ABSENTE';
