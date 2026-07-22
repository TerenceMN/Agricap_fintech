/**
 * `ReturnColumns` — les trois rendements à l'écran.
 *
 * Les projections sont déjà testées dans `investorSpaceWire.test.ts` ; ce qui se
 * joue ici est le RENDU, c'est-à-dire ce que l'investisseur lit réellement :
 *
 *   - les trois colonnes sortent ensemble, ou l'écran ment par omission — un
 *     gain latent seul se lit comme un gain acquis ;
 *   - le mot « latent » est visible sur la colonne latente, pas caché dans une
 *     note de bas de page ;
 *   - un rendement réalisé indisponible affiche SON MOTIF, jamais « 0,00 % ».
 *     C'est la différence entre « rien n'a encore été distribué » et « vous
 *     n'avez rien gagné », et un investisseur ne réagit pas pareil aux deux.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReturnColumns from '@/components/investor-space/ReturnColumns';
import { buildReturnColumns } from '@/lib/investorSpaceWire';
import type { InvestorMetrics } from '@/types/api';

/**
 * Fixture PARTIELLE et assumée : `ReturnColumns` ne lit que ce que
 * `buildReturnColumns` projette — les taux, leurs unités déclarées, la
 * valorisation et l'effectif du coupon. Recopier les trente autres champs de
 * `InvestorMetrics` (défaut, concentration, santé, période, devise) noierait le
 * cas testé sans rien prouver de plus, d'où le cast plutôt qu'un `Partial<>`
 * qui mentirait au composant sur ce qu'il reçoit en production.
 */
function metrics(over: Record<string, unknown> = {}): InvestorMetrics {
  return {
    totalInvested: 5000,
    totalSettled: 5000,
    totalRefunded: 0,
    totalDistributed: 156.25,
    positionsCount: 1,
    realizedReturn: 0.0925,
    realizedReturnUnavailableReason: null,
    // FRACTION, comme tous les taux du module — et `units` le déclare.
    expectedCouponRate: 0.125,
    expectedCouponBasis: 5000,
    expectedCouponPositions: 1,
    valuation: {
      capitalOutstanding: 4843.75,
      latentGain: 210,
      latentGainIsLatent: true,
      totalValue: 5053.75,
      positionsCount: 1,
      byMethod: {},
      methodNotes: [],
      method: 'Dette saine valorisée au pair ; intérêts courus prorata temporis.',
    },
    units: { realizedReturn: 'fraction', expectedCouponRate: 'fraction' },
    nextPaymentDate: '2026-04-20',
    currency: 'USD',
    asOf: '2026-07-22',
    ...over,
  } as unknown as InvestorMetrics;
}

describe('ReturnColumns', () => {
  it('rend les trois colonnes ensemble', () => {
    render(<ReturnColumns columns={buildReturnColumns(metrics())} currency="USD" asOf="2026-07-22" />);

    expect(screen.getByText('Rendement réalisé')).toBeTruthy();
    expect(screen.getByText('Gain latent')).toBeTruthy();
    expect(screen.getByText('Rendement attendu')).toBeTruthy();
  });

  it('affiche le réalisé en pourcents et le latent en montant — jamais fusionnés', () => {
    const { container } = render(
      <ReturnColumns columns={buildReturnColumns(metrics())} currency="USD" asOf="2026-07-22" />,
    );

    // 0,0925 servi en fraction → 9,25 % à l'écran (et surtout pas 0,09 %).
    expect(container.textContent).toContain('9,25 %');
    // `expectedCouponRate` est DÉJÀ en pourcents : 12,5 % et non 1 250 %.
    expect(container.textContent).toContain('12,50 %');
    expect(container.textContent).toContain('210 $');
  });

  it('marque la colonne latente comme latente, à l’écran', () => {
    const { container } = render(
      <ReturnColumns columns={buildReturnColumns(metrics())} currency="USD" asOf="2026-07-22" />,
    );

    expect(container.textContent).toContain('Latent — non encaissé');
    // Et publie la méthode de valorisation servie par le serveur.
    expect(container.textContent).toContain('valorisée au pair');
  });

  it('affiche le motif servi au lieu d’un 0 % quand le XIRR n’existe pas', () => {
    const motif = 'Tous les flux vont dans le même sens : le rendement n’existe pas encore.';
    const { container } = render(
      <ReturnColumns
        columns={buildReturnColumns(metrics({
          realizedReturn: null, realizedReturnUnavailableReason: motif,
        }))}
        currency="USD"
        asOf="2026-07-22"
      />,
    );

    expect(container.textContent).toContain('Non disponible');
    expect(container.textContent).toContain(motif);
    expect(container.textContent).not.toContain('0,00 %');
  });
});
