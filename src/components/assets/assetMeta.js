/**
 * Catégories et cycle de vie des actifs — miroir strict de `assets.Asset`
 * (backend). Aucune valeur n'est inventée ici : les clés `materiel`, `foncier`,
 * `vehicule`, `stock`, `autre` et les cinq statuts sont ceux de `Asset.Type` et
 * `Asset.Status`.
 */
import { Car, Home, Package, Tractor, Boxes } from 'lucide-react';

/** Catégories déclarables par le client (`Asset.Type`). */
export const ASSET_CATEGORIES = {
  materiel: {
    code: 'materiel',
    label: 'Matériel / Équipement',
    icon: Tractor,
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    guaranteeHint: 'Gage matériel',
  },
  foncier: {
    code: 'foncier',
    label: 'Foncier / Immobilier',
    icon: Home,
    color: 'text-purple-400',
    bg: 'bg-purple-400/10',
    guaranteeHint: 'Hypothèque / Foncier',
  },
  vehicule: {
    code: 'vehicule',
    label: 'Véhicule',
    icon: Car,
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
    guaranteeHint: 'Gage matériel',
  },
  stock: {
    code: 'stock',
    label: 'Stock / Récolte',
    icon: Boxes,
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    guaranteeHint: 'Gage matériel',
  },
  autre: {
    code: 'autre',
    label: 'Autre (non gageable)',
    icon: Package,
    color: 'text-gray-400',
    bg: 'bg-gray-400/10',
    guaranteeHint: null,
  },
};

export const ASSET_CATEGORY_CODES = ['materiel', 'foncier', 'vehicule', 'stock', 'autre'];

/**
 * Cycle de vie à cinq statuts : declare → verifie → gage → libere, plus rejete.
 * `writable` / `deletable` reflètent ce que le backend autorise réellement
 * (409 `ASSET_PLEDGED` sur un actif gagé).
 */
export const ASSET_STATUSES = {
  declare: {
    code: 'declare',
    label: 'Déclaré',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-400',
    accent: 'border-l-amber-500',
    help: "En attente de vérification par un agent de terrain. Tant qu'il n'est pas vérifié, cet actif ne peut pas garantir un crédit.",
    writable: true,
    deletable: true,
  },
  verifie: {
    code: 'verifie',
    label: 'Vérifié',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dot: 'bg-emerald-400',
    accent: 'border-l-emerald-500',
    help: "Contrôlé par un agent : cet actif porte une valeur retenue et peut être mobilisé en garantie.",
    writable: true,
    deletable: true,
  },
  rejete: {
    code: 'rejete',
    label: 'Rejeté',
    badge: 'bg-red-500/15 text-red-300 border-red-500/30',
    dot: 'bg-red-400',
    accent: 'border-l-red-500',
    help: "La vérification n'a pas abouti. Corrigez la déclaration selon le motif indiqué pour repasser en file de vérification.",
    writable: true,
    deletable: true,
  },
  gage: {
    code: 'gage',
    label: 'Gagé',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    dot: 'bg-orange-400',
    accent: 'border-l-orange-500',
    help: "Nanti sur un dossier de crédit en cours. Pièce du dossier : il ne peut être ni modifié ni supprimé tant que le gage n'est pas levé.",
    writable: false,
    deletable: false,
  },
  libere: {
    code: 'libere',
    label: 'Libéré',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    dot: 'bg-sky-400',
    accent: 'border-l-sky-500',
    help: "Le gage a été levé : l'actif redevient mobilisable pour un nouveau crédit.",
    writable: true,
    deletable: true,
  },
};

export const ASSET_STATUS_ORDER = ['declare', 'verifie', 'gage', 'libere', 'rejete'];

/** @param {string|null|undefined} code */
export function assetCategory(code) {
  return ASSET_CATEGORIES[code] || ASSET_CATEGORIES.autre;
}

/** @param {string|null|undefined} code */
export function assetStatus(code) {
  return (
    ASSET_STATUSES[code] || {
      code: code || 'inconnu',
      label: code || 'Inconnu',
      badge: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
      dot: 'bg-slate-400',
      accent: 'border-l-slate-500',
      help: '',
      writable: false,
      deletable: false,
    }
  );
}
