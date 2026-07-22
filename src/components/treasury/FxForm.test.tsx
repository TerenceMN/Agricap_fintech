/**
 * `FxForm` — le change partagé, et la provenance du taux.
 *
 * L'aperçu affiché n'est pas une estimation reconstituée : c'est la réponse de
 * `/fx/convert`. Deux comportements en découlent, tous deux vérifiés ici — le
 * montant reçu est CELUI du serveur, et quand le serveur ne cote pas la paire,
 * l'écran refuse la conversion au lieu de se rabattre sur un taux local.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FxForm from '@/components/treasury/FxForm';

const { convert, walletConvert } = vi.hoisted(() => ({
  convert: vi.fn(),
  walletConvert: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  api: {
    fx: { convert },
    caisses: { wallets: { convert: walletConvert } },
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

const balances = { usd: 500, cdf: 1_400_000 };

describe('FxForm', () => {
  it('affiche le taux SERVI par /fx/convert, jamais un taux local', async () => {
    convert.mockResolvedValue({ amount: 285_000, from: 'USD', to: 'CDF' });
    const { container } = render(<FxForm balances={balances} />);

    fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: '100' } });

    await waitFor(() => expect(convert).toHaveBeenCalledWith(100, 'USD', 'CDF', 'CLIENT'));
    await waitFor(() => expect(container.textContent).toContain('Taux appliqué : 1 USD = 2850.0000 CDF'));
  });

  it('refuse de convertir quand le serveur ne cote pas la paire', async () => {
    convert.mockRejectedValue(new Error('aucun taux'));
    const { container } = render(<FxForm balances={balances} />);

    fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: '100' } });
    await waitFor(() => expect(convert).toHaveBeenCalled());

    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(container.textContent)
      .toContain('Aucun taux de change configuré pour cette paire.'));
    expect(walletConvert).not.toHaveBeenCalled();
  });

  it('exige la confirmation, en montrant le montant reçu au taux serveur', async () => {
    convert.mockResolvedValue({ amount: 285_000, from: 'USD', to: 'CDF' });
    walletConvert.mockResolvedValueOnce({});
    const { container } = render(<FxForm balances={balances} />);

    fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: '100' } });
    await waitFor(() => expect(convert).toHaveBeenCalled());
    fireEvent.submit(container.querySelector('form')!);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Change FX');
    expect(dialog.textContent).toContain('CDF');
    expect(walletConvert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Confirmer et Exécuter'));
    await waitFor(() => expect(walletConvert).toHaveBeenCalledWith('USD', 'CDF', 100));
  });
});
