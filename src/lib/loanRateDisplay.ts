/**
 * Taux d'un prêt du portefeuille À L'ÉCRAN — le pendant front de
 * `backend/portfolio/rates.py`.
 *
 * Ce qui a rendu ce fichier nécessaire
 * ------------------------------------
 * `portfolio.Loan.rate` est un taux **MENSUEL** en points de pourcentage. Trois
 * surfaces l'affichaient sous une colonne nommée « Taux », sans unité : la table
 * d'administration des crédits, la ligne de cette table, et l'export Excel
 * `rapport_credits.xlsx`. Un gestionnaire qui lit « 2 % » sur un dossier lit un
 * taux annuel — c'est la convention de lecture universelle d'un taux de crédit —
 * alors que la valeur vaut 2 %/mois, soit **24 %/an**. Le même champ était déjà
 * correctement libellé « Taux Mensuel (%) » dans un modal : l'unité était donc
 * connue de l'équipe, simplement pas dite partout. Un chiffre juste sous un
 * libellé faux est plus dangereux qu'un chiffre absent, et il partait dans un
 * classeur qui survit à l'écran qui l'a produit.
 *
 * Les trois règles que ce module impose
 * -------------------------------------
 * 1. **L'unité se LIT, elle ne se devine pas.** `loan_row()` et `config_payload()`
 *    servent désormais QUATRE champs : `rate` + `rateUnit`, `annualRate` +
 *    `annualRateUnit`. Le suffixe affiché (« %/mois », « %/an ») vient de l'unité
 *    DÉCLARÉE, jamais du nom du champ — exactement la discipline de
 *    `investorSpaceWire.rateUnit()`, née du même incident d'un facteur d'écart.
 *
 * 2. **Aucune annualisation dans le navigateur.** `annualRate` est servi : on
 *    l'affiche. On ne le reconstitue pas par `rate × 12`, même si c'est bien la
 *    formule que le serveur applique (`rates.annuel_depuis_mensuel`). La règle
 *    n'est pas « le calcul serait faux » mais « il n'y a qu'UNE source » : deux
 *    chemins vers le même taux annuel, c'est deux taux annuels possibles le jour
 *    où la convention change (capitalisation composée, taux effectif, 360/365).
 *
 * 3. **Un taux absent n'est jamais « 0 » ni un tiret muet.** `annualRate` vaut
 *    `null` sur une ligne héritée que `_accorder_les_taux()` n'a pas encore
 *    complétée. L'écran écrit alors « non servi » et dit pourquoi : un « 0 % »
 *    se lit comme un prêt gratuit, et un « — » se lit comme un bug d'affichage.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Nomenclature d'unités — les codes viennent du serveur, on ne fait que traduire
// ─────────────────────────────────────────────────────────────────────────────

/** `portfolio/serializers.py` → `"rateUnit": "percent_per_month"`. */
export const UNIT_PERCENT_PER_MONTH = 'percent_per_month';
/** `portfolio/serializers.py` → `"annualRateUnit": "percent_per_year"`. */
export const UNIT_PERCENT_PER_YEAR = 'percent_per_year';

/** Suffixe d'affichage par code d'unité SERVI. Un code inconnu s'affiche tel
 *  quel (`label()` de `investorSpaceWire`) : ranger une unité non comprise dans
 *  la case la plus proche est précisément ce qui produit un facteur 12. */
export const RATE_UNIT_SUFFIX: Record<string, string> = {
  [UNIT_PERCENT_PER_MONTH]: '%/mois',
  [UNIT_PERCENT_PER_YEAR]: '%/an',
};

/** Ce qui s'écrit à la place d'un taux que le serveur n'a pas servi. */
export const RATE_NOT_SERVED = 'non servi';

/** Motif servi à l'écran quand `annualRate` manque. Il nomme le champ absent :
 *  un utilisateur qui remonte le problème doit pouvoir citer la clé. */
export const ANNUAL_RATE_MISSING_REASON =
  'Le serveur n’a pas servi de taux annuel pour ce prêt (champ « annualRate » absent). '
  + 'Il n’est pas déduit du taux mensuel ici : l’annualisation appartient au serveur '
  + '(portfolio/rates.py), qui la fige avec le prêt.';

export function rateUnitSuffix(unit: string | null | undefined): string {
  if (!unit) return '%';
  return RATE_UNIT_SUFFIX[unit] ?? unit;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecture d'une valeur — `null` reste `null`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valeur numérique exploitable, ou `null`.
 *
 * `null`, `undefined`, chaîne vide et `NaN` sortent à `null` et **jamais à 0** :
 * `Number(null)` vaut 0 en JavaScript, et c'est par cette conversion silencieuse
 * qu'un taux absent devient « 0 % » à l'écran.
 */
export function toRate(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Taux formaté avec SON unité : « 24,00 %/an ». Absent → « non servi ». */
export function formatRate(
  value: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  const n = toRate(value);
  if (n === null) return RATE_NOT_SERVED;
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)} ${rateUnitSuffix(unit)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecture des deux taux d'un prêt
// ─────────────────────────────────────────────────────────────────────────────

/** Forme minimale attendue — celle de `loan_row()` et de
 *  `config_payload().currentConfig`. Tous les champs sont optionnels : une
 *  source antérieure à la publication des unités reste lisible, et le repli
 *  d'unité est alors explicite plutôt que deviné ligne par ligne. */
export interface RateBearingLoan {
  rate?: number | string | null;
  rateUnit?: string | null;
  annualRate?: number | string | null;
  annualRateUnit?: string | null;
}

export interface LoanRateReading {
  /** Valeur du champ `rate`, telle que servie. `null` si absente. */
  monthly: number | null;
  /** Unité DÉCLARÉE de `rate` (repli documenté si le serveur ne la sert pas). */
  monthlyUnit: string;
  /** « 2,00 %/mois » ou « non servi ». */
  monthlyText: string;
  /** Valeur du champ `annualRate`, telle que servie. Jamais reconstituée. */
  annual: number | null;
  annualUnit: string;
  /** « 24,00 %/an » ou « non servi ». */
  annualText: string;
  /** Vrai quand le serveur a réellement servi `annualRate`. */
  annualServed: boolean;
  /** Motif d'absence, à AFFICHER. `null` quand le taux annuel est servi. */
  annualUnavailableReason: string | null;
  /** Phrase d'infobulle : les deux taux, chacun avec son unité. */
  title: string;
}

/**
 * Les deux taux d'un prêt, chacun avec son unité déclarée.
 *
 * Le repli d'unité est un PARAMÈTRE et non une valeur universelle, pour la même
 * raison que dans `investorSpaceWire.rateUnit()` : le projet stocke des taux
 * dans deux unités, et supposer la mauvaise affiche un facteur 12. Les replis
 * par défaut sont ceux du portefeuille (`rate` mensuel, `annualRate` annuel) et
 * ne servent que face à un serveur antérieur à la publication des unités.
 */
export function readLoanRates(
  loan: RateBearingLoan | null | undefined,
  options: { monthlyUnitFallback?: string; annualUnitFallback?: string } = {},
): LoanRateReading {
  const monthlyUnit = loan?.rateUnit || options.monthlyUnitFallback || UNIT_PERCENT_PER_MONTH;
  const annualUnit = loan?.annualRateUnit || options.annualUnitFallback || UNIT_PERCENT_PER_YEAR;

  const monthly = toRate(loan?.rate);
  const annual = toRate(loan?.annualRate);
  const monthlyText = formatRate(monthly, monthlyUnit);
  const annualText = formatRate(annual, annualUnit);

  return {
    monthly,
    monthlyUnit,
    monthlyText,
    annual,
    annualUnit,
    annualText,
    annualServed: annual !== null,
    annualUnavailableReason: annual === null ? ANNUAL_RATE_MISSING_REASON : null,
    title: `Taux annuel : ${annualText} · taux contractuel saisi : ${monthlyText}. `
      + 'Les deux valeurs sont servies par le serveur ; aucune n’est calculée à l’écran.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Export tabulaire — un classeur survit à l'écran qui l'a produit
// ─────────────────────────────────────────────────────────────────────────────

/** En-têtes de l'export, l'unité DANS le nom de colonne. Une cellule de tableur
 *  se lit sans son écran d'origine : « Taux (%) » n'y dit rien, « Taux annuel
 *  (%/an) » y dit tout. */
export const RATE_EXPORT_ANNUAL_HEADER = 'Taux annuel (%/an)';
export const RATE_EXPORT_MONTHLY_HEADER = 'Taux mensuel (%/mois)';

export interface LoanRateExportCells {
  [RATE_EXPORT_ANNUAL_HEADER]: number | string;
  [RATE_EXPORT_MONTHLY_HEADER]: number | string;
}

/**
 * Les deux cellules de taux d'une ligne d'export.
 *
 * Un taux absent sort en TEXTE (« non servi »), pas en `0` ni en cellule vide :
 * dans un classeur, un zéro entre dans une moyenne et une cellule vide se
 * remplit à la main. Le texte, lui, se voit.
 */
export function loanRateExportCells(loan: RateBearingLoan | null | undefined): LoanRateExportCells {
  const r = readLoanRates(loan);
  return {
    [RATE_EXPORT_ANNUAL_HEADER]: r.annual ?? RATE_NOT_SERVED,
    [RATE_EXPORT_MONTHLY_HEADER]: r.monthly ?? RATE_NOT_SERVED,
  };
}
