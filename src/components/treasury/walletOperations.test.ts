/**
 * Règles de saisie des mouvements de portefeuille.
 *
 * Ce qui se joue ici n'est pas de l'ergonomie : chacune de ces règles empêche
 * un mouvement d'argent erroné de partir. Le solde se contrôle DANS la devise
 * demandée (un solde USD ne finance pas un retrait CDF), et un change sans taux
 * servi ne part pas — parce qu'un taux que le serveur n'a pas fixé n'existe pas.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_AMOUNT_FORM,
  EMPTY_FX_FORM,
  WALLET_CURRENCIES,
  balanceOf,
  fxRateLabel,
  validateDeposit,
  validateFx,
  validateWithdraw,
  type AmountFormState,
  type FxFormState,
  type WalletBalances,
} from '@/components/treasury/walletOperations';

const balances: WalletBalances = { usd: 500, cdf: 1_400_000 };

function depositForm(over: Partial<AmountFormState> = {}): AmountFormState {
  return { ...EMPTY_AMOUNT_FORM, amount: '100', phone: '+243900000000', ...over };
}

function fxForm(over: Partial<FxFormState> = {}): FxFormState {
  return { ...EMPTY_FX_FORM, amount: '100', ...over };
}

describe('devises du portefeuille', () => {
  it('ne connaît que celles du serveur, et les propose toutes', () => {
    expect([...WALLET_CURRENCIES]).toEqual(['USD', 'CDF']);
  });

  it('lit le solde de LA devise demandée, jamais un cumul', () => {
    expect(balanceOf(balances, 'USD')).toBe(500);
    expect(balanceOf(balances, 'CDF')).toBe(1_400_000);
  });
});

describe('validateDeposit', () => {
  it('accepte un dépôt complet', () => {
    expect(validateDeposit(depositForm())).toEqual({});
  });

  it('refuse un montant absent, nul ou négatif', () => {
    expect(validateDeposit(depositForm({ amount: '' })).amount).toBe('Montant invalide');
    expect(validateDeposit(depositForm({ amount: '0' })).amount).toBe('Montant invalide');
    expect(validateDeposit(depositForm({ amount: '-10' })).amount).toBe('Montant invalide');
  });

  it('exige le numéro quand l’argent transite par mobile money', () => {
    expect(validateDeposit(depositForm({ phone: '' })).phone).toBe('Numéro requis');
  });

  it('ne l’exige pas pour un virement bancaire', () => {
    expect(validateDeposit(depositForm({ method: 'bank_transfer', phone: '' }))).toEqual({});
  });

  it('n’impose aucune devise par défaut au-delà de la saisie : les deux passent', () => {
    expect(validateDeposit(depositForm({ currency: 'USD' }))).toEqual({});
    expect(validateDeposit(depositForm({ currency: 'CDF' }))).toEqual({});
  });
});

describe('validateWithdraw', () => {
  it('accepte un retrait couvert par le solde de sa devise', () => {
    expect(validateWithdraw(depositForm({ amount: '400' }), balances)).toEqual({});
  });

  it('refuse un retrait au-dessus du solde de SA devise', () => {
    expect(validateWithdraw(depositForm({ amount: '600' }), balances).amount).toBe('Solde insuffisant');
  });

  /**
   * Le cœur du défaut corrigé : 600 est refusé en USD (solde 500) et accepté en
   * CDF (solde 1 400 000). Un formulaire qui code la devise en dur transforme
   * ce contrôle en loterie.
   */
  it('juge le même montant différemment selon la devise choisie', () => {
    expect(validateWithdraw(depositForm({ amount: '600', currency: 'USD' }), balances).amount)
      .toBe('Solde insuffisant');
    expect(validateWithdraw(depositForm({ amount: '600', currency: 'CDF' }), balances)).toEqual({});
  });

  it('signale d’abord un montant invalide avant de parler de solde', () => {
    expect(validateWithdraw(depositForm({ amount: '' }), balances).amount).toBe('Montant invalide');
  });
});

describe('validateFx', () => {
  it('accepte une conversion couverte et cotée par le serveur', () => {
    expect(validateFx(fxForm(), balances, 285_000)).toEqual({});
  });

  it('refuse un montant absent', () => {
    expect(validateFx(fxForm({ amount: '' }), balances, 285_000).fxAmount).toBe('Montant requis');
  });

  it('refuse au-dessus du solde de la devise source', () => {
    expect(validateFx(fxForm({ amount: '900' }), balances, 1).fxAmount)
      .toBe('Solde insuffisant pour la conversion');
  });

  it('refuse quand le serveur n’a coté aucun taux — jamais de repli local', () => {
    expect(validateFx(fxForm(), balances, null).fxAmount)
      .toBe('Aucun taux de change configuré pour cette paire.');
  });
});

describe('fxRateLabel', () => {
  it('restitue le taux SERVI, exprimé pour une unité', () => {
    expect(fxRateLabel(fxForm({ amount: '100' }), 285_000))
      .toBe('Taux appliqué : 1 USD = 2850.0000 CDF');
  });

  it('dit qu’aucun taux n’est configuré plutôt que d’en inventer un', () => {
    expect(fxRateLabel(fxForm(), null))
      .toBe('Aucun taux configuré pour cette paire — contactez un gestionnaire.');
    expect(fxRateLabel(fxForm({ amount: '' }), 285_000))
      .toBe('Aucun taux configuré pour cette paire — contactez un gestionnaire.');
    expect(fxRateLabel(fxForm({ amount: '0' }), 0))
      .toBe('Aucun taux configuré pour cette paire — contactez un gestionnaire.');
  });
});
