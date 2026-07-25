/**
 * Ce fichier teste un ADAPTATEUR : `formatScore`, `formatEcartPct` et
 * `formatDateTimeFr` délèguent à `@/components/analyse/analyseFormat`, formateur
 * du module crédit qu'on consomme au lieu de le réécrire. Les assertions valent
 * donc comme contrat de ce que l'écran d'instruction attend de lui — si un
 * remaniement de `analyseFormat` faisait rendre « 0 » pour une valeur absente ou
 * perdait le signe d'un écart, c'est ici que ça casserait.
 *
 * Seuls `formatEntier` et `abregerSha` sont écrits ici, faute d'équivalent.
 */
import { describe, it, expect } from 'vitest';
import {
  NULL_DISPLAY, abregerSha, estNombre, formatDateTimeFr, formatEcartPct, formatEntier,
  formatScore,
} from './format';

/** Les espaces d'`Intl` sont insécables : on compare sur des chiffres, pas des blancs. */
const chiffres = (s: string) => s.replace(/[\s  ]/g, '');

describe('une valeur absente s’affiche « — », jamais « 0 » (§4.6)', () => {
  const absentes = [null, undefined, '', Number.NaN];
  it.each([
    ['formatScore', formatScore],
    ['formatEcartPct', formatEcartPct],
    ['formatEntier', formatEntier],
  ])('%s', (_nom, fn) => {
    for (const v of absentes) expect(fn(v)).toBe(NULL_DISPLAY);
  });

  it('mais un zéro servi par le serveur reste un zéro', () => {
    expect(chiffres(formatScore(0))).toBe('0,0');
    expect(chiffres(formatEcartPct(0))).toBe('0,0%');
    expect(formatEntier(0)).toBe('0');
  });
});

describe('formatScore — la précision du moteur est conservée', () => {
  it('affiche le score au dixième, comme le `quantize(0.1)` serveur', () => {
    expect(chiffres(formatScore(29.25))).toBe('29,3');
    expect(chiffres(formatScore(100))).toBe('100,0');
  });
});

describe('formatEcartPct — le signe porte le sens de l’écart', () => {
  it('préfixe explicitement un écart positif', () => {
    expect(chiffres(formatEcartPct(52))).toBe('+52,0%');
  });

  it('conserve le signe d’un écart négatif', () => {
    expect(chiffres(formatEcartPct(-80))).toBe('-80,0%');
  });
});

describe('formatEntier — entier nu, sans unité ni symbole', () => {
  it('rend l’entier sans décimale', () => {
    expect(chiffres(formatEntier(12))).toBe('12');
    expect(chiffres(formatEntier(2026))).toBe('2026');
  });

  it('ne rend pas un entier pour une chaîne : le contrat sert des nombres', () => {
    expect(formatEntier('12')).toBe(NULL_DISPLAY);
  });
});

describe('abregerSha — l’empreinte reste reconnaissable', () => {
  it('abrège une empreinte longue en gardant début et fin', () => {
    const sha = 'a'.repeat(60) + 'beef';
    const court = abregerSha(sha);
    expect(court.startsWith('aaaaaaaaaaaa')).toBe(true);
    expect(court.endsWith('beef')).toBe(true);
  });

  it('ne tronque pas une empreinte déjà courte', () => {
    expect(abregerSha('abc123')).toBe('abc123');
  });

  it('dit « — » quand le serveur n’a pas d’empreinte : non rejouable, pas « vide »', () => {
    expect(abregerSha('')).toBe(NULL_DISPLAY);
    expect(abregerSha(null)).toBe(NULL_DISPLAY);
  });
});

describe('formatDateTimeFr', () => {
  it('rend « — » pour un horodatage absent ou illisible', () => {
    expect(formatDateTimeFr(null)).toBe(NULL_DISPLAY);
    expect(formatDateTimeFr('pas une date')).toBe(NULL_DISPLAY);
  });

  it('rend une date lisible pour un ISO valide', () => {
    expect(formatDateTimeFr('2026-07-24T09:00:00Z')).toContain('2026');
  });
});

describe('estNombre', () => {
  it('distingue un nombre exploitable d’une absence', () => {
    expect(estNombre(0)).toBe(true);
    expect(estNombre(Number.NaN)).toBe(false);
    expect(estNombre('12')).toBe(false);
    expect(estNombre(null)).toBe(false);
  });
});
