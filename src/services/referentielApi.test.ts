/**
 * Logique du service Référentiel + agenda. Ces tests protègent des fonctions
 * PURES et déterministes (formatage de plages, regroupements, invariants de
 * config) — la seule couche que vitest protège réellement. Ils vérifient aussi
 * qu'aucune n'invente un chiffre financier : les regroupements ne somment pas
 * les montants, ils comptent des lignes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api';
import type { CalendarEntry, ReferentielVersionRow } from '@/services/referentielApi';
import {
  analysePoids, fmtDate, fmtDateTime, fmtNum, formatBounds, groupCalendarByDay,
  groupCalendarByMonth, groupRangesByChain, isForbidden, monthLabel, referentielApi,
  sortVersions, toNum, versionsAnomaly,
} from '@/services/referentielApi';
import type { ReferenceRange } from '@/types/api';

// Fabrique une plage minimale ; seuls les champs testés sont surchargés.
function range(over: Partial<ReferenceRange>): ReferenceRange {
  return {
    chain_code: '09', chain_libelle: 'Maïs', name: 'grain', systeme: 'pluvial',
    unite: 'kg/ha', cycle_months: 4, parametre_cle: 'rendement',
    rendement: [null, null], cout: [null, null], prix: [null, null],
    perte_max: null, statut: 'indicatif', a_valider: false, ...over,
  };
}

function entry(over: Partial<CalendarEntry>): CalendarEntry {
  return {
    number: 1, date: '2026-08-15', principal: 100, interest: 10, total: 110, balance: 900,
    reference: 'L-1', operator: 'Client', currency: 'USD', ...over,
  };
}

describe('toNum', () => {
  it('accepte un nombre, une chaîne décimale et la virgule francophone', () => {
    expect(toNum(1.05)).toBe(1.05);
    expect(toNum('1.05')).toBe(1.05);
    expect(toNum('1,05')).toBe(1.05);
    expect(toNum('  2,5 ')).toBe(2.5);
  });

  it('renvoie null sur l’absence, jamais NaN', () => {
    expect(toNum('')).toBeNull();
    expect(toNum(null)).toBeNull();
    expect(toNum(undefined)).toBeNull();
    expect(toNum('abc')).toBeNull();
  });

  it('distingue le zéro explicite de l’absence', () => {
    expect(toNum(0)).toBe(0);
    expect(toNum('0')).toBe(0);
  });
});

describe('fmtNum', () => {
  it('rend « — » pour une valeur inexploitable', () => {
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum('')).toBe('—');
    expect(fmtNum('xyz')).toBe('—');
  });
  it('rend un nombre lisible pour une valeur exploitable', () => {
    expect(fmtNum(0)).toBe('0');
    expect(fmtNum(1234)).not.toBe('—');
  });
});

describe('formatBounds', () => {
  it('borne des deux côtés avec l’unité', () => {
    expect(formatBounds([1200, 1800], 'kg/ha')).toBe('1 200 – 1 800 kg/ha');
  });
  it('borne d’un seul côté', () => {
    expect(formatBounds([1200, null], 'kg/ha')).toBe('≥ 1 200 kg/ha');
    expect(formatBounds([null, 1800], 'kg/ha')).toBe('≤ 1 800 kg/ha');
  });
  it('rend « — » sans aucune borne', () => {
    expect(formatBounds([null, null], 'kg/ha')).toBe('—');
    expect(formatBounds(null)).toBe('—');
    expect(formatBounds(undefined, 'USD')).toBe('—');
  });
  it('n’ajoute pas d’unité vide et lit les chaînes DRF', () => {
    expect(formatBounds(['1200', '1800'])).toBe('1 200 – 1 800');
    expect(formatBounds(['1,5', '2,5'], 'USD/kg')).toBe('1,5 – 2,5 USD/kg');
  });
  it('traite une borne à 0 comme une vraie borne, pas comme absente', () => {
    expect(formatBounds([0, 5], '%')).toBe('0 – 5 %');
  });
});

describe('groupRangesByChain', () => {
  it('regroupe par chaîne et trie par code', () => {
    const out = groupRangesByChain([
      range({ chain_code: '11', chain_libelle: 'Riz', name: 'a' }),
      range({ chain_code: '09', chain_libelle: 'Maïs', name: 'b' }),
      range({ chain_code: '09', chain_libelle: 'Maïs', name: 'c' }),
    ]);
    expect(out.map((g) => g.chain_code)).toEqual(['09', '11']);
    expect(out[0].ranges.map((r) => r.name)).toEqual(['b', 'c']);
    expect(out[1].chain_libelle).toBe('Riz');
  });
  it('renvoie une liste vide sur une entrée vide', () => {
    expect(groupRangesByChain([])).toEqual([]);
  });
});

describe('analysePoids — invariant somme des poids = 100', () => {
  it('accepte une config cohérente (chaînes DRF comprises)', () => {
    const c = analysePoids({
      technique: '30', financier: '25', stress: '20', comportemental: '15', garanties: '10',
    });
    expect(c.sum).toBe(100);
    expect(c.consistent).toBe(true);
    expect(c.parts).toHaveLength(5);
  });
  it('signale une config dont les poids ne totalisent pas 100', () => {
    const c = analysePoids({
      technique: 30, financier: 25, stress: 20, comportemental: 15, garanties: 5,
    });
    expect(c.sum).toBe(95);
    expect(c.consistent).toBe(false);
  });
  it('ne casse pas sur une config absente', () => {
    const c = analysePoids(null);
    expect(c.sum).toBe(0);
    expect(c.consistent).toBe(false);
    expect(c.parts.map((p) => p.value)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('sortVersions', () => {
  const v = (over: Partial<ReferentielVersionRow>): ReferentielVersionRow => ({
    id: 1, label: 'v', imported_at: '2026-01-01T00:00:00Z', is_active: false, n_ranges: 0, ...over,
  });
  it('place l’active en tête puis trie par import décroissant', () => {
    const out = sortVersions([
      v({ id: 1, label: 'old', imported_at: '2025-01-01T00:00:00Z' }),
      v({ id: 2, label: 'active', is_active: true, imported_at: '2024-01-01T00:00:00Z' }),
      v({ id: 3, label: 'recent', imported_at: '2026-06-01T00:00:00Z' }),
    ]);
    expect(out.map((x) => x.label)).toEqual(['active', 'recent', 'old']);
  });
  it('ne mute pas le tableau source', () => {
    const src = [v({ id: 1 }), v({ id: 2, is_active: true })];
    const copy = [...src];
    sortVersions(src);
    expect(src).toEqual(copy);
  });
});

describe('versionsAnomaly', () => {
  const v = (is_active: boolean): ReferentielVersionRow => ({
    id: Math.random(), label: 'v', imported_at: '', is_active, n_ranges: 0,
  });
  it('pas d’anomalie avec exactement une active', () => {
    expect(versionsAnomaly([v(true), v(false)])).toBe('none');
  });
  it('signale l’absence d’active', () => {
    expect(versionsAnomaly([v(false), v(false)])).toBe('no-active');
  });
  it('signale plusieurs actives', () => {
    expect(versionsAnomaly([v(true), v(true)])).toBe('multiple-active');
  });
  it('liste vide = pas d’anomalie (c’est l’état vide qui parle)', () => {
    expect(versionsAnomaly([])).toBe('none');
  });
});

describe('groupCalendarByDay — regroupe sans sommer', () => {
  it('trie les jours et conserve chaque échéance', () => {
    const out = groupCalendarByDay([
      entry({ date: '2026-08-20', reference: 'L-2' }),
      entry({ date: '2026-08-15', reference: 'L-1' }),
      entry({ date: '2026-08-15', reference: 'L-3' }),
    ]);
    expect(out.map((d) => d.date)).toEqual(['2026-08-15', '2026-08-20']);
    expect(out[0].entries.map((e) => e.reference)).toEqual(['L-1', 'L-3']);
  });
  it('ne fabrique aucun total : seules les valeurs serveur subsistent', () => {
    const out = groupCalendarByDay([
      entry({ date: '2026-08-15', total: 110 }),
      entry({ date: '2026-08-15', total: 200 }),
    ]);
    // La structure ne porte pas de champ agrégé ; on ne compte que des lignes.
    expect(out[0]).not.toHaveProperty('total');
    expect(out[0].entries).toHaveLength(2);
    expect(out[0].entries.map((e) => e.total)).toEqual([110, 200]);
  });
});

describe('groupCalendarByMonth', () => {
  it('regroupe par mois puis par jour, triés', () => {
    const out = groupCalendarByMonth([
      entry({ date: '2026-09-01' }),
      entry({ date: '2026-08-31' }),
      entry({ date: '2026-08-15' }),
    ]);
    expect(out.map((m) => m.key)).toEqual(['2026-08', '2026-09']);
    expect(out[0].days.map((d) => d.date)).toEqual(['2026-08-15', '2026-08-31']);
  });
});

describe('monthLabel', () => {
  it('rend la clé brute sur une entrée non conforme', () => {
    expect(monthLabel('')).toBe('—');
    expect(monthLabel('pas-une-date')).toBe('pas-une-date');
  });
  it('produit un libellé non vide sur une clé valide', () => {
    expect(monthLabel('2026-08')).not.toBe('2026-08');
    expect(monthLabel('2026-08').length).toBeGreaterThan(0);
  });
});

describe('fmtDate / fmtDateTime', () => {
  it('rendent « — » sur une entrée vide', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDateTime('')).toBe('—');
  });
  it('renvoient la valeur brute si la date est illisible', () => {
    expect(fmtDate('pas-une-date')).toBe('pas-une-date');
    expect(fmtDateTime('xx')).toBe('xx');
  });
});

describe('isForbidden', () => {
  it('reconnaît un 403 et rien d’autre', () => {
    expect(isForbidden(new ApiError(403, 'refusé'))).toBe(true);
    expect(isForbidden(new ApiError(404, 'absent'))).toBe(false);
    expect(isForbidden(new Error('x'))).toBe(false);
    expect(isForbidden(null)).toBe(false);
  });
});

describe('referentielApi.versions / calendar — wrappers réseau', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubFetch(status: number, body: unknown) {
    const fn = vi.fn(async (_url?: unknown, _init?: unknown) => new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('versions() appelle GET /api/referentiel/versions', async () => {
    const fn = stubFetch(200, [{ id: 1, label: 'v3', imported_at: '', is_active: true, n_ranges: 14 }]);
    const rows = await referentielApi.versions();
    expect(rows[0].label).toBe('v3');
    expect(fn.mock.calls[0][0]).toBe('/api/referentiel/versions');
    expect(fn.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });

  it('calendar() appelle GET /api/portfolio/calendar', async () => {
    const fn = stubFetch(200, [{ number: 1, date: '2026-08-15', principal: 1, interest: 0, total: 1, balance: 0, reference: 'L-1', operator: 'C', currency: 'USD' }]);
    const rows = await referentielApi.calendar();
    expect(rows[0].reference).toBe('L-1');
    expect(fn.mock.calls[0][0]).toBe('/api/portfolio/calendar');
  });

  it('lève une ApiError typée sur un refus serveur (403)', async () => {
    stubFetch(403, { detail: 'Réservé au personnel.' });
    await expect(referentielApi.versions()).rejects.toBeInstanceOf(ApiError);
    try {
      await referentielApi.versions();
    } catch (e) {
      expect(isForbidden(e)).toBe(true);
    }
  });
});
