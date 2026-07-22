/**
 * `WithdrawForm` — le retrait partagé.
 *
 * Le comportement à ne jamais aplatir : au-dessus du seuil automatique, le
 * serveur n'exécute pas le retrait, il ouvre une demande d'approbation. Le
 * retour porte alors un statut autre que `posted`. Un écran qui annoncerait
 * « opération effectuée » ferait croire au client qu'il dispose d'un argent
 * encore immobilisé — et le ferait revenir au guichet pour rien.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WithdrawForm from '@/components/treasury/WithdrawForm';

// `vi.hoisted` : les fabriques de `vi.mock` sont remontées en tête de fichier,
// elles ne peuvent donc pas fermer sur des `const` déclarées plus bas.
const { withdraw, toast } = vi.hoisted(() => ({ withdraw: vi.fn(), toast: vi.fn() }));

vi.mock('@/services/api', () => ({
  api: { caisses: { wallets: { withdraw } } },
  ApiError: class ApiError extends Error {},
}));

// Le `Toaster` n'est pas monté dans un test de composant : on observe ce que
// l'écran DEMANDE d'annoncer, ce qui est précisément le contrat vérifié ici.
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast }),
  toast,
}));

const balances = { usd: 500, cdf: 1_400_000 };

function fillAndSubmit(container: HTMLElement, amount: string) {
  fireEvent.change(container.querySelector('#wallet-amount')!, { target: { value: amount } });
  fireEvent.change(container.querySelector('#wallet-phone')!, { target: { value: '+243900000000' } });
  fireEvent.submit(container.querySelector('form')!);
}

describe('WithdrawForm', () => {
  it('refuse un retrait au-dessus du solde de la devise choisie, sans rien envoyer', () => {
    const { container } = render(<WithdrawForm balances={balances} />);
    fillAndSubmit(container, '600');

    expect(container.textContent).toContain('Solde insuffisant');
    expect(withdraw).not.toHaveBeenCalled();
  });

  it('exige la confirmation, puis transmet montant et devise', async () => {
    withdraw.mockResolvedValueOnce({ status: 'posted' });
    const { container } = render(<WithdrawForm balances={balances} />);
    fillAndSubmit(container, '200');

    await screen.findByText("Confirmer l'opération");
    expect(withdraw).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Confirmer et Exécuter'));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith(200, 'USD'));
  });

  it('annonce l’attente de validation quand le serveur n’a pas posté le mouvement', async () => {
    withdraw.mockResolvedValueOnce({
      status: 'pending_validation',
      detail: 'Deux approbations requises au-dessus de 1 000 USD.',
    });
    const onCompleted = vi.fn();
    const { container } = render(<WithdrawForm balances={balances} onCompleted={onCompleted} />);
    fillAndSubmit(container, '400');

    fireEvent.click(await screen.findByText('Confirmer et Exécuter'));
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());

    // L'annonce porte le circuit d'approbation, pas un « effectué » trompeur.
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Retrait en attente de validation',
      description: 'Deux approbations requises au-dessus de 1 000 USD.',
    }));
  });

  it('annonce « effectué » seulement quand le serveur a réellement posté', async () => {
    withdraw.mockResolvedValueOnce({ status: 'posted' });
    const { container } = render(<WithdrawForm balances={balances} />);
    fillAndSubmit(container, '100');

    fireEvent.click(await screen.findByText('Confirmer et Exécuter'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Opération Effectuée',
    })));
  });
});
