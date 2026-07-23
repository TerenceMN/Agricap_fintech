/**
 * Ce que ces tests protègent tient en une phrase, et elle vaut de l'argent :
 * **un ordre indéterminé ne se rejoue jamais.** Le reste (qui peut faire quoi,
 * selon sa capacité et le statut) découle de cette règle et est verrouillé ici.
 */
import { describe, expect, it } from 'vitest';
import {
  availableActions, isOpen, isTerminal, OPEN_STATUSES, type PaymentCaps,
} from '@/components/payments/paymentActions';

const FULL: PaymentCaps = { validate: true, staff: true };
const AUDITOR: PaymentCaps = { validate: false, staff: true };
const NOBODY: PaymentCaps = { validate: false, staff: false };

const ids = (status: string, caps: PaymentCaps) => availableActions(status, caps).map((a) => a.id);

describe('availableActions — la garantie critique', () => {
  it('n’offre AUCUN rejeu sur un ordre INDÉTERMINÉ, jamais', () => {
    const specs = availableActions('INDETERMINATE', FULL);
    // Seules la relecture (reconcile) et la clôture manuelle (forceSettle).
    expect(specs.map((s) => s.id).sort()).toEqual(['forceSettle', 'reconcile']);
    // Ni « send », ni « cancel » : rien qui réémette ou touche un ordre déjà parti.
    expect(specs.some((s) => s.id === 'send' || s.id === 'cancel')).toBe(false);
    // Et aucun libellé/aide ne suggère de « relancer / réessayer / rejouer ».
    const text = specs.map((s) => `${s.label} ${s.hint}`).join(' ').toLowerCase();
    expect(text).not.toMatch(/relanc|rejou|réessay|renvoy|retry/);
  });

  it('n’offre le rejeu-interdit (send) que sur un ordre jamais parti (PENDING)', () => {
    // `send` n'apparaît QUE sur PENDING.
    const withSend = (['PENDING', ...OPEN_STATUSES, 'CONFIRMED', 'REFUSED', 'CANCELLED'] as const)
      .filter((s) => ids(s, FULL).includes('send'));
    expect(withSend).toEqual(['PENDING']);
  });
});

describe('availableActions — par statut, avec pleine capacité', () => {
  it('PENDING : transmettre ou annuler', () => {
    expect(ids('PENDING', FULL).sort()).toEqual(['cancel', 'send']);
  });

  it('SENT et AWAITING_CONFIRMATION : réconcilier ou forcer, jamais rejouer', () => {
    expect(ids('SENT', FULL).sort()).toEqual(['forceSettle', 'reconcile']);
    expect(ids('AWAITING_CONFIRMATION', FULL).sort()).toEqual(['forceSettle', 'reconcile']);
  });

  it('CONFIRMED / REFUSED / CANCELLED : aucune action (terminal)', () => {
    expect(ids('CONFIRMED', FULL)).toEqual([]);
    expect(ids('REFUSED', FULL)).toEqual([]);
    expect(ids('CANCELLED', FULL)).toEqual([]);
  });

  it('un statut inconnu ne fabrique aucune action', () => {
    expect(ids('WAT', FULL)).toEqual([]);
  });
});

describe('availableActions — filtrage par capacité serveur (§7.2)', () => {
  it('un auditeur (sans validate) voit l’ordre mais AUCUN bouton de réconciliation', () => {
    expect(ids('INDETERMINATE', AUDITOR)).toEqual([]);
    expect(ids('SENT', AUDITOR)).toEqual([]);
  });

  it('sans capacité staff, un ordre PENDING n’offre ni envoi ni annulation', () => {
    expect(ids('PENDING', NOBODY)).toEqual([]);
  });

  it('la réconciliation et le règlement forcé exigent tous deux `validate`', () => {
    expect(ids('INDETERMINATE', FULL).sort()).toEqual(['forceSettle', 'reconcile']);
    expect(ids('INDETERMINATE', AUDITOR)).toEqual([]);
  });
});

describe('métadonnées des actions', () => {
  it('reconcile et forceSettle exigent un motif ; forceSettle exige en plus une issue', () => {
    const [reconcile, force] = availableActions('INDETERMINATE', FULL);
    // availableActions rend reconcile avant forceSettle.
    expect(reconcile.id).toBe('reconcile');
    expect(reconcile.requiresMotive).toBe(true);
    expect(reconcile.requiresOutcome).toBe(false);
    expect(force.id).toBe('forceSettle');
    expect(force.requiresMotive).toBe(true);
    expect(force.requiresOutcome).toBe(true);
  });
});

describe('helpers de statut', () => {
  it('isOpen ne couvre que les statuts en attente d’issue', () => {
    expect(isOpen('SENT')).toBe(true);
    expect(isOpen('AWAITING_CONFIRMATION')).toBe(true);
    expect(isOpen('INDETERMINATE')).toBe(true);
    expect(isOpen('PENDING')).toBe(false);
    expect(isOpen('CONFIRMED')).toBe(false);
  });

  it('isTerminal ne couvre que les statuts définitifs', () => {
    expect(isTerminal('CONFIRMED')).toBe(true);
    expect(isTerminal('REFUSED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('INDETERMINATE')).toBe(false);
  });
});
