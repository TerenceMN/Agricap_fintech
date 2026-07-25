/**
 * Logique de composition de la vue « Caisses » — fonctions pures.
 *
 * Ces tests cimentent les invariants que le prompt exige : le verdict de clôture
 * se lit sur le STATUT servi (jamais un code HTTP), la jauge de plafond ne divise
 * jamais par zéro et n'est pas rassurante sans séance, la troncature à 100 est
 * signalée, un compte gelé n'accepte pas de flux, et l'éventail des séances isole
 * les échecs sans faire tomber le reste.
 */
import { describe, expect, it } from 'vitest';
import type { CashRegisterSessionRow } from '@/types/api';
import {
  ceilingGauge, closureVerdict, countByStatus, findOpenSession, frozenAccounts,
  isFlowDisabled, lastClosure, loadSessionsFanned, serverLimitNote, sessionsAtServerLimit,
  totalsByCurrency, SERVER_SESSION_LIMIT, type CaisseAccountRow,
} from '@/pages/caissesWire';

function session(over: Partial<CashRegisterSessionRow> = {}): CashRegisterSessionRow {
  return {
    id: 1, accountCode: 'CX', status: 'CLOSED', openedBy: 'a', openingCount: 0,
    openingBalanceExpected: 0, openedAt: '2026-07-01T08:00:00Z', cashInTotal: 0, closedBy: 'a',
    closingCount: 0, closingBalanceExpected: 0, discrepancy: 0, closedAt: '2026-07-01T18:00:00Z',
    ...over,
  };
}

function account(over: Partial<CaisseAccountRow> = {}): CaisseAccountRow {
  return {
    id: 1, code: 'CX', name: 'Caisse', kind: 'CAISSE', agencyId: null, currency: 'USD',
    balance: 100, initialAmount: 0, manager: 'm', scope: '', riskLevel: 'FAIBLE', status: 'ACTIF',
    createdAt: '2026-07-01T08:00:00Z', dailyCeiling: null, partnerId: null, partnerName: null,
    ...over,
  };
}

describe('closureVerdict — le verdict se lit sur le STATUT, jamais sur le code HTTP', () => {
  it('DISCREPANCY → gelé, avec l’écart servi', () => {
    // La signature ne reçoit AUCUN statut HTTP : un appelant ne PEUT PAS se fier au
    // code HTTP. Le serveur répond 200 même ici — seul `status` porte le verdict.
    const v = closureVerdict({ status: 'DISCREPANCY', discrepancy: -42 });
    expect(v.kind).toBe('discrepancy');
    expect(v.frozen).toBe(true);
    expect(v.discrepancy).toBe(-42);
  });

  it('CLOSED → neutre, même avec un petit écart dans la tolérance', () => {
    const v = closureVerdict({ status: 'CLOSED', discrepancy: 0.5 });
    expect(v.kind).toBe('balanced');
    expect(v.frozen).toBe(false);
  });
});

describe('ceilingGauge — jamais NaN, jamais division par zéro, jamais rassurante sans séance', () => {
  it('plafond nul → non plafonné (fait structurel, aucune division)', () => {
    expect(ceilingGauge({ dailyCeiling: null, openSession: session({ status: 'OPEN' }) }))
      .toEqual({ kind: 'unlimited' });
  });

  it('plafond ≤ 0 servi → non plafonné, pas de division par zéro', () => {
    const g = ceilingGauge({ dailyCeiling: 0, openSession: session({ status: 'OPEN', cashInTotal: 5 }) });
    expect(g.kind).toBe('unlimited');
  });

  it('plafond posé mais AUCUNE séance ouverte → plafond non actif (pas de jauge à 0)', () => {
    expect(ceilingGauge({ dailyCeiling: 1000, openSession: null })).toEqual({ kind: 'no-session' });
  });

  it('séance ouverte proche de la borne → alerte, ratio fini', () => {
    const g = ceilingGauge({ dailyCeiling: 100, openSession: session({ status: 'OPEN', cashInTotal: 90 }) });
    expect(g.kind).toBe('gauged');
    if (g.kind === 'gauged') {
      expect(Number.isFinite(g.ratio)).toBe(true);
      expect(Number.isNaN(g.ratio)).toBe(false);
      expect(g.nearLimit).toBe(true);
      expect(g.over).toBe(false);
      expect(g.used).toBe(90);
      expect(g.ceiling).toBe(100);
    }
  });

  it('séance sous la borne → pas d’alerte ; au-dessus → dépassement', () => {
    const under = ceilingGauge({ dailyCeiling: 100, openSession: session({ status: 'OPEN', cashInTotal: 10 }) });
    const over = ceilingGauge({ dailyCeiling: 100, openSession: session({ status: 'OPEN', cashInTotal: 130 }) });
    expect(under.kind === 'gauged' && under.nearLimit).toBe(false);
    expect(over.kind === 'gauged' && over.over).toBe(true);
  });
});

describe('troncature à 100 séances', () => {
  it('exactement 100 → tronqué (marqueur inféré) ; 99 → non', () => {
    const many = Array.from({ length: SERVER_SESSION_LIMIT }, (_, i) => session({ id: i }));
    expect(sessionsAtServerLimit(many)).toBe(true);
    expect(serverLimitNote(many)).toContain('limite serveur');
    expect(sessionsAtServerLimit(many.slice(0, 99))).toBe(false);
    expect(serverLimitNote(many.slice(0, 99))).toBeNull();
  });
});

describe('isFlowDisabled — un compte gelé n’accepte aucun flux', () => {
  it('BLOQUE → désactivé ; ARCHIVE → désactivé ; ACTIF → autorisé', () => {
    expect(isFlowDisabled({ status: 'BLOQUE' })).toBe(true);
    expect(isFlowDisabled({ status: 'ARCHIVE' })).toBe(true);
    expect(isFlowDisabled({ status: 'ACTIF' })).toBe(false);
  });
});

describe('findOpenSession / lastClosure', () => {
  it('trouve la séance ouverte et la dernière clôture', () => {
    const sessions = [
      session({ id: 3, status: 'OPEN', closedAt: null }),
      session({ id: 2, status: 'DISCREPANCY', discrepancy: -7 }),
      session({ id: 1, status: 'CLOSED', discrepancy: 0 }),
    ];
    expect(findOpenSession(sessions)?.id).toBe(3);
    const c = lastClosure(sessions);
    expect(c?.session.id).toBe(2);
    expect(c?.frozen).toBe(true);
    expect(c?.discrepancy).toBe(-7);
  });

  it('aucune séance → null partout', () => {
    expect(findOpenSession([])).toBeNull();
    expect(lastClosure(undefined)).toBeNull();
  });
});

describe('totalsByCurrency — sommes à devise constante, jamais fusionnées', () => {
  it('sépare USD et CDF', () => {
    const rows = [
      account({ currency: 'USD', balance: 100 }),
      account({ currency: 'USD', balance: 50 }),
      account({ currency: 'CDF', balance: 3000 }),
    ];
    const totals = totalsByCurrency(rows);
    expect(totals).toEqual([
      { currency: 'CDF', total: 3000, count: 1 },
      { currency: 'USD', total: 150, count: 2 },
    ]);
  });
});

describe('dénombrements', () => {
  it('countByStatus et frozenAccounts lisent le statut servi', () => {
    const rows = [account({ status: 'ACTIF' }), account({ code: 'C2', status: 'BLOQUE' }), account({ code: 'C3', status: 'BLOQUE' })];
    expect(countByStatus(rows, 'ACTIF')).toBe(1);
    expect(frozenAccounts(rows).map((a) => a.code)).toEqual(['C2', 'C3']);
  });
});

describe('loadSessionsFanned — éventail borné, échec isolé', () => {
  it('une caisse en échec n’empêche pas les autres de charger', async () => {
    const codes = ['A', 'B', 'C'];
    const map = await loadSessionsFanned(
      codes,
      async (code) => {
        if (code === 'B') throw new Error('boom');
        return [session({ accountCode: code })];
      },
      { concurrency: 2 },
    );
    expect(map.A.ok).toBe(true);
    expect(map.C.ok).toBe(true);
    expect(map.B.ok).toBe(false);
    expect(map.A.ok && map.A.sessions.length).toBe(1);
  });

  it('borne la concurrence : jamais plus de N requêtes en vol', async () => {
    const codes = Array.from({ length: 20 }, (_, i) => `C${i}`);
    let inFlight = 0;
    let maxInFlight = 0;
    await loadSessionsFanned(
      codes,
      async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return [];
      },
      { concurrency: 5 },
    );
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
