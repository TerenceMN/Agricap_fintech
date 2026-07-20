/**
 * Les 8 modules de la feuille de besoins — nomenclature canonique.
 *
 * CLAUDE.md principe 6 : « le backend définit les codes canoniques ; le front
 * mappe pour l'affichage ». Les codes ci-dessous sont **exactement** ceux de
 * `credits/needs_sheet.py::MODULE_CODES` et de `NeedItem.MODULES`.
 *
 * Ce fichier corrige au passage une divergence silencieuse : `Credits.jsx`
 * indexait sa table d'affichage sur `mainDoeuvre` et `postRecolte` (camelCase)
 * alors que l'API renvoie `maindoeuvre` et `postrecolte`. Le filtre
 * `if (MODULES_CONFIG[mod])` du simulateur faisait donc **disparaître la
 * main-d'œuvre et la post-récolte** des totaux affichés — deux des postes les
 * plus lourds d'un dossier agricole. Les anciennes clés survivent ici comme
 * alias d'affichage (même mécanique que `guaranteeConfig`), le temps que les
 * écrans qui les portent encore soient migrés.
 */
import {
  BarChart, Car, ChevronsRight, FileText, Leaf, Shield, Sparkles, TrendingUp, Users,
} from 'lucide-react';

/** Ordre d'affichage = ordre des rubriques de `5_Synthese_Besoins`. */
export const MODULE_CODES = [
  'semences',
  'mecanisation',
  'maindoeuvre',
  'equipements',
  'postrecolte',
  'logistique',
  'commercialisation',
  'reserve',
];

const MODULES = {
  semences: { label: 'Semences & Intrants', icon: Leaf, color: '#34d399' },
  mecanisation: { label: 'Opérations mécanisées', icon: Sparkles, color: '#60a5fa' },
  maindoeuvre: { label: "Main-d'œuvre", icon: Users, color: '#f87171' },
  equipements: { label: 'Équipement & petit matériel', icon: TrendingUp, color: '#fbbf24' },
  postrecolte: { label: 'Récolte & post-récolte', icon: ChevronsRight, color: '#c084fc' },
  logistique: { label: 'Logistique', icon: Car, color: '#fdba74' },
  commercialisation: { label: 'Commercialisation', icon: BarChart, color: '#a78bfa' },
  reserve: { label: "Réserve d'exploitation", icon: Shield, color: '#9ca3af' },
};

/** Clés héritées du prototype → code canonique. Affichage uniquement. */
const ALIASES = {
  mainDoeuvre: 'maindoeuvre',
  main_doeuvre: 'maindoeuvre',
  'main-doeuvre': 'maindoeuvre',
  postRecolte: 'postrecolte',
  post_recolte: 'postrecolte',
  'post-recolte': 'postrecolte',
};

const FALLBACK = { label: 'Autre poste', icon: FileText, color: '#94a3b8' };

/**
 * Code canonique d'un module, alias résolus. `null` si inconnu.
 * @param {string|null|undefined} code
 * @returns {string|null}
 */
export function canonicalModule(code) {
  if (!code) return null;
  const raw = String(code);
  if (MODULES[raw]) return raw;
  const aliased = ALIASES[raw];
  if (aliased) return aliased;
  // Dernier filet : `Main D'oeuvre`, `POST_RECOLTE`… → comparaison désaccentuée.
  const flat = raw.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return MODULES[flat] ? flat : (ALIASES[flat] ?? null);
}

/**
 * Configuration d'affichage d'un module (libellé, icône, couleur).
 * Ne renvoie jamais `undefined` : un code inconnu obtient un rendu neutre
 * plutôt qu'un écran cassé.
 * @param {string|null|undefined} code
 * @returns {{label: string, icon: Function, color: string}}
 */
export function moduleConfig(code) {
  const canonical = canonicalModule(code);
  if (canonical) return MODULES[canonical];
  return { ...FALLBACK, label: code ? String(code).replace(/_/g, ' ') : FALLBACK.label };
}

export { MODULES as MODULE_DISPLAY };
