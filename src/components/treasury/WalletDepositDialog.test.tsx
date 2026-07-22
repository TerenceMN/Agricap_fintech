/**
 * `WalletDepositDialog` — le dépôt partagé là où il part d'un bouton.
 *
 * C'est la présentation utilisée par l'espace investisseur, qui portait
 * jusqu'ici sa propre boîte « Montant (USD) » sans devise ni vérification. Ce
 * test existe pour une raison précise : prouver que la mise en boîte de
 * dialogue ne fait PAS disparaître l'étape de confirmation. Deux couches
 * s'empilent (dialogue du dépôt, puis dialogue de confirmation) — si la seconde
 * ne s'ouvrait pas, l'investisseur retrouverait exactement l'écran sans garde-fou
 * que ce chantier supprime.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WalletDepositDialog from '@/components/treasury/WalletDepositDialog';

const deposit = vi.fn();

vi.mock('@/services/api', () => ({
  api: { caisses: { wallets: { deposit: (...args: unknown[]) => deposit(...args) } } },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

describe('WalletDepositDialog', () => {
  it('propose la devise et exige la confirmation avant tout envoi', async () => {
    deposit.mockResolvedValueOnce({});
    const onOpenChange = vi.fn();
    render(<WalletDepositDialog open onOpenChange={onOpenChange} />);

    // Le choix de devise est bien présent dans cette présentation aussi.
    expect(screen.getByLabelText('Devise').textContent).toContain('USD');

    fireEvent.change(document.querySelector('#wallet-amount')!, { target: { value: '5000' } });
    fireEvent.change(document.querySelector('#wallet-phone')!, { target: { value: '+243900000000' } });
    fireEvent.submit(document.querySelector('form')!);

    await screen.findByText("Confirmer l'opération");
    expect(deposit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Confirmer et Exécuter'));

    await waitFor(() => expect(deposit).toHaveBeenCalledWith(5000, 'USD', 'mobile_money'));
    // Succès : la boîte de dépôt se referme d'elle-même.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
