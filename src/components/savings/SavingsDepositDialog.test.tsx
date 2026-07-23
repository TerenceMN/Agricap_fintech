/**
 * `SavingsDepositDialog` — le seul mouvement d'argent qui partait sans filet.
 *
 * Ce test existe pour une raison précise et vérifiable : prouver qu'aucun appel
 * à `/savings/plans/{id}/deposit` n'est émis avant que le client ait relu le
 * plan visé, le montant et la devise DU PLAN. Il vérifie aussi qu'un refus
 * serveur laisse la confirmation ouverte : c'est là que le client corrige, et
 * refermer le dialogue lui ferait tout ressaisir.
 *
 * `.jsx` n'est pas vérifié par `tsc` (`checkJs: false`) : sans ce test, une
 * faute dans ce composant n'apparaîtrait qu'au clic d'un client, sur un dépôt.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import SavingsDepositDialog from '@/components/savings/SavingsDepositDialog';

// jsdom n'implémente pas `ResizeObserver`, dont Radix se sert pour dimensionner
// l'indicateur de la case à cocher. Posé ici, dans le seul fichier qui en a
// besoin, plutôt que dans le `setupFiles` partagé.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const deposit = vi.fn();

// `vi.mock` est hissé en tête de fichier : la classe de repli doit l'être aussi,
// sans quoi elle n'existe pas encore quand la fabrique s'exécute.
const { FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class FakeApiError extends Error {
    status: number;
    code: string | null;
    errors: Array<{ code: string; message: string }>;

    constructor(
      status: number,
      message: string,
      code: string | null = null,
      errors: Array<{ code: string; message: string }> = [],
    ) {
      super(message);
      this.status = status;
      this.code = code;
      this.errors = errors;
    }
  },
}));

vi.mock('@/services/api', () => ({
  api: { savings: { deposit: (...args: unknown[]) => deposit(...args) } },
  ApiError: FakeApiError,
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

const plan = { id: 7, name: 'Achat Tracteur', currency: 'CDF' };

function fillAmount(value: string) {
  fireEvent.change(document.querySelector('#savings-deposit-amount')!, { target: { value } });
}

function tickAgreement() {
  fireEvent.click(document.querySelector('#savings-deposit-agreed')!);
}

describe('SavingsDepositDialog', () => {
  it('ne transmet rien au serveur avant la confirmation, et redit plan + devise', async () => {
    deposit.mockResolvedValueOnce({ id: 7, name: 'Achat Tracteur', currency: 'CDF', balance: 1100 });
    const onDeposited = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SavingsDepositDialog open plan={plan} onOpenChange={onOpenChange} onDeposited={onDeposited} />,
    );

    // La devise du plan est annoncée dès la saisie, sans être saisissable.
    expect(document.body.textContent).toContain('Montant du Dépôt (CDF)');

    fillAmount('1000');
    fireEvent.change(document.querySelector('#savings-deposit-reference')!, {
      target: { value: 'TRX-2440' },
    });
    tickAgreement();
    fireEvent.submit(document.querySelector('form')!);

    await screen.findByText('Confirmer votre dépôt');
    // Le point du chantier : rien n'est parti.
    expect(deposit).not.toHaveBeenCalled();
    // Le récapitulatif nomme le plan et libelle le montant dans SA devise.
    expect(document.body.textContent).toContain('Achat Tracteur');
    expect(document.body.textContent).toMatch(/1\s?000,00 CDF/);
    expect(document.body.textContent).toContain('Mobile Money');

    fireEvent.click(screen.getByText('Confirmer et Déposer'));

    await waitFor(() => expect(deposit).toHaveBeenCalledWith(7, 1000, 'mobile_money'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onDeposited).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, balance: 1100 }),
    );
  });

  it('refuse de soumettre une saisie invalide, sans jamais appeler le serveur', async () => {
    render(<SavingsDepositDialog open plan={plan} onOpenChange={vi.fn()} />);

    fillAmount('0');
    tickAgreement();
    fireEvent.submit(document.querySelector('form')!);

    await screen.findByText('Montant invalide');
    expect(screen.queryByText('Confirmer votre dépôt')).toBeNull();
    expect(deposit).not.toHaveBeenCalled();
  });

  /**
   * Le plan servi sans devise n'est pas un cas d'école : le dépôt serait libellé
   * dans une devise supposée. Il est bloqué avant la confirmation.
   */
  it('bloque le dépôt quand le serveur n’a pas servi la devise du plan', async () => {
    render(
      <SavingsDepositDialog open plan={{ id: 9, name: 'Plan muet' }} onOpenChange={vi.fn()} />,
    );

    fillAmount('500');
    fireEvent.change(document.querySelector('#savings-deposit-reference')!, {
      target: { value: 'TRX-1' },
    });
    tickAgreement();
    fireEvent.submit(document.querySelector('form')!);

    await screen.findByText(/Devise du plan non servie/);
    expect(deposit).not.toHaveBeenCalled();
  });

  it('déplie un refus 422 cause par cause et garde la confirmation ouverte', async () => {
    deposit.mockRejectedValueOnce(new FakeApiError(422, 'Refus', null, [
      { code: 'AMOUNT_TOO_SMALL', message: 'Montant inférieur au minimum du plan.' },
      { code: 'PLAN_CLOSED', message: 'Ce plan est clôturé.' },
    ]));
    const onOpenChange = vi.fn();
    render(<SavingsDepositDialog open plan={plan} onOpenChange={onOpenChange} />);

    fillAmount('1');
    fireEvent.change(document.querySelector('#savings-deposit-reference')!, {
      target: { value: 'TRX-9' },
    });
    tickAgreement();
    fireEvent.submit(document.querySelector('form')!);
    await screen.findByText('Confirmer votre dépôt');
    fireEvent.click(screen.getByText('Confirmer et Déposer'));

    // Les DEUX causes sont lisibles, avec leur code — pas un « Erreur 422 ».
    await screen.findByText('Montant inférieur au minimum du plan.');
    await screen.findByText('Ce plan est clôturé.');
    expect(document.body.textContent).toContain('AMOUNT_TOO_SMALL');
    // La confirmation reste ouverte : la saisie n'est pas perdue.
    expect(screen.queryByText('Confirmer votre dépôt')).not.toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
