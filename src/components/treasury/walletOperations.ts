/**
 * Logique PURE des mouvements de portefeuille (dépôt, retrait, change).
 *
 * Extraite de `ClientWallet.jsx`, qui portait jusqu'ici la seule implémentation
 * complète de ces trois opérations. Le doublon d'`InvestorBanking.jsx` appelait
 * le même endpoint avec la devise ÉCRITE EN DUR (`'USD'`) : un investisseur
 * déposant des francs congolais voyait son dépôt enregistré en dollars. Le
 * défaut n'était pas cosmétique — il changeait le montant crédité.
 *
 * Ce module ne contient que des fonctions déterministes : validation de saisie
 * et libellés. Aucun calcul métier n'y vit — en particulier AUCUN taux de
 * change : `fxRateLabel` se contente de restituer le taux que le serveur a déjà
 * appliqué (`/fx/convert`), il ne le fabrique pas.
 */
import { toFieldErrors, type FieldError } from '@/components/backoffice/States';

/** Devises du portefeuille. Le serveur est la référence ; le front n'en invente aucune. */
export type WalletCurrency = 'USD' | 'CDF';

export const WALLET_CURRENCIES: readonly WalletCurrency[] = ['USD', 'CDF'] as const;

/** Moyen de paiement du dépôt / compte de destination du retrait. */
export type WalletMethod = 'mobile_money' | 'bank_transfer';

/** Soldes servis par `/caisses/wallets/mine`, projetés par devise. */
export interface WalletBalances {
  usd: number;
  cdf: number;
}

/** Saisie d'un dépôt ou d'un retrait. */
export interface AmountFormState {
  amount: string;
  currency: WalletCurrency;
  method: WalletMethod;
  /** Numéro mobile money, ou coordonnées du compte de destination pour un retrait. */
  phone: string;
}

/** Saisie d'une conversion de devise. */
export interface FxFormState {
  from: WalletCurrency;
  to: WalletCurrency;
  amount: string;
}

export const EMPTY_AMOUNT_FORM: AmountFormState = {
  amount: '',
  currency: 'USD',
  method: 'mobile_money',
  phone: '',
};

export const EMPTY_FX_FORM: FxFormState = { from: 'USD', to: 'CDF', amount: '' };

/** Erreurs de saisie, indexées par champ (`amount`, `phone`, `fxAmount`). */
export type FieldErrors = Record<string, string>;

/** Solde disponible dans la devise choisie — jamais un cumul multi-devises. */
export function balanceOf(balances: WalletBalances, currency: WalletCurrency): number {
  return currency === 'USD' ? balances.usd : balances.cdf;
}

/**
 * Dépôt : montant strictement positif, et numéro exigé quand l'argent transite
 * par mobile money. La devise n'a pas de règle de validation — elle a une
 * exigence plus forte : elle doit être CHOISIE, jamais supposée.
 */
export function validateDeposit(form: AmountFormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.amount || parseFloat(form.amount) <= 0) errors.amount = 'Montant invalide';
  if (form.method === 'mobile_money' && !form.phone) errors.phone = 'Numéro requis';
  return errors;
}

/** Retrait : mêmes règles que le dépôt, plus le solde de LA devise demandée. */
export function validateWithdraw(form: AmountFormState, balances: WalletBalances): FieldErrors {
  const errors = validateDeposit(form);
  if (!errors.amount && parseFloat(form.amount) > balanceOf(balances, form.currency)) {
    errors.amount = 'Solde insuffisant';
  }
  return errors;
}

/**
 * Change : un aperçu absent n'est pas un détail d'affichage. Il signifie que le
 * serveur n'a pas de taux pour cette paire — convertir malgré tout reviendrait à
 * demander au serveur d'appliquer un taux que personne n'a fixé.
 */
export function validateFx(
  form: FxFormState,
  balances: WalletBalances,
  preview: number | null,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.amount || parseFloat(form.amount) <= 0) {
    errors.fxAmount = 'Montant requis';
    return errors;
  }
  if (parseFloat(form.amount) > balanceOf(balances, form.from)) {
    errors.fxAmount = 'Solde insuffisant pour la conversion';
    return errors;
  }
  if (preview === null) {
    errors.fxAmount = 'Aucun taux de change configuré pour cette paire.';
  }
  return errors;
}

/**
 * Taux RESTITUÉ, pas calculé : `preview` est le montant que le serveur a figé
 * pour ce montant et cette paire. On le divise par le montant saisi uniquement
 * pour l'exprimer « pour 1 unité », ce que le client lit plus facilement. Aucune
 * constante de taux ne doit jamais apparaître ici.
 */
export function fxRateLabel(form: FxFormState, preview: number | null): string {
  const amount = parseFloat(form.amount);
  if (preview === null || !form.amount || !Number.isFinite(amount) || amount <= 0) {
    return 'Aucun taux configuré pour cette paire — contactez un gestionnaire.';
  }
  return `Taux appliqué : 1 ${form.from} = ${(preview / amount).toFixed(4)} ${form.to}`;
}

/**
 * Déplie un refus serveur en liste `{code, message}`.
 *
 * Un 422 porte le plus souvent PLUSIEURS causes ; les aplatir en une phrase
 * unique fait disparaître celles que le client devait corriger. Réutilise
 * `toFieldErrors` du backoffice plutôt que d'ouvrir une seconde façon d'écrire
 * la même chose.
 */
export function walletOperationErrors(err: unknown): FieldError[] {
  return toFieldErrors(err);
}

/** Résumé d'une opération, tel que soumis à la confirmation du client. */
export interface PendingOperation {
  /** Libellé affiché ET repris dans le toast de succès : « Dépôt », « Retrait », « Change FX ». */
  label: string;
  amount: number;
  currency: WalletCurrency;
  /** Contrepartie d'un change, au taux figé par le serveur. `null` hors change. */
  received: { amount: number; currency: WalletCurrency } | null;
}
