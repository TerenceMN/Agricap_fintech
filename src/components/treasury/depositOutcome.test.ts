/**
 * Le mensonge à ne jamais commettre : afficher « argent reçu » sur un paiement
 * non confirmé.
 *
 * Depuis que le dépôt externe passe par un ordre de paiement Makuta, la réponse
 * du serveur est discriminée : un `movement` est réglé, un `payment_order` ne
 * l'est qu'à `CONFIRMED`. Ces tests verrouillent la SEULE règle qui compte —
 * `settled` n'est vrai que sur preuve positive de crédit — et prouvent qu'un
 * `kind: "payment_order"` non confirmé ne produit jamais un message « effectué ».
 */
import { describe, expect, it } from 'vitest';
import {
  classifyDepositOutcome,
  directionLabel,
  paymentStatusMeta,
} from '@/components/treasury/depositOutcome';

describe('classifyDepositOutcome — dépôt interne (movement)', () => {
  it('un mouvement est réglé : « effectué »', () => {
    const out = classifyDepositOutcome({ kind: 'movement', detail: 'Dépôt effectué.', movementId: 42, amount: 150 });
    expect(out.settled).toBe(true);
    expect(out.kind).toBe('movement');
    expect(out.tone).toBe('success');
    expect(out.title).toContain('effectué');
  });

  it('reconnaît un mouvement même sans champ `kind`, par la présence de movementId', () => {
    // Forme servie AUJOURD'HUI par le backend (movement_row : pas encore de `kind`).
    const out = classifyDepositOutcome({ detail: 'Dépôt effectué.', movementId: 7, amount: 100 });
    expect(out.settled).toBe(true);
    expect(out.kind).toBe('movement');
  });
});

describe('classifyDepositOutcome — dépôt externe (payment_order)', () => {
  // ── LE test qui doit échouer si un ordre non confirmé passe pour « effectué ».
  it.each(['PENDING', 'SENT', 'AWAITING_CONFIRMATION', 'INDETERMINATE'])(
    'un ordre au statut %s N’EST PAS réglé et ne dit jamais « effectué »',
    (status) => {
      const out = classifyDepositOutcome({
        kind: 'payment_order',
        status,
        reference: 'PO-2026-0001',
        awaitingReconciliation: true,
        detail: 'Ordre transmis au fournisseur — réponse en attente.',
      });

      expect(out.settled).toBe(false);
      expect(out.tone).not.toBe('success');
      // Aucun mot de la famille « effectué / crédité / reçu » dans ce qui s'affiche.
      const shown = `${out.title} ${out.description}`.toLowerCase();
      expect(shown).not.toMatch(/effectu|crédit|reçu/);
      expect(out.title.toLowerCase()).toContain('attente');
      // La référence remonte pour que le client suive l'ordre.
      expect(out.reference).toBe('PO-2026-0001');
    },
  );

  it('un ordre CONFIRMED, réconciliation close, est réglé', () => {
    const out = classifyDepositOutcome({
      kind: 'payment_order',
      status: 'CONFIRMED',
      reference: 'PO-9',
      awaitingReconciliation: false,
    });
    expect(out.settled).toBe(true);
    expect(out.tone).toBe('success');
  });

  it('un CONFIRMED encore marqué awaitingReconciliation reste PRUDENT : non réglé', () => {
    const out = classifyDepositOutcome({
      kind: 'payment_order',
      status: 'CONFIRMED',
      awaitingReconciliation: true,
    });
    expect(out.settled).toBe(false);
  });

  it('INDETERMINATE lève le drapeau dédié (bandeau, aucune relance)', () => {
    const out = classifyDepositOutcome({ kind: 'payment_order', status: 'INDETERMINATE' });
    expect(out.settled).toBe(false);
    expect(out.indeterminate).toBe(true);
  });

  it('REFUSED n’est pas « effectué », et le dit sans ambiguïté', () => {
    const out = classifyDepositOutcome({ kind: 'payment_order', status: 'REFUSED' });
    expect(out.settled).toBe(false);
    expect(out.tone).toBe('error');
    expect(out.title.toLowerCase()).toContain('refus');
  });

  it('affiche le libellé SERVEUR quand il est fourni (jamais réécrit)', () => {
    const detail = 'Le fournisseur a accusé réception — issue pas encore connue.';
    const out = classifyDepositOutcome({ kind: 'payment_order', status: 'AWAITING_CONFIRMATION', detail });
    expect(out.description).toBe(detail);
  });

  it('reconnaît l’ordre par sa seule référence, même sans `kind`', () => {
    const out = classifyDepositOutcome({ reference: 'PO-42', status: 'SENT' });
    expect(out.kind).toBe('payment_order');
    expect(out.settled).toBe(false);
  });
});

describe('classifyDepositOutcome — formes ambiguës', () => {
  it('une réponse vide ne prétend JAMAIS « effectué »', () => {
    const out = classifyDepositOutcome({});
    expect(out.settled).toBe(false);
    expect(out.title.toLowerCase()).not.toContain('effectué');
  });

  it('null / undefined retombent sur « non réglé » sans planter', () => {
    expect(classifyDepositOutcome(null).settled).toBe(false);
    expect(classifyDepositOutcome(undefined).settled).toBe(false);
  });
});

describe('paymentStatusMeta — mapping des statuts', () => {
  it('marque comme ouverts les statuts à réconcilier', () => {
    expect(paymentStatusMeta('SENT').open).toBe(true);
    expect(paymentStatusMeta('AWAITING_CONFIRMATION').open).toBe(true);
    expect(paymentStatusMeta('INDETERMINATE').open).toBe(true);
  });

  it('isole l’état INDETERMINATE', () => {
    expect(paymentStatusMeta('INDETERMINATE').indeterminate).toBe(true);
    expect(paymentStatusMeta('SENT').indeterminate).toBe(false);
  });

  it('marque terminaux CONFIRMED, REFUSED, CANCELLED', () => {
    expect(paymentStatusMeta('CONFIRMED').terminal).toBe(true);
    expect(paymentStatusMeta('REFUSED').terminal).toBe(true);
    expect(paymentStatusMeta('CANCELLED').terminal).toBe(true);
    expect(paymentStatusMeta('SENT').terminal).toBe(false);
  });

  it('ne casse pas sur un statut inconnu', () => {
    const meta = paymentStatusMeta('SOMETHING_ELSE');
    expect(meta.label).toBe('Statut inconnu');
    expect(meta.open).toBe(false);
  });
});

describe('directionLabel', () => {
  it('traduit le sens du point de vue du client', () => {
    expect(directionLabel('COLLECTION')).toBe('Dépôt');
    expect(directionLabel('PAYOUT')).toBe('Retrait');
  });
});
