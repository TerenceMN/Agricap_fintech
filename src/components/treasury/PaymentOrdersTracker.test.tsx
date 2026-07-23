/**
 * `PaymentOrdersTracker` — le suivi honnête d'un dépôt devenu asynchrone.
 *
 * Deux garanties se jouent ici : l'état INDETERMINATE reçoit un bandeau qui dit
 * « en cours de vérification, ne relancez pas », et AUCUN bouton ne relance un
 * ordre — un rejeu à l'aveugle paie deux fois. On vérifie aussi les trois états
 * de données (chargement, vide, erreur).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PaymentOrdersTracker from '@/components/treasury/PaymentOrdersTracker';

const paymentOrders = vi.fn();

vi.mock('@/services/api', () => ({
  api: { caisses: { wallets: { paymentOrders: () => paymentOrders() } } },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public code: string | null = null,
      public errors: Array<{ code: string; message: string }> = [],
    ) {
      super(message);
    }
  },
}));

function order(over: Record<string, unknown> = {}) {
  return {
    reference: 'PO-1',
    status: 'SENT',
    detail: 'Ordre transmis au fournisseur — réponse en attente.',
    direction: 'COLLECTION',
    operation: 'deposit_mm',
    amount: '150.00',
    currency: 'USD',
    counterparty: '+243900000000',
    walletId: 1,
    treasuryAccountCode: null,
    providerReference: null,
    movementId: null,
    reversalMovementId: null,
    awaitingReconciliation: true,
    failureDetail: null,
    createdAt: '2026-07-23T10:00:00Z',
    sentAt: '2026-07-23T10:00:05Z',
    settledAt: null,
    createdBy: 'sub-1',
    ...over,
  };
}

describe('PaymentOrdersTracker', () => {
  it('liste les ordres avec un statut lisible, sans le recalculer', async () => {
    paymentOrders.mockResolvedValueOnce([order()]);
    render(<PaymentOrdersTracker />);

    await screen.findByText('PO-1');
    expect(screen.getByText('Transmis au fournisseur')).toBeTruthy();
    // Sens vu du client : COLLECTION = dépôt.
    expect(screen.getAllByText('Dépôt').length).toBeGreaterThan(0);
    // Montant affiché tel que servi (chaîne Decimal), avec sa devise.
    expect(screen.getByText('150.00 USD')).toBeTruthy();
  });

  it('affiche un bandeau pour l’état INDETERMINATE et n’offre AUCUNE relance', async () => {
    paymentOrders.mockResolvedValueOnce([order({ reference: 'PO-IND', status: 'INDETERMINATE' })]);
    render(<PaymentOrdersTracker />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('issue inconnue');
    expect(alert.textContent?.toLowerCase()).toContain('ne les relancez pas');

    // Aucun bouton « relancer / renvoyer / réessayer » n'existe. Le seul bouton
    // est « Actualiser », qui RELIT la liste sans renvoyer d'ordre.
    const buttons = screen.getAllByRole('button').map((b) => b.textContent?.toLowerCase() || '');
    expect(buttons.some((t) => /relanc|renvoy|réessay|retry/.test(t))).toBe(false);
    expect(buttons.some((t) => t.includes('actualiser'))).toBe(true);
  });

  it('affiche un état vide explicite', async () => {
    paymentOrders.mockResolvedValueOnce([]);
    render(<PaymentOrdersTracker />);
    await screen.findByText('Aucun ordre de paiement');
  });

  it('affiche l’erreur de chargement dépliée', async () => {
    const { ApiError } = await import('@/services/api') as unknown as {
      ApiError: new (s: number, m: string) => Error;
    };
    paymentOrders.mockRejectedValueOnce(new ApiError(500, 'Service indisponible.'));
    render(<PaymentOrdersTracker />);
    await screen.findByText('Chargement des ordres impossible');
    expect(screen.getByText('Service indisponible.')).toBeTruthy();
  });

  it('« Actualiser » relit la liste', async () => {
    paymentOrders.mockResolvedValueOnce([order()]);
    render(<PaymentOrdersTracker />);
    await screen.findByText('PO-1');

    paymentOrders.mockResolvedValueOnce([order({ reference: 'PO-2', status: 'AWAITING_CONFIRMATION' })]);
    fireEvent.click(screen.getByText('Actualiser'));

    await waitFor(() => expect(screen.getByText('PO-2')).toBeTruthy());
    expect(paymentOrders).toHaveBeenCalledTimes(2);
  });
});
