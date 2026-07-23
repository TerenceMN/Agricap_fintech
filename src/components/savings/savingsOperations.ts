/**
 * Logique PURE des mouvements d'épargne — saisie, récapitulatif, refus serveur.
 *
 * Pourquoi un module `.ts` et non du code dans `Savings.jsx` : `tsconfig` porte
 * `checkJs: false`, donc une faute dans un `.jsx` ne se voit ni à la compilation
 * ni au build — elle attend le clic du client. Tout ce qui est vérifiable
 * (validation, formatage du récapitulatif, dépliage des refus) vit donc ici et
 * est testé ; les `.jsx` du dossier ne font plus que rendre ces sorties.
 *
 * Ce module ne réutilise PAS `treasury/walletOperations` et ce n'est pas un
 * oubli : le dépôt d'épargne vise un plan (`/savings/plans/{id}/deposit`), ne
 * porte pas de devise dans son corps — c'est celle du plan, servie par le
 * serveur — et connaît des canaux qui n'existent pas en trésorerie
 * (`agent`). Forcer le partage aurait obligé à inventer une devise côté client,
 * soit exactement le défaut que ce chantier corrige ailleurs.
 *
 * Règle tenue ici sans exception : AUCUN chiffre métier n'est fabriqué. Le
 * récapitulatif ne montre que ce que le client a saisi et ce que le serveur a
 * déjà servi. Pas de solde projeté, pas d'intérêt estimé, pas de frais — les
 * afficher voudrait dire les calculer.
 */
import { toFieldErrors, type FieldError } from '@/components/backoffice/States';

/**
 * Canaux de dépôt d'épargne. Miroir de `SavingsPlan.Channel` côté serveur,
 * moins `wallet` qui n'est pas proposé au client sur cet écran.
 */
export type SavingsChannel = 'agent' | 'mobile_money' | 'bank';

export const SAVINGS_CHANNELS: readonly { id: SavingsChannel; label: string }[] = [
  { id: 'agent', label: 'Agent Agricap' },
  { id: 'mobile_money', label: 'Mobile Money' },
  { id: 'bank', label: 'Compte Bancaire' },
] as const;

/** Libellé d'un canal. Un code inconnu se montre tel quel — jamais deviné. */
export function savingsChannelLabel(channel: string): string {
  return SAVINGS_CHANNELS.find((c) => c.id === channel)?.label ?? channel;
}

/** Canaux qui transitent par un tiers : la référence de transaction y est la
 *  seule trace opposable du versement. */
export function channelRequiresReference(channel: string): boolean {
  return channel === 'mobile_money' || channel === 'bank';
}

/** Plan d'épargne tel que servi par `GET /savings/plans/mine`. Tous les champs
 *  sont optionnels côté typage : le module doit se comporter correctement face à
 *  une réponse incomplète plutôt que de supposer. */
export interface SavingsPlanRef {
  id: number | string;
  name?: string | null;
  currency?: string | null;
  objectiveType?: string | null;
}

export interface SavingsDepositForm {
  amount: string;
  channel: SavingsChannel;
  reference: string;
  note: string;
  agreed: boolean;
}

export const EMPTY_SAVINGS_DEPOSIT_FORM: SavingsDepositForm = {
  amount: '',
  channel: 'mobile_money',
  reference: '',
  note: '',
  agreed: false,
};

/** Erreurs de saisie indexées par champ (`amount`, `reference`, `currency`, `agreed`). */
export type FieldErrors = Record<string, string>;

/**
 * Devise DU PLAN, lue du serveur. `null` quand le serveur ne l'a pas servie :
 * on ne retombe jamais sur « USD », parce qu'un dépôt libellé dans une devise
 * supposée change le montant crédité sans que personne ne le voie.
 */
export function planCurrency(plan: SavingsPlanRef | null | undefined): string | null {
  const currency = plan?.currency;
  if (typeof currency !== 'string' || currency.trim() === '') return null;
  return currency.trim().toUpperCase();
}

/** Nom du plan visé, tel qu'il sera redit au client. À défaut de nom, son
 *  identifiant — pour qu'il reste possible de reconnaître la ligne visée. */
export function planLabel(plan: SavingsPlanRef | null | undefined): string {
  const name = plan?.name;
  if (typeof name === 'string' && name.trim() !== '') return name.trim();
  if (plan?.id === undefined || plan?.id === null) return 'Plan inconnu';
  return `Plan n° ${plan.id}`;
}

/**
 * Montant affiché : séparateurs fr-FR, deux décimales, devise accolée.
 *
 * Deux décimales et non zéro : `formatCurrency` de `src/lib/utils.js` arrondit
 * les USD à l'unité, ce qui est acceptable sur un tableau de bord mais pas sur
 * l'écran où le client valide un versement — 100,50 y deviendrait « 101 $ ».
 */
export function formatSavingsAmount(amount: number, currency: string | null): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const formatted = value.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${formatted} ${currency}` : `${formatted} (devise inconnue)`;
}

/**
 * Contrôles de saisie d'un dépôt.
 *
 * La devise est traitée comme une condition de départ, pas comme un champ : si
 * le serveur ne l'a pas servie, le dépôt ne part pas. C'est volontairement plus
 * strict qu'un avertissement — le client ne peut pas arbitrer sur une devise
 * qu'on ne sait pas lui nommer.
 */
export function validateSavingsDeposit(
  form: SavingsDepositForm,
  plan: SavingsPlanRef | null | undefined,
): FieldErrors {
  const errors: FieldErrors = {};
  const amount = parseFloat(form.amount);
  if (!form.amount || !Number.isFinite(amount) || amount <= 0) {
    errors.amount = 'Montant invalide';
  }
  if (channelRequiresReference(form.channel) && !form.reference.trim()) {
    errors.reference = 'Référence de transaction requise';
  }
  if (planCurrency(plan) === null) {
    errors.currency = "Devise du plan non servie par le serveur — rechargez la page avant de déposer.";
  }
  if (!form.agreed) {
    errors.agreed = "Confirmez l'exactitude des informations";
  }
  return errors;
}

/** Une ligne du récapitulatif : ce qui engage, et rien d'autre. */
export interface SummaryLine {
  label: string;
  value: string;
  /** Mise en avant du montant, qui est la faute de frappe la plus coûteuse. */
  emphasis?: boolean;
}

/** Dépôt en attente de confirmation : montant NUMÉRIQUE pour l'appel API,
 *  lignes déjà formatées pour l'affichage. */
export interface PendingSavingsDeposit {
  planId: number | string;
  amount: number;
  channel: SavingsChannel;
  reference: string;
  note: string;
  currency: string | null;
  lines: SummaryLine[];
}

/**
 * Récapitulatif du dépôt : le plan NOMMÉMENT, le montant avec la devise DU
 * PLAN, le canal. Trois choses qu'un client qui s'est trompé de ligne ou de
 * virgule doit pouvoir reconnaître d'un coup d'œil.
 */
export function buildSavingsDeposit(
  form: SavingsDepositForm,
  plan: SavingsPlanRef | null | undefined,
): PendingSavingsDeposit | null {
  if (!plan || plan.id === undefined || plan.id === null) return null;
  const amount = parseFloat(form.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currency = planCurrency(plan);

  const lines: SummaryLine[] = [
    { label: "Plan d'épargne crédité", value: planLabel(plan) },
    { label: 'Montant du dépôt', value: formatSavingsAmount(amount, currency), emphasis: true },
    { label: 'Canal de dépôt', value: savingsChannelLabel(form.channel) },
  ];
  if (form.reference.trim()) {
    lines.push({ label: 'Référence de transaction', value: form.reference.trim() });
  }
  if (form.note.trim()) {
    lines.push({ label: 'Note', value: form.note.trim() });
  }
  return {
    planId: plan.id,
    amount,
    channel: form.channel,
    reference: form.reference.trim(),
    note: form.note.trim(),
    currency,
    lines,
  };
}

/* ────────────────────────── Actions d'administration ────────────────────────── */

/** Groupe d'épargne tel que servi par `GET /savings/groups`. */
export interface SavingsGroupRef {
  id: number | string;
  name?: string | null;
  type?: string | null;
  membersCount?: number | null;
  members?: unknown[] | null;
  balance?: number | null;
}

/** Demande d'intégration telle que servie par `GET /savings/requests`. */
export interface GroupRequestRef {
  id: number | string;
  groupName?: string | null;
  userName?: string | null;
  reason?: string | null;
}

/** Effectif d'un groupe : `membersCount` servi, à défaut la longueur de la
 *  liste servie. Aucune estimation quand ni l'un ni l'autre n'existe. */
export function groupMemberCount(group: SavingsGroupRef | null | undefined): number | null {
  if (typeof group?.membersCount === 'number') return group.membersCount;
  if (Array.isArray(group?.members)) return group.members.length;
  return null;
}

/**
 * Récapitulatif d'une suppression de groupe.
 *
 * `window.confirm('Êtes-vous sûr ?')` ne nommait ni le groupe, ni ses membres,
 * ni son solde : l'administrateur confirmait une phrase, pas une opération. La
 * suppression casse en cascade les adhésions et les demandes d'intégration ;
 * elle mérite d'être lue avant d'être signée.
 */
export function buildGroupDeletionSummary(group: SavingsGroupRef): SummaryLine[] {
  const lines: SummaryLine[] = [
    { label: 'Groupe supprimé', value: group.name?.trim() || `Groupe n° ${group.id}`, emphasis: true },
  ];
  if (group.type) lines.push({ label: 'Type', value: String(group.type) });
  const members = groupMemberCount(group);
  if (members !== null) {
    lines.push({ label: 'Adhésions rompues', value: `${members} membre(s)` });
  }
  return lines;
}

export type GroupDecision = 'approved' | 'rejected';

export function groupDecisionLabel(decision: GroupDecision): string {
  return decision === 'approved' ? 'Approbation' : 'Rejet';
}

/**
 * Récapitulatif d'une décision sur une demande d'adhésion. Une approbation crée
 * une adhésion, un rejet ferme la demande : dans les deux cas le statut ne se
 * rouvre pas côté serveur, donc les deux se confirment.
 */
export function buildGroupDecisionSummary(
  req: GroupRequestRef,
  decision: GroupDecision,
): SummaryLine[] {
  const lines: SummaryLine[] = [
    { label: 'Décision', value: groupDecisionLabel(decision), emphasis: true },
    { label: 'Demandeur', value: req.userName?.trim() || `Demande n° ${req.id}` },
    { label: 'Groupe', value: req.groupName?.trim() || '—' },
  ];
  if (req.reason?.trim()) lines.push({ label: 'Motif invoqué', value: req.reason.trim() });
  return lines;
}

/**
 * Déplie un refus serveur en liste `{code, message}`.
 *
 * Un 422 porte le plus souvent PLUSIEURS causes ; les aplatir en une phrase
 * unique fait disparaître celles que l'utilisateur devait corriger. On réutilise
 * `toFieldErrors` du backoffice plutôt que d'ouvrir une deuxième façon d'écrire
 * la même chose.
 */
export function savingsOperationErrors(err: unknown): FieldError[] {
  return toFieldErrors(err);
}
