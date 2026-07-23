/**
 * Discrimination de la réponse d'un dépôt, et lecture des statuts d'ordre de
 * paiement — la logique la plus sensible du portefeuille.
 *
 * Depuis que le wallet est la seule porte vers l'extérieur, un dépôt n'est plus
 * toujours instantané. Le serveur (`caisses`) répond de DEUX façons :
 *
 *   { kind: "movement", ... }        → dépôt INTERNE réglé (espèces/agence).
 *                                      L'argent est crédité : « Dépôt effectué ».
 *   { kind: "payment_order", status, awaitingReconciliation, ... }
 *                                    → dépôt EXTERNE (mobile money/banque) confié
 *                                      au fournisseur Makuta. L'argent N'EST PAS
 *                                      crédité tant que le fournisseur n'a pas
 *                                      confirmé : « En attente de confirmation ».
 *
 * Une seule règle gouverne ce module : ne JAMAIS annoncer « effectué » sans
 * preuve POSITIVE de règlement. Tout le reste — réponse ambiguë, forme
 * inattendue, ordre encore ouvert — se dit « en attente ». Un faux « argent
 * reçu » sur un paiement non confirmé est le pire mensonge qu'un wallet puisse
 * afficher ; ce module existe pour le rendre impossible.
 *
 * On ne branche JAMAIS sur du texte : la décision lit `kind`, `status` et
 * `awaitingReconciliation` (des codes stables), jamais le libellé `detail`
 * (qui, lui, n'est repris que pour l'AFFICHER tel que le serveur l'a formulé).
 */

/** Statuts serveur d'un ordre de paiement (nomenclature `PaymentOrder.Status`). */
export type PaymentStatus =
  | 'PENDING'
  | 'SENT'
  | 'AWAITING_CONFIRMATION'
  | 'INDETERMINATE'
  | 'CONFIRMED'
  | 'REFUSED'
  | 'CANCELLED';

const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'PENDING',
  'SENT',
  'AWAITING_CONFIRMATION',
  'INDETERMINATE',
  'CONFIRMED',
  'REFUSED',
  'CANCELLED',
] as const;

/** Tonalité d'affichage — pilote la couleur, jamais la décision « crédité ». */
export type OutcomeTone = 'success' | 'pending' | 'error';

/** Verdict d'un dépôt, prêt à afficher. `settled` est LE drapeau critique. */
export interface DepositOutcome {
  /** VRAI seulement si l'argent est crédité. Rien d'autre ne dit « effectué ». */
  settled: boolean;
  /** Nature reconnue de la réponse. `unknown` → traité comme NON réglé. */
  kind: 'movement' | 'payment_order' | 'unknown';
  status: PaymentStatus | null;
  /** Référence de l'ordre externe, pour que le client la retrouve au suivi. */
  reference: string | null;
  awaitingReconciliation: boolean;
  /** Issue inconnue : bandeau spécial, aucune relance proposée. */
  indeterminate: boolean;
  tone: OutcomeTone;
  title: string;
  description: string;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function readStatus(r: Record<string, unknown>): PaymentStatus | null {
  const s = r.status;
  return typeof s === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(s)
    ? (s as PaymentStatus)
    : null;
}

/**
 * Une réponse « sent l'ordre de paiement » dès qu'un SEUL de ses marqueurs
 * structurels est présent. Volontairement large : mieux vaut traiter un
 * mouvement réglé comme un ordre en attente (le client vérifie, l'argent EST là)
 * que l'inverse (le client dépense un argent qui n'est pas arrivé).
 */
function looksLikePaymentOrder(r: Record<string, unknown>): boolean {
  return (
    r.kind === 'payment_order'
    || typeof r.reference === 'string'
    || typeof r.awaitingReconciliation === 'boolean'
    || readStatus(r) !== null
  );
}

const PENDING_DEFAULT =
  'Votre dépôt a été transmis au fournisseur. Le solde ne sera crédité qu’après '
  + 'sa confirmation — il n’a pas encore changé.';

/**
 * Le seul point de décision « effectué vs en attente ». Accepte n'importe quelle
 * forme (`unknown`) parce que la réponse vient du réseau : une forme inattendue
 * ne doit pas produire un faux « crédité », elle doit retomber sur « en attente ».
 */
export function classifyDepositOutcome(result: unknown): DepositOutcome {
  const r = asRecord(result);
  const status = readStatus(r);
  const reference = typeof r.reference === 'string' ? r.reference : null;
  const awaitingReconciliation = r.awaitingReconciliation === true;
  const serverDetail = typeof r.detail === 'string' && r.detail ? r.detail : null;

  if (looksLikePaymentOrder(r)) {
    // Réglé UNIQUEMENT si le fournisseur a confirmé ET que plus rien n'appelle de
    // réconciliation. Toute autre combinaison reste « en attente ».
    if (status === 'CONFIRMED' && !awaitingReconciliation) {
      return {
        settled: true,
        kind: 'payment_order',
        status,
        reference,
        awaitingReconciliation: false,
        indeterminate: false,
        tone: 'success',
        title: 'Dépôt confirmé',
        description: serverDetail
          || 'Le fournisseur a confirmé le paiement — votre solde est crédité.',
      };
    }

    if (status === 'REFUSED') {
      return {
        settled: false,
        kind: 'payment_order',
        status,
        reference,
        awaitingReconciliation,
        indeterminate: false,
        tone: 'error',
        title: 'Dépôt refusé par le fournisseur',
        description: serverDetail
          || 'Le fournisseur a refusé le paiement. Aucun montant n’a été crédité.',
      };
    }

    const indeterminate = status === 'INDETERMINATE';
    return {
      settled: false,
      kind: 'payment_order',
      status,
      reference,
      awaitingReconciliation: awaitingReconciliation || indeterminate,
      indeterminate,
      tone: 'pending',
      title: 'En attente de confirmation du fournisseur',
      description: serverDetail || PENDING_DEFAULT,
    };
  }

  // Forme « mouvement » : dépôt interne réglé (espèces / agence).
  if (r.kind === 'movement' || r.movementId != null) {
    return {
      settled: true,
      kind: 'movement',
      status: null,
      reference: null,
      awaitingReconciliation: false,
      indeterminate: false,
      tone: 'success',
      title: 'Dépôt effectué',
      description: serverDetail || 'Votre dépôt a été crédité.',
    };
  }

  // Forme inattendue : jamais « effectué » sans preuve. On dit « en cours »
  // plutôt que de mentir sur un crédit.
  return {
    settled: false,
    kind: 'unknown',
    status,
    reference,
    awaitingReconciliation,
    indeterminate: status === 'INDETERMINATE',
    tone: 'pending',
    title: 'Dépôt en cours de traitement',
    description: serverDetail
      || 'Votre demande est enregistrée. Le solde sera mis à jour une fois l’opération traitée.',
  };
}

/** Présentation d'un statut d'ordre de paiement dans la vue de suivi. */
export interface PaymentStatusMeta {
  /** Libellé COURT pour un badge (le serveur, lui, sert une phrase complète). */
  label: string;
  tone: OutcomeTone | 'neutral';
  badgeClass: string;
  /** Issue pas encore connue : à suivre / réconcilier côté staff. */
  open: boolean;
  indeterminate: boolean;
  /** Plus aucune transition possible. */
  terminal: boolean;
}

const STATUS_META: Record<PaymentStatus, PaymentStatusMeta> = {
  PENDING: {
    label: 'En préparation',
    tone: 'pending',
    badgeClass: 'bg-slate-500/20 text-slate-300',
    open: false,
    indeterminate: false,
    terminal: false,
  },
  SENT: {
    label: 'Transmis au fournisseur',
    tone: 'pending',
    badgeClass: 'bg-blue-500/20 text-blue-300',
    open: true,
    indeterminate: false,
    terminal: false,
  },
  AWAITING_CONFIRMATION: {
    label: 'Attente de confirmation',
    tone: 'pending',
    badgeClass: 'bg-blue-500/20 text-blue-300',
    open: true,
    indeterminate: false,
    terminal: false,
  },
  INDETERMINATE: {
    label: 'Issue en cours de vérification',
    tone: 'error',
    badgeClass: 'bg-orange-500/20 text-orange-300',
    open: true,
    indeterminate: true,
    terminal: false,
  },
  CONFIRMED: {
    label: 'Confirmé',
    tone: 'success',
    badgeClass: 'bg-emerald-500/20 text-emerald-300',
    open: false,
    indeterminate: false,
    terminal: true,
  },
  REFUSED: {
    label: 'Refusé',
    tone: 'error',
    badgeClass: 'bg-red-500/20 text-red-300',
    open: false,
    indeterminate: false,
    terminal: true,
  },
  CANCELLED: {
    label: 'Annulé',
    tone: 'neutral',
    badgeClass: 'bg-slate-500/20 text-slate-400',
    open: false,
    indeterminate: false,
    terminal: true,
  },
};

const UNKNOWN_META: PaymentStatusMeta = {
  label: 'Statut inconnu',
  tone: 'neutral',
  badgeClass: 'bg-slate-500/20 text-slate-400',
  open: false,
  indeterminate: false,
  terminal: false,
};

/** Présentation d'un statut — jamais d'erreur sur un statut non répertorié. */
export function paymentStatusMeta(status: string | null | undefined): PaymentStatusMeta {
  if (status && Object.prototype.hasOwnProperty.call(STATUS_META, status)) {
    return STATUS_META[status as PaymentStatus];
  }
  return UNKNOWN_META;
}

/**
 * Sens de l'ordre, vu du CLIENT. `COLLECTION` = argent qui entre (dépôt),
 * `PAYOUT` = argent qui sort (retrait).
 */
export function directionLabel(direction: string | null | undefined): string {
  if (direction === 'COLLECTION') return 'Dépôt';
  if (direction === 'PAYOUT') return 'Retrait';
  return direction || '—';
}
