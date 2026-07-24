/**
 * Ce que ces tests protègent : le **facteur 12** à l'écran.
 *
 * L'incident d'origine n'est pas un calcul faux, c'est un LIBELLÉ faux. La
 * colonne « Taux » de la table d'administration affichait `loan.rate`, un taux
 * MENSUEL, sous un intitulé qui se lit comme annuel — et la même valeur partait
 * dans `rapport_credits.xlsx` sous « Taux (%) ». Un dossier à 2 %/mois s'y lit
 * 2 %/an au lieu de 24 %/an : douze fois moins cher que le prêt réel, dans un
 * fichier qui circule sans son écran d'origine.
 *
 * Quatre défauts sont figés ici, chacun déjà survenu sur ce produit :
 *
 * 1. **Le taux sans unité.** Tout taux formaté sort avec le suffixe de son unité
 *    DÉCLARÉE. Un test vérifie que la même valeur numérique produit deux textes
 *    différents selon l'unité servie.
 *
 * 2. **L'annualisation au navigateur.** `readLoanRates` ne produit JAMAIS de
 *    taux annuel quand le serveur n'en sert pas — surtout pas `rate × 12`, alors
 *    même que c'est la formule du serveur. Un test le vérifie sur un prêt hérité.
 *
 * 3. **Le zéro qui se lit comme une mesure.** `toRate(null)` rend `null`, pas 0
 *    (`Number(null) === 0` est le piège) ; l'export sort « non servi », pas une
 *    cellule vide qui se remplirait à la main ni un 0 qui entrerait dans une
 *    moyenne.
 *
 * 4. **L'unité inconnue rangée dans la case la plus proche.** Un code d'unité
 *    non répertorié s'affiche TEL QUEL, visiblement étrange, plutôt que traduit
 *    au jugé.
 *
 * Les charges utiles sont écrites d'après `backend/portfolio/serializers.py`
 * (`loan_row`, `config_payload`) — champ pour champ, sans champ inventé.
 */
import { describe, expect, it } from 'vitest';
import {
  ANNUAL_RATE_MISSING_REASON,
  RATE_EXPORT_ANNUAL_HEADER,
  RATE_EXPORT_MONTHLY_HEADER,
  RATE_NOT_SERVED,
  UNIT_PERCENT_PER_MONTH,
  UNIT_PERCENT_PER_YEAR,
  formatRate,
  loanRateExportCells,
  rateUnitSuffix,
  readLoanRates,
  toRate,
} from '@/lib/loanRateDisplay';

/** Ligne servie par `loan_row()` sur un prêt à 2 %/mois — le cas du rapport. */
const PRET_2_POURCENT_MOIS = {
  rate: 2,
  rateUnit: UNIT_PERCENT_PER_MONTH,
  annualRate: 24,
  annualRateUnit: UNIT_PERCENT_PER_YEAR,
};

/** Ligne héritée : `_accorder_les_taux()` ne l'a pas encore complétée, le
 *  serializer sert donc `annualRate: null` (et non l'absence de clé). */
const PRET_HERITE = {
  rate: 1.5,
  rateUnit: UNIT_PERCENT_PER_MONTH,
  annualRate: null,
  annualRateUnit: UNIT_PERCENT_PER_YEAR,
};

describe('toRate — un taux absent ne devient jamais zéro', () => {
  it('rend null sur null, undefined et chaîne vide', () => {
    expect(toRate(null)).toBeNull();
    expect(toRate(undefined)).toBeNull();
    expect(toRate('')).toBeNull();
  });

  it('rend null plutôt que NaN sur une valeur non numérique', () => {
    expect(toRate('taux inconnu')).toBeNull();
  });

  it('distingue un zéro EXPLICITE d’une absence', () => {
    // Un prêt bloqué a réellement un taux à 0 (`run_action` branche `block`) :
    // c'est une mesure, pas un trou, et elle doit passer.
    expect(toRate(0)).toBe(0);
  });

  it('lit une valeur servie en chaîne, virgule décimale comprise', () => {
    expect(toRate('1.883333')).toBeCloseTo(1.883333, 6);
    expect(toRate('1,5')).toBe(1.5);
  });
});

describe('formatRate — l’unité voyage avec le chiffre', () => {
  it('suffixe la même valeur différemment selon l’unité déclarée', () => {
    expect(formatRate(2, UNIT_PERCENT_PER_MONTH)).toBe('2,00 %/mois');
    expect(formatRate(2, UNIT_PERCENT_PER_YEAR)).toBe('2,00 %/an');
  });

  it('écrit « non servi » et non « 0 % » quand le taux manque', () => {
    expect(formatRate(null, UNIT_PERCENT_PER_YEAR)).toBe(RATE_NOT_SERVED);
    expect(formatRate(undefined, UNIT_PERCENT_PER_YEAR)).toBe(RATE_NOT_SERVED);
  });

  it('affiche un zéro explicite comme un chiffre', () => {
    expect(formatRate(0, UNIT_PERCENT_PER_MONTH)).toBe('0,00 %/mois');
  });

  it('rend une unité inconnue TELLE QUELLE plutôt que traduite au jugé', () => {
    expect(rateUnitSuffix('basis_points_per_year')).toBe('basis_points_per_year');
    expect(formatRate(150, 'basis_points_per_year')).toBe('150,00 basis_points_per_year');
  });
});

describe('readLoanRates — deux taux servis, aucun reconstitué', () => {
  it('affiche le taux annuel SERVI, pas le mensuel', () => {
    const r = readLoanRates(PRET_2_POURCENT_MOIS);
    expect(r.annual).toBe(24);
    expect(r.annualText).toBe('24,00 %/an');
    expect(r.monthlyText).toBe('2,00 %/mois');
    expect(r.annualServed).toBe(true);
    expect(r.annualUnavailableReason).toBeNull();
  });

  it('n’ANNUALISE PAS quand le serveur ne sert pas de taux annuel', () => {
    const r = readLoanRates(PRET_HERITE);
    // 1,5 × 12 = 18 : c'est bien ce que ferait `rates.annuel_depuis_mensuel`,
    // et c'est précisément ce qui ne doit pas apparaître ici. Une seule source.
    expect(r.annual).toBeNull();
    expect(r.annualText).toBe(RATE_NOT_SERVED);
    expect(r.annualServed).toBe(false);
    expect(r.annualUnavailableReason).toBe(ANNUAL_RATE_MISSING_REASON);
    // Le taux mensuel, lui, reste lisible : on n'efface pas ce qui est servi.
    expect(r.monthlyText).toBe('1,50 %/mois');
  });

  it('suit l’unité DÉCLARÉE plutôt que le nom du champ', () => {
    // Serveur hypothétique qui basculerait `rate` en annuel : le suffixe doit
    // suivre la déclaration, sinon l'écran ment d'un facteur 12 sans rien casser.
    const r = readLoanRates({ rate: 18, rateUnit: UNIT_PERCENT_PER_YEAR });
    expect(r.monthlyText).toBe('18,00 %/an');
    expect(r.monthlyUnit).toBe(UNIT_PERCENT_PER_YEAR);
  });

  it('applique un repli d’unité DOCUMENTÉ sur une source sans « rateUnit »', () => {
    const r = readLoanRates({ rate: 2, annualRate: 24 });
    expect(r.monthlyUnit).toBe(UNIT_PERCENT_PER_MONTH);
    expect(r.annualUnit).toBe(UNIT_PERCENT_PER_YEAR);
    expect(r.monthlyText).toBe('2,00 %/mois');
  });

  it('reste lisible sur une absence totale de prêt', () => {
    const r = readLoanRates(null);
    expect(r.monthlyText).toBe(RATE_NOT_SERVED);
    expect(r.annualText).toBe(RATE_NOT_SERVED);
    expect(r.annualServed).toBe(false);
  });

  it('rappelle les deux unités dans l’infobulle', () => {
    const r = readLoanRates(PRET_2_POURCENT_MOIS);
    expect(r.title).toContain('24,00 %/an');
    expect(r.title).toContain('2,00 %/mois');
  });
});

describe('loanRateExportCells — le classeur survit à l’écran qui l’a produit', () => {
  it('nomme l’unité DANS l’en-tête de colonne', () => {
    expect(RATE_EXPORT_ANNUAL_HEADER).toContain('%/an');
    expect(RATE_EXPORT_MONTHLY_HEADER).toContain('%/mois');
  });

  it('exporte les deux taux servis, sans les confondre', () => {
    const cells = loanRateExportCells(PRET_2_POURCENT_MOIS);
    expect(cells[RATE_EXPORT_ANNUAL_HEADER]).toBe(24);
    expect(cells[RATE_EXPORT_MONTHLY_HEADER]).toBe(2);
  });

  it('écrit « non servi » plutôt qu’un 0 qui entrerait dans une moyenne', () => {
    const cells = loanRateExportCells(PRET_HERITE);
    expect(cells[RATE_EXPORT_ANNUAL_HEADER]).toBe(RATE_NOT_SERVED);
    expect(cells[RATE_EXPORT_MONTHLY_HEADER]).toBe(1.5);
  });

  it('exporte un taux de 0 % comme un nombre — c’est une mesure', () => {
    const cells = loanRateExportCells({ rate: 0, annualRate: 0 });
    expect(cells[RATE_EXPORT_ANNUAL_HEADER]).toBe(0);
    expect(cells[RATE_EXPORT_MONTHLY_HEADER]).toBe(0);
  });
});
