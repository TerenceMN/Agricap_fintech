import { describe, it, expect } from 'vitest';
import {
  NULL_DISPLAY, abregerSha, estNombre, formatDateTimeFr, formatDscr, formatEcartPct,
  formatEntier, formatMois, formatPoids, formatPoints, formatPourcent, formatScore,
  formatTaux, libelleIndicateur,
} from './format';

/** Les espaces d'`Intl` sont insécables : on compare sur des chiffres, pas des blancs. */
const chiffres = (s: string) => s.replace(/[\s  ]/g, '');

describe('une valeur absente s’affiche « — », jamais « 0 » (§4.6)', () => {
  const absentes = [null, undefined, '', Number.NaN];
  it.each([
    ['formatScore', formatScore],
    ['formatPoints', formatPoints],
    ['formatPoids', formatPoids],
    ['formatDscr', formatDscr],
    ['formatEcartPct', formatEcartPct],
    ['formatPourcent', formatPourcent],
    ['formatTaux', formatTaux],
    ['formatMois', formatMois],
    ['formatEntier', formatEntier],
  ])('%s', (_nom, fn) => {
    for (const v of absentes) expect(fn(v)).toBe(NULL_DISPLAY);
  });

  it('mais un zéro servi par le serveur reste un zéro', () => {
    expect(chiffres(formatScore(0))).toBe('0,0');
    expect(chiffres(formatDscr(0))).toBe('0,00');
    expect(chiffres(formatEcartPct(0))).toBe('0,0%');
  });
});

describe('précisions — chaque grandeur garde celle du moteur', () => {
  it('garde la 3e décimale du DSCR : 0,999 n’est pas 1,00 devant un plancher', () => {
    expect(chiffres(formatDscr(0.999))).toBe('0,999');
    expect(chiffres(formatDscr(1.2))).toBe('1,20');
  });

  it('affiche le score au dixième', () => {
    expect(chiffres(formatScore(29.25))).toBe('29,3');
  });

  it('affiche le taux à deux décimales, en points de taux', () => {
    expect(chiffres(formatTaux(18))).toBe('18,00%');
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

describe('formatMois', () => {
  it('rend la durée avec son unité', () => {
    expect(chiffres(formatMois(8))).toBe('8mois');
    expect(chiffres(formatMois(0))).toBe('0mois');
  });
});

describe('libelleIndicateur — cosmétique, jamais une renomination', () => {
  it('extrait le module du code canonique', () => {
    expect(libelleIndicateur('cout_module:main_oeuvre')).toBe('main_oeuvre');
  });

  it('rend le code tel quel s’il ne porte pas de préfixe', () => {
    expect(libelleIndicateur('dscr')).toBe('dscr');
  });

  it('ne fabrique pas de libellé pour un code absent', () => {
    expect(libelleIndicateur(undefined)).toBe(NULL_DISPLAY);
  });
});

describe('abregerSha — l’empreinte reste reconnaissable', () => {
  it('abrège une empreinte longue en gardant début et fin', () => {
    const sha = 'a'.repeat(60) + 'beef';
    const court = abregerSha(sha);
    expect(court.startsWith('aaaaaaaaaaaa')).toBe(true);
    expect(court.endsWith('beef')).toBe(true);
  });

  it('ne dit pas « — » pour une empreinte courte mais réelle', () => {
    expect(abregerSha('abc123')).toBe('abc123');
  });

  it('dit « — » quand le serveur n’a pas d’empreinte : non rejouable, pas « vide »', () => {
    expect(abregerSha('')).toBe(NULL_DISPLAY);
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
