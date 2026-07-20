/**
 * Nomenclature canonique des garanties — SPEC §2.2, principe 6 (« une seule
 * nomenclature par concept », le backend fait foi).
 *
 * Codes de stockage : `epargne`, `morale`, `materiel`, `foncier`.
 * Ce sont exactement les valeurs de `CreditGuarantee.GuaranteeType` et de
 * `ValueChain.eligible_guarantees` côté Django.
 *
 * Le prototype Horizons manipulait six libellés parallèles
 * (`actif`, `immobilier`, `epargne`, `morale`, `Gage matériel`, `Hypothèque`).
 * Les deux premiers et les deux derniers ne sont plus que des **alias
 * d'affichage** résolus par `canonicalGuaranteeType()` : ils ne sont jamais
 * envoyés au backend ni stockés.
 */
import { Building2, Package, PiggyBank, HeartHandshake, Shield } from 'lucide-react';

/** Les 4 codes canoniques, dans l'ordre d'affichage du parcours client. */
export const GUARANTEE_CONFIG = {
  epargne: {
    code: 'epargne',
    label: 'Nantissement Épargne',
    short: 'Épargne',
    icon: PiggyBank,
    color: '#ec4899',
    description:
      "Blocage d'une partie de votre épargne AGRICAP pendant la durée du crédit.",
  },
  morale: {
    code: 'morale',
    label: 'Caution Solidaire',
    short: 'Caution',
    icon: HeartHandshake,
    color: '#10b981',
    description:
      "Engagement d'un garant membre de votre groupe ou de votre coopérative.",
  },
  materiel: {
    code: 'materiel',
    label: 'Gage matériel',
    short: 'Matériel',
    icon: Package,
    color: '#3b82f6',
    description:
      'Gage sur un bien mobilier enregistré et vérifié : équipement, véhicule, stock.',
  },
  foncier: {
    code: 'foncier',
    label: 'Hypothèque / Foncier',
    short: 'Foncier',
    icon: Building2,
    color: '#8b5cf6',
    description:
      'Hypothèque sur un bien immobilier enregistré et vérifié : terrain, bâtiment.',
  },
};

export const GUARANTEE_CODES = ['epargne', 'morale', 'materiel', 'foncier'];

/**
 * Alias d'affichage hérités du prototype ou de la catégorie d'un actif.
 * Aucun de ces libellés n'est un code de stockage.
 */
const ALIASES = {
  actif: 'materiel',
  immobilier: 'foncier',
  'gage matériel': 'materiel',
  'gage materiel': 'materiel',
  hypothèque: 'foncier',
  hypotheque: 'foncier',
  // Catégories d'actifs → type de garantie résultant (miroir de
  // `Asset.guarantee_type` côté backend, qui reste la source de vérité :
  // `AssetRow.guaranteeType` est toujours préféré quand il est présent).
  vehicule: 'materiel',
  stock: 'materiel',
};

/**
 * Résout un type quelconque (canonique ou alias) vers son code canonique.
 * @param {string|null|undefined} raw
 * @returns {string|null} code canonique, ou null si non résoluble
 */
export function canonicalGuaranteeType(raw) {
  if (!raw) return null;
  const key = String(raw).trim();
  if (GUARANTEE_CONFIG[key]) return key;
  return ALIASES[key.toLowerCase()] || null;
}

/**
 * Configuration d'affichage d'un type de garantie, alias compris.
 * @param {string|null|undefined} raw
 * @returns {{code: string|null, label: string, short: string, icon: Function, color: string, description: string}}
 */
export function guaranteeConfig(raw) {
  const code = canonicalGuaranteeType(raw);
  if (code) return GUARANTEE_CONFIG[code];
  return {
    code: null,
    label: raw ? String(raw) : 'Garantie',
    short: raw ? String(raw) : 'Garantie',
    icon: Shield,
    color: '#94a3b8',
    description: '',
  };
}
