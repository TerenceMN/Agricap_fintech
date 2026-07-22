/**
 * `DepositForm` — le formulaire de dépôt partagé, vu du client.
 *
 * Trois choses sont vérifiées ici, et chacune protège d'un mouvement d'argent
 * erroné plutôt que d'un défaut d'affichage :
 *
 *   1. la devise est un CHOIX offert à l'écran (elle a disparu de l'espace
 *      investisseur, d'où le dépôt en dollars d'un versement en francs) ;
 *   2. rien n'est envoyé avant la confirmation — c'est l'étape qui rattrape un
 *      montant ou une devise mal saisis ;
 *   3. la confirmation redit le montant ET la devise, puis c'est CE couple qui
 *      part au serveur, accompagné du moyen de paiement.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DepositForm from '@/components/treasury/DepositForm';

const deposit = vi.fn();

vi.mock('@/services/api', () => ({
  api: { caisses: { wallets: { deposit: (...args: unknown[]) => deposit(...args) } } },
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

function fill(container: HTMLElement, values: { amount: string; phone?: string }) {
  fireEvent.change(container.querySelector('#wallet-amount')!, { target: { value: values.amount } });
  if (values.phone !== undefined) {
    fireEvent.change(container.querySelector('#wallet-phone')!, { target: { value: values.phone } });
  }
}

function submit(container: HTMLElement) {
  fireEvent.submit(container.querySelector('form')!);
}

describe('DepositForm', () => {
  it('offre le choix de la devise à l’écran', () => {
    render(<DepositForm />);

    const selector = screen.getByLabelText('Devise');
    expect(selector.textContent).toContain('USD');
  });

  it('refuse un montant invalide sans rien envoyer', () => {
    const { container } = render(<DepositForm />);
    fill(container, { amount: '0', phone: '+243900000000' });
    submit(container);

    expect(container.textContent).toContain('Montant invalide');
    expect(deposit).not.toHaveBeenCalled();
  });

  it('exige le numéro mobile money sans rien envoyer', () => {
    const { container } = render(<DepositForm />);
    fill(container, { amount: '150' });
    submit(container);

    expect(container.textContent).toContain('Numéro requis');
    expect(deposit).not.toHaveBeenCalled();
  });

  it('n’envoie RIEN tant que le client n’a pas confirmé', async () => {
    const { container } = render(<DepositForm />);
    fill(container, { amount: '150', phone: '+243900000000' });
    submit(container);

    // L'écran de vérification est là, l'argent n'a pas bougé.
    await screen.findByText("Confirmer l'opération");
    expect(deposit).not.toHaveBeenCalled();
  });

  it('redit montant ET devise avant d’exécuter, puis envoie ce couple', async () => {
    deposit.mockResolvedValueOnce({});
    const onCompleted = vi.fn();
    const { container } = render(<DepositForm onCompleted={onCompleted} />);
    fill(container, { amount: '150', phone: '+243900000000' });
    submit(container);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Dépôt');
    expect(dialog.textContent).toContain('150');
    expect(dialog.textContent).toContain('USD');

    fireEvent.click(screen.getByText('Confirmer et Exécuter'));

    await waitFor(() => expect(deposit).toHaveBeenCalledTimes(1));
    // Montant, devise saisie, moyen de paiement — dans cet ordre, sans constante.
    expect(deposit).toHaveBeenCalledWith(150, 'USD', 'mobile_money');
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
  });

  it('déplie les causes d’un refus 422 et garde l’opération à l’écran', async () => {
    const { ApiError } = await import('@/services/api') as unknown as {
      ApiError: new (
        s: number, m: string, c: string | null, e: Array<{ code: string; message: string }>,
      ) => Error;
    };
    deposit.mockRejectedValueOnce(new ApiError(422, 'Refus', null, [
      { code: 'KYC_LIMIT', message: 'Plafond mensuel dépassé.' },
      { code: 'WALLET_BLOCKED', message: 'Portefeuille bloqué.' },
    ]));

    const { container } = render(<DepositForm />);
    fill(container, { amount: '150', phone: '+243900000000' });
    submit(container);
    fireEvent.click(await screen.findByText('Confirmer et Exécuter'));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('Plafond mensuel dépassé.'));
    // Les DEUX causes, pas seulement la première — un 422 en porte souvent plusieurs.
    expect(dialog.textContent).toContain('Portefeuille bloqué.');
    expect(dialog.textContent).toContain('KYC_LIMIT');
    // Et le récapitulatif reste sous les yeux du client.
    expect(dialog.textContent).toContain('150');
  });
});
