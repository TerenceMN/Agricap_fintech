/**
 * Cellules présentées de la vue « Caisses » — rendu isolé (aucun portail Radix,
 * aucun contexte). On vérifie ce que l'écran MONTRE :
 *   • un écart de clôture au-delà de la tolérance s'affiche avec la mention de gel ;
 *   • la jauge de plafond dit « Non plafonné » sans plafond, « aucune séance
 *     ouverte » sans séance, et n'affiche jamais NaN.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CeilingGauge, EcartGelCell, SeanceCell } from '@/components/treasury/CaisseCells';
import { ceilingGauge, lastClosure } from '@/pages/caissesWire';
import type { CashRegisterSessionRow } from '@/types/api';

function session(over: Partial<CashRegisterSessionRow> = {}): CashRegisterSessionRow {
  return {
    id: 1, accountCode: 'CX', status: 'CLOSED', openedBy: 'a', openingCount: 0,
    openingBalanceExpected: 0, openedAt: '2026-07-01T08:00:00Z', cashInTotal: 0, closedBy: 'a',
    closingCount: 0, closingBalanceExpected: 0, discrepancy: 0, closedAt: '2026-07-01T18:00:00Z',
    ...over,
  };
}

describe('EcartGelCell — l’écart et le gel sont visibles', () => {
  it('séance en écart → mention de gel + montant de l’écart', () => {
    const closure = lastClosure([session({ status: 'DISCREPANCY', discrepancy: -42 })]);
    const { container } = render(<EcartGelCell closure={closure} currency="USD" />);
    expect(container.textContent).toContain('Gel');
    expect(container.textContent).toContain('-42,00 USD');
  });

  it('clôture équilibrée → écart neutre, sans gel', () => {
    const closure = lastClosure([session({ status: 'CLOSED', discrepancy: 0.5 })]);
    const { container } = render(<EcartGelCell closure={closure} currency="USD" />);
    expect(container.textContent).toContain('Écart');
    expect(container.textContent).toContain('0,50 USD');
    expect(container.textContent).not.toContain('Gel');
  });

  it('aucune clôture → tiret', () => {
    const { container } = render(<EcartGelCell closure={null} currency="USD" />);
    expect(container.textContent).toContain('—');
  });
});

describe('CeilingGauge — trois états servis, jamais NaN', () => {
  it('sans plafond → « Non plafonné »', () => {
    const g = ceilingGauge({ dailyCeiling: null, openSession: session({ status: 'OPEN' }) });
    const { container } = render(<CeilingGauge gauge={g} currency="USD" />);
    expect(container.textContent).toContain('Non plafonné');
  });

  it('plafond posé mais sans séance → « aucune séance ouverte », pas de jauge à 0', () => {
    const g = ceilingGauge({ dailyCeiling: 1000, openSession: null });
    const { container } = render(<CeilingGauge gauge={g} currency="USD" />);
    expect(container.textContent).toContain('aucune séance ouverte');
    expect(container.textContent).not.toContain('NaN');
  });

  it('séance proche de la borne → montants servis + alerte', () => {
    const g = ceilingGauge({ dailyCeiling: 100, openSession: session({ status: 'OPEN', cashInTotal: 90 }) });
    const { container } = render(<CeilingGauge gauge={g} currency="USD" />);
    expect(container.textContent).toContain('90,00 USD');
    expect(container.textContent).toContain('100,00 USD');
    expect(container.textContent).not.toContain('NaN');
    // L'alerte (AlertTriangle) est rendue en SVG quand on approche la borne.
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('SeanceCell', () => {
  it('séance ouverte → « ouverte depuis »', () => {
    const { container } = render(<SeanceCell openSession={session({ status: 'OPEN' })} />);
    expect(container.textContent).toContain('Ouverte depuis');
  });

  it('aucune séance → « Aucune séance »', () => {
    const { container } = render(<SeanceCell openSession={null} />);
    expect(container.textContent).toContain('Aucune séance');
  });
});
