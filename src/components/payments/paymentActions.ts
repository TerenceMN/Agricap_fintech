/**
 * QUELLES actions un agent peut poser sur un ordre de paiement — la logique la
 * plus sensible du back-office, isolée ici pour être testée hors de tout écran.
 *
 * Une seule idée gouverne ce module, et elle vaut de l'argent réel :
 *
 *   **Un ordre indéterminé ne se REJOUE jamais.** Entre « la requête est partie »
 *   et « l'issue est connue », l'opération a PU aboutir chez le fournisseur.
 *   Proposer « réessayer / relancer » sur un tel ordre, c'est risquer de payer
 *   deux fois. Les seules actions offertes sont donc :
 *     - RÉCONCILIER : relire le statut chez le fournisseur (on interroge, on
 *       n'ordonne pas) ;
 *     - RÈGLEMENT FORCÉ : trancher à la main sur preuve externe, en dernier recours.
 *   Aucune de ces deux ne réémet le paiement.
 *
 * `send` existe, mais UNIQUEMENT pour un ordre `PENDING` — un ordre qui n'est
 * jamais parti. Ce n'est pas un rejeu : le serveur refuse (409) tout second
 * envoi. Le tableau ci-dessous rend cette distinction impossible à confondre :
 * `send` n'apparaît que sur `PENDING`, et sur rien d'autre.
 *
 * Le serveur reste l'autorité (il re-vérifie chaque appel) ; ce module ne fait
 * que refléter à l'écran ce qu'il autorisera, capacité par capacité — pour qu'un
 * agent ne voie même pas un bouton qu'on lui refuserait (CLAUDE.md §7.2).
 */

/** Capacités de l'utilisateur courant, telles que servies par `GET /rbac/me`. */
export interface PaymentCaps {
  /** Réconcilier / forcer un règlement (`HasCapability("validate")`). */
  validate: boolean;
  /** Voir la file et agir sur un ordre `PENDING` (`validate || audit || config`). */
  staff: boolean;
}

export type PaymentActionId = 'send' | 'cancel' | 'reconcile' | 'forceSettle';

export interface PaymentActionSpec {
  id: PaymentActionId;
  label: string;
  /** Motif obligatoire côté serveur → champ requis avant l'appel. */
  requiresMotive: boolean;
  /**
   * `forceSettle` demande en plus l'issue imposée (CONFIRMED/REFUSED) ; les
   * autres non. Sert l'écran à décider s'il ouvre le sélecteur d'issue.
   */
  requiresOutcome: boolean;
  intent: 'default' | 'danger' | 'reconcile';
  /** Une phrase qui dit CE QUE FAIT l'action — jamais « relancer/réessayer ». */
  hint: string;
}

/**
 * Statuts d'un ordre qui appellent une réconciliation manuelle
 * (`PaymentOrder.OPEN_STATUSES` côté serveur). Un ordre ici a peut-être abouti :
 * on le relit, on ne le rejoue pas.
 */
export const OPEN_STATUSES = ['SENT', 'AWAITING_CONFIRMATION', 'INDETERMINATE'] as const;

/** Un ordre est-il en attente d'issue (donc réconciliable) ? */
export function isOpen(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

const RECONCILE: PaymentActionSpec = {
  id: 'reconcile',
  label: 'Réconcilier',
  requiresMotive: true,
  requiresOutcome: false,
  intent: 'reconcile',
  hint: 'Relire le statut de l’ordre chez le fournisseur et appliquer l’issue lue. '
    + 'N’envoie aucun nouveau paiement.',
};

const FORCE_SETTLE: PaymentActionSpec = {
  id: 'forceSettle',
  label: 'Règlement forcé',
  requiresMotive: true,
  requiresOutcome: true,
  intent: 'danger',
  hint: 'Trancher l’issue à la main sur preuve externe (relevé opérateur, confirmation '
    + 'écrite), quand la relecture de statut n’est pas disponible. Dernier recours.',
};

const SEND: PaymentActionSpec = {
  id: 'send',
  label: 'Transmettre au fournisseur',
  requiresMotive: false,
  requiresOutcome: false,
  intent: 'default',
  hint: 'Première expédition d’un ordre encore en préparation. Indisponible dès qu’un '
    + 'ordre est parti.',
};

const CANCEL: PaymentActionSpec = {
  id: 'cancel',
  label: 'Annuler',
  requiresMotive: true,
  requiresOutcome: false,
  intent: 'danger',
  hint: 'Annuler un ordre encore en préparation, avant tout envoi. Impossible une fois parti.',
};

/**
 * Les actions offertes pour un ordre, filtrées par les capacités de l'agent.
 *
 * Garanties structurelles (couvertes par les tests) :
 *  - `send` et `cancel` n'apparaissent QUE sur `PENDING` ;
 *  - un ordre ouvert (`SENT`/`AWAITING_CONFIRMATION`/`INDETERMINATE`) n'offre que
 *    `reconcile` et `forceSettle` — jamais de rejeu ;
 *  - un ordre terminal (`CONFIRMED`/`REFUSED`/`CANCELLED`) n'offre rien ;
 *  - `reconcile`/`forceSettle` exigent la capacité `validate` ; sans elle, un
 *    auditeur voit l'ordre et son journal, mais aucun bouton d'action.
 */
export function availableActions(status: string, caps: PaymentCaps): PaymentActionSpec[] {
  if (status === 'PENDING') {
    // Un ordre jamais parti : on peut l'expédier une première fois ou l'annuler.
    return caps.staff ? [SEND, CANCEL] : [];
  }
  if (isOpen(status)) {
    // Issue inconnue : relire ou trancher, JAMAIS réémettre. Réservé à `validate`.
    return caps.validate ? [RECONCILE, FORCE_SETTLE] : [];
  }
  // Statut terminal (ou inconnu) : plus aucune action monétaire.
  return [];
}

/**
 * Vrai si l'ordre ne peut plus rien produire — sert l'écran à griser la ligne
 * sans deviner : c'est l'absence d'action, pas un libellé, qui fait foi.
 */
export function isTerminal(status: string): boolean {
  return status === 'CONFIRMED' || status === 'REFUSED' || status === 'CANCELLED';
}
