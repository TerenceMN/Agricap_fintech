/**
 * `LoanScheduleModal` — le chiffre qui s'annonçait « TAEG » sans en être un.
 *
 * Ce que ces tests protègent :
 *
 *  1. **Le mot « TAEG » ne qualifie plus `totals.apr`.** Le serveur calcule
 *     `intérêts ÷ capital ÷ durée en années` (`backend/portfolio/schedule.py`),
 *     soit 10,13 % sur le cas de référence 1 330 USD / 18 %/an / 8 mois. Annoncer
 *     « TAEG 10,13 % » sur un crédit à 18 % promettait à l'emprunteur un coût
 *     deux fois moindre que le sien : un TAEG ne peut JAMAIS être inférieur au
 *     taux nominal, et celui-ci ignore frais de dossier et commissions.
 *     L'écran nomme donc la valeur pour ce qu'elle mesure, et dit explicitement
 *     que ce n'est pas un TAEG.
 *
 *  2. **Aucune valeur n'est fabriquée.** Le pourcentage affiché est celui du
 *     serveur, mis en forme (virgule décimale) et rien d'autre.
 *
 *  3. **Absence ≠ zéro.** Un `apr` non servi affiche « non servi par le serveur »,
 *     jamais « 0 % », qui se lirait comme un crédit gratuit.
 *
 * `.jsx` n'est pas vérifié par `tsc` (`checkJs: false`) : sans ce test, un
 * retour du libellé fautif ne serait rattrapé par rien.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import LoanScheduleModal from '@/components/echeances/LoanScheduleModal';

// Radix mesure ses conteneurs ; jsdom n'implémente pas `ResizeObserver`.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const loanSchedule = vi.fn();

vi.mock('@/services/referentielApi', () => ({
  referentielApi: { loanSchedule: (...args: unknown[]) => loanSchedule(...args) },
  isForbidden: () => false,
}));

/**
 * Cas de référence du backend (`portfolio/tests.py`) : 1 330 USD à 18 %/an sur
 * 8 mois → 89,78 USD d'intérêts et `apr = 10,13`. Payload écrit d'après
 * `portfolio/services.py::schedule_for`.
 */
const reponse = {
  currency: 'USD',
  schedule: [
    {
      number: 1, date: '2026-02-15', principal: 166.25, interest: 19.95,
      total: 186.20, balance: 1163.75, currency: 'USD',
    },
    {
      number: 2, date: '2026-03-15', principal: 166.25, interest: 17.46,
      total: 183.71, balance: 997.50, currency: 'USD',
    },
  ],
  totals: {
    total_principal: 1330, total_interest: 89.78, total_payments: 1419.78, apr: 10.13,
  },
};

function texte(): string {
  return document.body.textContent ?? '';
}

describe('LoanScheduleModal — le coût du crédit ne se déguise plus en TAEG', () => {
  it("n'attribue jamais le mot « TAEG » à la valeur servie", async () => {
    loanSchedule.mockResolvedValueOnce(reponse);
    render(<LoanScheduleModal loanRef="CR-2026-001" operator="Kabila M." onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Coût des intérêts/)).toBeTruthy());

    // Le libellé fautif — « TAEG » collé au chiffre — ne doit plus exister.
    expect(/TAEG\s*:?\s*10/.test(texte())).toBe(false);
    // Le seul emploi restant du mot est la mise en garde explicite.
    expect(texte()).toContain("ce n'est pas un TAEG");
  });

  it('nomme ce que la valeur mesure, avec son unité réelle', async () => {
    loanSchedule.mockResolvedValueOnce(reponse);
    render(<LoanScheduleModal loanRef="CR-2026-001" operator="Kabila M." onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/10,13 % du capital par an/)).toBeTruthy());

    const t = texte();
    expect(t).toContain('intérêts ÷ capital ÷ durée');
    expect(t).toContain('frais de dossier');
    expect(t).toContain('inférieur au taux nominal');
  });

  it('affiche le ratio du serveur, sans le recomposer', async () => {
    // Un serveur qui sert 18,40 doit produire 18,40 à l'écran : aucune
    // annualisation, aucun ×12, aucune division maison.
    loanSchedule.mockResolvedValueOnce({
      ...reponse,
      totals: { ...reponse.totals, apr: 18.4 },
    });
    render(<LoanScheduleModal loanRef="CR-2026-002" operator="Ilunga K." onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/18,40 % du capital par an/)).toBeTruthy());
    expect(/10,13/.test(texte())).toBe(false);
  });

  it("dit « non servi » plutôt que 0 % quand le serveur n'a pas de ratio", async () => {
    loanSchedule.mockResolvedValueOnce({
      ...reponse,
      totals: {
        total_principal: 1330, total_interest: 89.78, total_payments: 1419.78, apr: null,
      },
    });
    render(<LoanScheduleModal loanRef="CR-2026-003" operator="Mwamba T." onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/non servi par le serveur/)).toBeTruthy());
    expect(/0,00 %/.test(texte())).toBe(false);
  });
});
