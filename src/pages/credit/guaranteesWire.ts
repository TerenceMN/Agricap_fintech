/**
 * Formes et libellés du suivi des garanties (§7.1 point 7).
 *
 * Pourquoi un fichier à part de `src/types/api.ts` : le type partagé
 * `CreditGuaranteeItem` décrit l'état du contrat AVANT le lot « consentement
 * opposable ». Il déclare `status: 'pending' | 'active' | 'released' | 'expired'`
 * alors que `credits.models.CreditGuarantee.Status` en compte huit, et il ignore
 * les six champs de consentement que `guarantees.get_guarantee_summary` sert
 * désormais (`consentExpiresAt`, `consentedAt`, `declinedAt`, `consentChannel`,
 * `isConsentExpired`, `retainedCoverage`). Ce fichier décrit la forme RÉELLEMENT
 * servie, relue ligne à ligne dans `backend/credits/guarantees.py`.
 *
 * `src/types/api.ts` appartient à un autre agent ; dès que le type partagé aura
 * rattrapé le backend, ces déclarations disparaissent au profit de lui.
 *
 * Aucune fonction d'ici ne calcule un chiffre métier : elles SÉLECTIONNENT le
 * champ que le serveur a déjà arrêté (principe 9 — jamais la valeur déclarée) et
 * mettent en forme. Le formatage des montants passe par le formateur unique
 * `src/components/guarantees/format.js`.
 */

// ── Statuts et types canoniques (miroir de `CreditGuarantee`) ─────────────────

/** Les huit statuts de `CreditGuarantee.Status`. */
export type GuaranteeStatus =
  | 'pending'
  | 'pending_consent'
  | 'consented'
  | 'declined'
  | 'active'
  | 'released'
  | 'expired'
  | 'called';

/** Les quatre types canoniques de `CreditGuarantee.GuaranteeType`. */
export type GuaranteeTypeCode = 'epargne' | 'morale' | 'materiel' | 'foncier';

export interface WireGuaranteeAsset {
  id: number;
  name: string;
  category: string;
  /** Valeur déclarée par le client — ne couvre RIEN (principe 9). */
  declaredValue: number;
  /** Valeur retenue après décote, fixée par l'agent : la seule opposable. */
  retainedValue: number | null;
  currency: string;
  status: string;
  verifiedAt: string | null;
}

/** Une ligne de `guarantees.items` telle que `get_guarantee_summary` la sert. */
export interface WireGuaranteeItem {
  id: number;
  type: GuaranteeTypeCode;
  status: GuaranteeStatus;
  coveredAmount: number | null;
  createdAt: string;

  // Gage sur actif (materiel / foncier)
  asset?: WireGuaranteeAsset;

  // Nantissement épargne
  holdAmount?: number;
  holdCurrency?: string;
  holdReference?: string;
  holdPlacedAt?: string | null;
  holdReleasedAt?: string | null;
  availableBalance?: number | null;

  // Caution solidaire (morale)
  guarantorName?: string;
  guarantorPhone?: string;
  guarantorIdNumber?: string;
  guarantorSub?: string | null;
  confirmedAt?: string | null;
  expiresAt?: string | null;
  isExpired?: boolean;
  consentExpiresAt?: string | null;
  isConsentExpired?: boolean;
  consentedAt?: string | null;
  declinedAt?: string | null;
  consentChannel?: string | null;
  /** Contribution réelle à la couverture APRÈS décote de caution — calculée
   *  serveur (`CreditGuarantee.retained_coverage`), jamais ici. */
  retainedCoverage?: number;
  daysLeft?: number | null;
}

export interface WireGuaranteeCoverage {
  retainedTotal: number;
  currency: string;
  requestedAmount: number | null;
  ratio: number | null;
  activeCount: number;
}

export interface WireGuaranteeSet {
  count: number;
  guaranteeType: GuaranteeTypeCode | null;
  items: WireGuaranteeItem[];
  coverage?: WireGuaranteeCoverage;
}

/** Une garantie replacée dans son dossier — l'unité de travail de l'écran. */
export interface GuaranteeRow {
  guarantee: WireGuaranteeItem;
  applicationCode: string;
  applicationStatus: string;
  applicationCurrency: string;
  clientName: string;
  valueChainLabel: string | null;
  /** Le `coverage` du dossier, pour ne jamais recomposer un total côté client. */
  coverage?: WireGuaranteeCoverage;
}

/** `credits.views.list_applications` sert `qs.order_by("-created_at")[:100]`
 *  sans `total_rows`. Toute liste construite dessus est donc potentiellement
 *  amputée — l'écran doit le dire plutôt que de laisser croire à l'exhaustivité. */
export const APPLICATIONS_CAP = 100;

// ── Libellés de statut ────────────────────────────────────────────────────────

export const GUARANTEE_STATUS_META: Record<GuaranteeStatus, { label: string; className: string }> = {
  pending: {
    label: 'En attente de confirmation',
    className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  pending_consent: {
    label: 'En attente du consentement du garant',
    className: 'bg-orange-500/15 text-orange-200 border-orange-500/40',
  },
  consented: {
    label: 'Consentie par le garant',
    className: 'bg-sky-500/15 text-sky-200 border-sky-500/30',
  },
  declined: {
    label: 'Refusée par le garant',
    className: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  },
  active: {
    label: 'Constituée',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  released: {
    label: 'Levée / libérée',
    className: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
  },
  expired: {
    label: 'Expirée (délai dépassé)',
    className: 'bg-red-500/15 text-red-300 border-red-500/30',
  },
  called: {
    label: 'Appelée (défaut du débiteur)',
    className: 'bg-red-600/25 text-red-200 border-red-500/50',
  },
};

export function statusMeta(status: string): { label: string; className: string } {
  return (
    GUARANTEE_STATUS_META[status as GuaranteeStatus]
    ?? { label: status, className: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }
  );
}

// ── Montant opposable ─────────────────────────────────────────────────────────

/**
 * Le montant qui compte : celui RETENU par le serveur, jamais celui déclaré.
 *
 * La sélection dépend du type parce que le backend range la valeur retenue dans
 * trois champs distincts — ce n'est pas un choix du front :
 *   - `morale`   → `retainedCoverage`, le nominal APRÈS décote de caution
 *                  (`CreditGuarantee.retained_coverage`, poids en base) ;
 *   - `materiel` / `foncier` → `asset.retainedValue`, fixée par l'agent à la
 *                  vérification, décote institutionnelle déjà appliquée ;
 *   - `epargne`  → `holdAmount`, montant effectivement bloqué (pas de décote :
 *                  c'est du cash immobilisé, pas un bien à réaliser).
 *
 * Aucune arithmétique ici. `null` signifie « le serveur n'a pas encore arrêté de
 * montant retenu » — l'écran l'affiche comme tel, il ne retombe JAMAIS sur la
 * valeur déclarée.
 */
export function retainedAmountOf(row: GuaranteeRow): {
  value: number | null;
  currency: string;
  basis: string;
} {
  const g = row.guarantee;
  if (g.type === 'morale') {
    return {
      value: g.retainedCoverage ?? null,
      currency: row.coverage?.currency || row.applicationCurrency,
      basis: 'nominal de la caution après décote (calcul serveur)',
    };
  }
  if (g.type === 'epargne') {
    return {
      value: g.holdAmount ?? null,
      currency: g.holdCurrency || row.applicationCurrency,
      basis: 'montant bloqué sur le plan d’épargne',
    };
  }
  return {
    value: g.asset?.retainedValue ?? null,
    currency: g.asset?.currency || row.applicationCurrency,
    basis: 'valeur retenue de l’actif après décote (fixée par l’agent)',
  };
}

/** Valeur DÉCLARÉE d'un gage, à n'afficher qu'explicitement libellée comme telle. */
export function declaredAmountOf(row: GuaranteeRow): { value: number | null; currency: string } {
  const a = row.guarantee.asset;
  return {
    value: a?.declaredValue ?? null,
    currency: a?.currency || row.applicationCurrency,
  };
}

// ── Files de travail ──────────────────────────────────────────────────────────

export type QueueId = 'consent' | 'confirm' | 'release' | 'called' | 'closed';

/**
 * Rangement d'une garantie dans une file, par STATUT SERVEUR uniquement.
 *
 * Rien n'est déduit d'une date : une caution dont la fenêtre est écoulée reste
 * dans « en attente de consentement » tant que le serveur la sert en
 * `pending_consent` (il n'y a pas d'ordonnanceur permanent — cf.
 * `expire_pending_moral_guarantees`, tâche périodique). Le compte à rebours
 * signale l'échéance, il ne reclasse pas la ligne : l'horloge du navigateur
 * n'est pas une source de vérité.
 */
export function queueOf(status: string): QueueId {
  switch (status) {
    case 'pending_consent':
      return 'consent';
    case 'consented':
    case 'pending':
      return 'confirm';
    case 'active':
    case 'released':
      return 'release';
    case 'called':
      return 'called';
    default:
      return 'closed';
  }
}

export const QUEUES: Array<{ id: QueueId; label: string; hint: string }> = [
  {
    id: 'consent',
    label: 'En attente de consentement',
    hint: 'Cautions désignées dont le garant n’a pas encore répondu. Sans son accord horodaté, la caution n’est opposable à personne.',
  },
  {
    id: 'confirm',
    label: 'À confirmer',
    hint: 'Cautions consenties par le garant et gages en attente : elles ne comptent dans aucune couverture tant qu’un agent ne les a pas constituées.',
  },
  {
    id: 'release',
    label: 'Constituées et libérations',
    hint: 'Garanties opposables aujourd’hui, et trace des libérations déjà prononcées.',
  },
  {
    id: 'called',
    label: 'Cautions appelées',
    hint: 'Garanties appelées à la suite d’un défaut du débiteur.',
  },
  {
    id: 'closed',
    label: 'Sans suite',
    hint: 'Refus du garant et fenêtres expirées — conservés, jamais supprimés (principe 3).',
  },
];

// ── Autorisation d'affichage des actions ──────────────────────────────────────

/**
 * Miroir de `backend/credits/roles.py::CAN_INSTRUCT`.
 *
 * `confirm` et `release` sont gardés serveur par `_require_group(request,
 * CAN_INSTRUCT)`. Contrairement aux transitions de dossier, le backend n'expose
 * AUCUN équivalent d'`availableActions` pour les garanties : il n'existe pas de
 * champ à lire, donc l'écran ne peut que refléter la règle. Deux conséquences
 * assumées et signalées :
 *   - c'est un miroir, donc une dette : si `CAN_INSTRUCT` change côté serveur
 *     sans qu'on touche ici, l'écran proposera (ou masquera) un bouton à tort —
 *     le serveur, lui, restera juste ;
 *   - le serveur re-vérifie systématiquement, et un 403 est affiché tel quel.
 *     Masquer un bouton est une politesse, jamais une sécurité.
 */
const CAN_INSTRUCT_ROLES: ReadonlySet<string> = new Set([
  // FIELD_AGENT_ROLES
  'agent_terrain', 'agent_cash',
  // CREDIT_OFFICER_ROLES
  'gest_credit', 'gest_port', 'manager',
  // BRANCH_ROLES
  'gest_zone',
  // DIRECTION_ROLES
  'dg', 'dir_ops',
  // SUPERADMIN_ROLES
  'admin',
]);

export function canInstruct(roleId: string | null | undefined): boolean {
  return Boolean(roleId && CAN_INSTRUCT_ROLES.has(roleId));
}
