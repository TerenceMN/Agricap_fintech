/**
 * Le CONTRAT d'un dépôt externe, côté client — logique pure, testée hors écran.
 *
 * Depuis que le portefeuille est la seule porte vers l'extérieur, un dépôt par
 * Mobile Money ou banque devient un ORDRE D'ENCAISSEMENT confié à Makuta, et le
 * serveur impose deux exigences que le formulaire doit honorer AVANT d'envoyer,
 * sous peine de 422 :
 *
 *   1. **Le canal doit être connu du serveur.** Le formulaire propose « Mobile
 *      Money » et « Virement bancaire », dont les identifiants d'UI sont
 *      `mobile_money` et `bank_transfer`. Or le serveur ne connaît que
 *      `mobile_money` et `bank` (`caisses/channels.py`). Envoyer `bank_transfer`
 *      tel quel, c'est un 422 `unknown_channel` garanti. Ce module fait la
 *      traduction — une seule fois, ici, pas dispersée dans du JSX.
 *
 *   2. **Une contrepartie est obligatoire pour un canal externe** : le numéro
 *      Mobile Money ou le compte source. Le serveur refuse (422
 *      `counterparty_required`) un dépôt externe sans elle. Le formulaire la
 *      saisit, ce module la valide et l'assemble dans la requête.
 *
 * Aucune nomenclature n'est inventée : les codes de canal (`mobile_money`,
 * `bank`) sont ceux du serveur ; le front ne fait que mapper pour l'affichage
 * (principe 6).
 */

/** Moyen de paiement tel qu'identifié à l'écran (`AmountFields`). */
export type DepositMethod = 'mobile_money' | 'bank_transfer';

/** Canal tel que le SERVEUR le nomme (`caisses/channels.py`). */
export type DepositChannel = 'mobile_money' | 'bank';

/**
 * Traduit le moyen affiché en canal serveur. C'est CE mapping qui empêche le
 * 422 `unknown_channel` : `bank_transfer` (UI) → `bank` (serveur).
 */
export function channelForMethod(method: DepositMethod): DepositChannel {
  return method === 'bank_transfer' ? 'bank' : 'mobile_money';
}

/**
 * Tout dépôt de ce formulaire client transite par un tiers (Mobile Money /
 * banque) : les deux moyens sont externes, donc tous deux exigent une
 * contrepartie. La fonction reste explicite pour que l'ajout futur d'un canal
 * interne (espèces/agence) ne casse pas la règle en silence.
 */
export function isExternalMethod(method: DepositMethod): boolean {
  return method === 'mobile_money' || method === 'bank_transfer';
}

/** Libellé du champ contrepartie, adapté au moyen choisi. */
export function counterpartyLabel(method: DepositMethod): string {
  return method === 'bank_transfer'
    ? 'Compte source (numéro / IBAN)'
    : 'Numéro Mobile Money';
}

/** Aide de saisie du champ contrepartie, adaptée au moyen choisi. */
export function counterpartyPlaceholder(method: DepositMethod): string {
  return method === 'bank_transfer' ? 'Compte ou IBAN de la source' : '+243…';
}

/** Saisie minimale nécessaire pour composer la requête de dépôt. */
export interface DepositContractInput {
  method: DepositMethod;
  /** Contrepartie saisie (le champ `phone` d'`AmountFields` sert de support). */
  counterparty: string;
}

/** Erreurs de contrat, indexées par champ (`phone` porte la contrepartie). */
export type DepositContractErrors = Record<string, string>;

/**
 * Refuse un dépôt externe sans contrepartie — le même contrôle que le serveur,
 * mais AVANT le réseau, pour que le client corrige sur place plutôt que de lire
 * un 422. L'erreur est posée sur `phone`, le champ qui porte la contrepartie.
 */
export function counterpartyErrors(input: DepositContractInput): DepositContractErrors {
  const errors: DepositContractErrors = {};
  if (isExternalMethod(input.method) && !input.counterparty.trim()) {
    errors.phone = 'Contrepartie requise (numéro Mobile Money ou compte source).';
  }
  return errors;
}

/** Arguments du dépôt attendus par `api.caisses.wallets.deposit(...)`. */
export interface DepositArgs {
  amount: number;
  currency: string;
  channel: DepositChannel;
  counterparty: string;
}

/**
 * Assemble la requête de dépôt à partir d'un montant/devise déjà CONFIRMÉS et de
 * la saisie du moyen + contrepartie. Le canal y est traduit une bonne fois ; la
 * clé d'idempotence est ajoutée par le wrapper (`api.ts`), pas ici.
 */
export function buildDepositArgs(params: {
  amount: number;
  currency: string;
  method: DepositMethod;
  counterparty: string;
}): DepositArgs {
  return {
    amount: params.amount,
    currency: params.currency,
    channel: channelForMethod(params.method),
    counterparty: params.counterparty.trim(),
  };
}

/**
 * Lecture DÉFENSIVE du code d'un refus serveur, sans dépendre de `instanceof`
 * (le mock de test fournit sa propre classe d'erreur). Sert l'écran à réagir
 * spécifiquement aux 422 de contrat de dépôt.
 */
export function depositErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** Le refus porte-t-il sur une contrepartie manquante ? (422 `counterparty_required`) */
export function isCounterpartyRequired(err: unknown): boolean {
  return depositErrorCode(err) === 'counterparty_required';
}

/** Le refus porte-t-il sur un canal inconnu du serveur ? (422 `unknown_channel`) */
export function isUnknownChannel(err: unknown): boolean {
  return depositErrorCode(err) === 'unknown_channel';
}
