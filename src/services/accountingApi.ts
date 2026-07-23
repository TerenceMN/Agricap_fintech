// Couche service DÉDIÉE au socle comptable `/api/accounting/` (HAZINA).
//
// Pourquoi un module séparé de `api.ts` :
//   * `api.ledger.*` sert l'AUTRE socle (`/api/ledger/`, plan SYSCOHADA, devise portée par
//     la pièce). Les deux coexistent volontairement (cf. `backend/accounting/urls.py`) — les
//     confondre dans un même objet `api` inviterait un écran à mélanger deux grands livres.
//   * Ce socle-ci est BI-MONNAIE natif : la devise est portée par la LIGNE, les montants
//     transitent en CHAÎNES Decimal exactes (jamais `float` — un centime qui disparaît sur un
//     solde de grand livre est un incident, pas un arrondi). Le typage l'impose : `Montant`.
//
// Règle non négociable (mission HAZINA / CLAUDE.md §5) : le front SAISIT et AFFICHE, il ne
// CALCULE aucun chiffre comptable. L'équilibre débit=crédit, les totaux, le bilan, le taux de
// change : tout vient du serveur. Les seules fonctions « calculantes » ici sont des
// FORMATEURS et des CONVERSIONS D'UNITÉ d'affichage (chaîne → fr-FR, fraction → %), qui ne
// changent pas la valeur, seulement sa présentation.

import { tokens, refresh } from './oidc';
import { ApiError } from './api';

// ═══════════════════════════════════════════════════════════════════ TYPES

/** Un montant comptable : chaîne Decimal exacte (« 1234.56 »), ou `null` pour une ABSENCE
 *  (une absence n'est pas un zéro — cf. `serializers.montant`). Jamais un `number`. */
export type Montant = string | null;

export type Devise = 'FC' | 'USD';
export type StatutPiece = 'BROUILLON' | 'VALIDEE';
export type StatutDemande = 'EN_ATTENTE' | 'APPROUVEE' | 'REJETEE';
export type CodeJournal = 'JCR' | 'JEP' | 'JCA' | 'JMM' | 'JFX' | 'JIN' | 'JOD';
export type Nature = 'ACTIF' | 'PASSIF' | 'CHARGE' | 'PRODUIT';

/** Enveloppe paginée standard du socle (`results` + total réel). */
export interface Page<T> {
  results: T[];
  total_rows: number;
  limit: number;
  offset: number;
}

// ── Plan comptable ──────────────────────────────────────────────────────────
export interface Compte {
  code: string;
  racine: string;
  intitule: string;
  classe: number;
  nature: Nature;
  devise: string;
  estTransitoire: boolean;
  cantonnement: string;
  actif: boolean;
  parent: number | null;
}

export interface SoldeCompte {
  devise: string;
  solde: Montant;
}

export interface CompteDetail extends Compte {
  mouvemente: boolean;
  soldes: SoldeCompte[];
}

export interface DemandeCompte {
  id: number;
  code: string;
  racine: string;
  intitule: string;
  classe: number;
  nature: Nature;
  devise: string;
  estTransitoire: boolean;
  cantonnement: string;
  parentCode: string;
  justification: string;
  statut: StatutDemande;
  demandePar: string;
  demandeLe: string | null;
  decidePar: string;
  decideLe: string | null;
  motifDecision: string;
  compte: string | null;
}

// ── Pièces et lignes ────────────────────────────────────────────────────────
export interface Ligne {
  id: number;
  compte: string;
  intitule: string;
  devise: string;
  debit: Montant;
  credit: Montant;
  libelle: string;
  ordre: number;
}

/** Total PAR DEVISE d'une pièce, avec le verdict d'équilibre CALCULÉ PAR LE SERVEUR. */
export interface TotalPieceParDevise {
  devise: string;
  debit: Montant;
  credit: Montant;
  equilibre: boolean;
}

export interface Taux {
  id: number;
  dateTaux: string | null;
  usage: 'OPERATIONNEL' | 'CLOTURE';
  deviseBase: string;
  deviseContre: string;
  taux: Montant;
  source: 'BCC' | 'INTERNE' | 'MARCHE';
  sourceReference: string;
  saisiPar: string;
  validePar: string;
  creeLe: string | null;
}

export interface TauxAvecProvenance extends Taux {
  provenance: string;
}

export interface Piece {
  reference: string;
  dateOperation: string | null;
  journal: CodeJournal;
  libelle: string;
  statut: StatutPiece;
  evenement: string;
  saisieManuelle: boolean;
  motif: string;
  origineType: string;
  origineId: string;
  creePar: string;
  creeLe: string | null;
  validePar: string;
  valideLe: string | null;
  pieceContrepassee: string | null;
  pieceRectifiee: string | null;
  tauxChange: Taux | null;
  lignes?: Ligne[];
  totaux?: TotalPieceParDevise[];
}

export interface PieceDetail extends Piece {
  lignes: Ligne[];
  totaux: TotalPieceParDevise[];
  contrepassations: string[];
  rectifications: string[];
  residuFx?: Montant;
  residuFxProbleme?: string;
}

export interface ResultatContrepassation {
  origine: string;
  contrepassation: PieceDetail;
  rectification: PieceDetail | null;
}

// ── Catalogue ───────────────────────────────────────────────────────────────
export interface SchemaLigne {
  ordre: number;
  sens: 'DEBIT' | 'CREDIT';
  compteRacine: string;
  deviseRegle: string;
  montantRef: string;
  condition: string;
  libelle: string;
}

export interface Schema {
  code: string;
  libelle: string;
  journal: CodeJournal;
  description: string;
  actif: boolean;
  version: number;
  lignes: SchemaLigne[];
}

// ── Restitutions ────────────────────────────────────────────────────────────
export interface LigneBalance {
  code: string;
  intitule: string;
  nature: Nature;
  devise: string;
  debit: Montant;
  credit: Montant;
  solde: Montant;
}

export interface Balance {
  devise: string;
  asOf: string | null;
  results: LigneBalance[];
  total_rows: number;
  totalDebit: Montant;
  totalCredit: Montant;
  equilibree: boolean;
}

export interface MouvementGrandLivre {
  date: string | null;
  reference: string;
  journal: CodeJournal;
  evenement: string;
  libelle: string;
  debit: Montant;
  credit: Montant;
  solde: Montant;
}

export interface GrandLivre {
  compte: string;
  devise: string;
  debut: string | null;
  fin: string | null;
  report: Montant;
  mouvements: MouvementGrandLivre[];
  totalRows: number;
  totalDebit: Montant;
  totalCredit: Montant;
  solde: Montant;
}

export interface JournalDevise {
  devise: string;
  debit: Montant;
  credit: Montant;
  equilibre: boolean;
}

export interface JournalAuxiliaire {
  journal: CodeJournal;
  libelle: string;
  nombrePieces: number;
  devises: JournalDevise[];
}

export interface Journaux {
  results: JournalAuxiliaire[];
  total_rows: number;
  debut: string | null;
  fin: string | null;
}

export interface AnomalieIntegrite {
  pieceId: number;
  reference: string;
  devise: string;
  debit: Montant;
  credit: Montant;
  ecart: Montant;
}

export interface ControleIntegrite {
  results: AnomalieIntegrite[];
  total_rows: number;
  conforme: boolean;
}

export interface AnomalieFx {
  reference: string;
  statut: StatutPiece;
  ageHeures: number;
  residu: Montant;
  probleme: string;
}

export interface SoldeTransitoire {
  devise: string;
  solde: Montant;
}

export interface ControleFx {
  ageHeures: number;
  results: AnomalieFx[];
  total_rows: number;
  soldesTransitoire: SoldeTransitoire[];
  positionContreValeur: Montant;
  tauxUtilise: string | null;
  devisePivot: string;
  note: string;
}

// ── Provisions ──────────────────────────────────────────────────────────────
export interface ClasseRisque {
  code: string;
  libelle: string;
  joursMin: number;
  joursMax: number | null;
  tauxProvision: Montant;
  enSouffrance: boolean;
  ordre: number;
  actif: boolean;
  modifiePar: string;
  modifieLe: string | null;
}

export interface ClassesRisque {
  results: ClasseRisque[];
  total_rows: number;
  couvertureValide: boolean;
  couvertureProbleme: string;
}

export interface CreditClasse {
  loanId: number;
  reference: string;
  operateur: string;
  statutPortefeuille: string;
  devise: string;
  decaisse: Montant;
  regle: Montant;
  capitalRembourse: Montant;
  encours: Montant;
  joursRetard: number;
  premiereEcheanceImpayee: string | null;
  classe: string;
  tauxProvision: Montant;
  provision: Montant;
  enSouffrance: boolean;
  anomalies: string[];
}

export interface SyntheseProvisionLigne {
  classe: string;
  libelle: string;
  tauxProvision: Montant;
  nombre: number;
  encours: Montant;
  provision: Montant;
}

export interface SyntheseProvision {
  devise: string;
  nombreCredits: number;
  encoursTotal: Montant;
  provisionRequise: Montant;
  provisionComptabilisee: Montant;
  encoursComptable: Montant;
  encoursARisque30j: Montant;
  par30Ratio: Montant;
  lignes: SyntheseProvisionLigne[];
}

export interface Classification {
  asOf: string | null;
  grille: ClasseRisque[];
  credits: CreditClasse[];
  totalRows: number;
  synthese: SyntheseProvision[];
  anomalies: string[];
}

export interface LigneArrete {
  classe: string;
  nombreCredits: number;
  encours: Montant;
  tauxApplique: Montant;
  provision: Montant;
}

export interface ArreteProvision {
  id: number;
  dateArrete: string | null;
  devise: string;
  provisionRequise: Montant;
  provisionAnterieure: Montant;
  dotation: Montant;
  reprise: Montant;
  encoursPortefeuille: Montant;
  encoursComptable: Montant;
  nombreCredits: number;
  piece: string | null;
  creePar: string;
  creeLe: string | null;
  lignes: LigneArrete[];
}

export interface ArretesProvision {
  results: ArreteProvision[];
  total_rows: number;
}

export interface ClassementCredit {
  id: number;
  dateArrete: string | null;
  loanId: number;
  reference: string;
  classe: string;
  joursRetard: number;
  encours: Montant;
  devise: string;
  enSouffrance: boolean;
  pieceDeclassement: string | null;
  creePar: string;
  creeLe: string | null;
}

export interface Classements {
  results: ClassementCredit[];
  total_rows: number;
}

export interface DeclassementArrete {
  reference: string;
  devise: string;
  encours: Montant;
  joursRetard: number;
  classe: string;
  piece: string | null;
}

export interface ArreteDevise {
  devise: string;
  provisionRequise: Montant;
  provisionAnterieure: Montant;
  dotation: Montant;
  reprise: Montant;
  piece: string | null;
  encoursPortefeuille: Montant;
  encoursComptable: Montant;
  ecartEncours: Montant;
}

export interface ResultatArrete {
  dateArrete: string | null;
  declassements: DeclassementArrete[];
  arretes: ArreteDevise[];
  anomalies: string[];
}

// ── États financiers ────────────────────────────────────────────────────────
export interface Poste {
  code: string;
  intitule: string;
  nature: Nature;
  debit: Montant;
  credit: Montant;
  soldeSigne: Montant;
  montant: Montant;
}

export interface Bilan {
  devise: string;
  asOf: string | null;
  actif: Poste[];
  passif: Poste[];
  totalActif: Montant;
  totalPassif: Montant;
  resultatExercice: Montant;
  totalPassifEtResultat: Montant;
  ecartBouclage: Montant;
  boucle: boolean;
}

export interface CompteDeResultat {
  devise: string;
  asOf: string | null;
  charges: Poste[];
  produits: Poste[];
  totalCharges: Montant;
  totalProduits: Montant;
  resultat: Montant;
}

export interface TauxCloture {
  id: number;
  dateTaux: string | null;
  usage: string;
  deviseBase: string;
  deviseContre: string;
  taux: Montant;
  source: string;
  sourceReference: string;
  provenance: string;
}

export interface EtatsConsolides {
  asOf: string | null;
  tauxCloture: TauxCloture;
  parDevise: Record<string, { bilan: Bilan; resultat: CompteDeResultat }>;
  consolide: {
    devisePivot: string;
    totalActif: Montant;
    totalPassif: Montant;
    totalCharges: Montant;
    totalProduits: Montant;
    resultat: Montant;
    totalPassifEtResultat: Montant;
    ecartBouclage: Montant;
    boucle: boolean;
  };
  avertissements: string[];
}

// ═══════════════════════════════════════════════════ PAYLOADS D'ÉCRITURE

/** Une ligne saisie à la main dans une OD (les montants restent des CHAÎNES : ce que
 *  l'utilisateur tape, transmis tel quel, arbitré par le serveur — le front ne totalise pas). */
export interface LigneSaisie {
  compte: string;
  devise: string;
  debit?: string;
  credit?: string;
  libelle?: string;
}

export interface SaisieOD {
  libelle: string;
  lignes: LigneSaisie[];
  journal?: string;
  dateOperation?: string;
  reference?: string;
  motif?: string;
  origineType?: string;
  origineId?: string;
}

export interface Contrepassation {
  motif?: string;
  lignesRectificatives?: LigneSaisie[];
  referenceContrepassation?: string;
  referenceRectification?: string;
  dateOperation?: string;
}

export interface DemandeCompteInput {
  code: string;
  racine: string;
  intitule: string;
  classe: number;
  nature: Nature;
  devise?: string;
  estTransitoire?: boolean;
  cantonnement?: string;
  parentCode?: string;
  justification: string;
}

export interface ModifClasseRisque {
  libelle?: string;
  joursMin?: number;
  joursMax?: number | null;
  tauxProvision?: string;
  enSouffrance?: boolean;
  ordre?: number;
  actif?: boolean;
}

// ═══════════════════════════════════════════════════════════════ HTTP

interface RequestOpts {
  method?: string;
  body?: unknown;
  retry?: boolean;
}

/**
 * Requête vers `/api/accounting/…`.
 *
 * Volontairement autonome (le `request` de `api.ts` n'est pas exporté et `api.ts` appartient à
 * un autre agent — on ne l'édite pas). On reproduit fidèlement son contrat d'erreur, car les
 * écrans comptables dépendent du dépliage du 422 `{code, message}` (déséquilibre, maker=checker,
 * couverture PAR incomplète…) : `ApiError.errors` porte chaque refus avec son propre code.
 */
async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = 'GET', body, retry = true } = opts;
  const headers: Record<string, string> = {};
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && (await refresh())) {
    return request<T>(path, { ...opts, retry: false });
  }
  if (!res.ok) {
    let detail = '';
    let code: string | null = null;
    let errors: Array<{ code: string; message: string }> = [];
    try {
      const corps = (await res.json()) as {
        detail?: string;
        code?: string;
        structureError?: string;
        errors?: Array<string | { code?: string; message?: string }>;
      };
      detail = corps.detail || corps.structureError || detail;
      code = corps.code ?? null;
      if (Array.isArray(corps.errors)) {
        errors = corps.errors.map((e) =>
          typeof e === 'string'
            ? { code: 'ERREUR', message: e }
            : { code: e.code || 'ERREUR', message: e.message || '' });
        if (!detail && errors.length) detail = errors[0].message;
      }
    } catch {
      /* corps non-JSON : repli ci-dessous */
    }
    if (!detail) detail = `Erreur ${res.status}`;
    // eslint-disable-next-line no-console
    console.warn(`[ACC] ${method} ${path} -> ${res.status}${code ? ` [${code}]` : ''} ${detail}`);
    throw new ApiError(res.status, detail, code, errors);
  }
  const ct = res.headers.get('content-type') || '';
  return (ct.includes('application/json') ? await res.json() : (res as unknown)) as T;
}

/** Sérialise des filtres en query-string en IGNORANT les valeurs vides (`undefined`, `null`,
 *  `''`) — un filtre absent ne doit pas partir en `?x=` et fausser la requête serveur. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(params)) {
    if (valeur !== undefined && valeur !== null && valeur !== '') u.set(cle, String(valeur));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

// ═══════════════════════════════════════════════════ FORMATAGE (AFFICHAGE)

/** Sépare une chaîne Decimal en `{ signe, entier, frac }` — ou `null` si non parsable. On
 *  travaille sur la CHAÎNE (jamais `Number`) : un solde à 18 chiffres perdrait des unités en
 *  passant par un `double`. */
function decomposer(valeur: string): { signe: string; entier: string; frac: string } | null {
  const m = /^\s*([+-]?)(\d+)(?:[.](\d*))?\s*$/.exec(valeur);
  if (!m) return null;
  return { signe: m[1] === '-' ? '-' : '', entier: m[2], frac: m[3] || '' };
}

/** Groupe l'entier par milliers avec une espace fine (séparateur fr-FR). */
function grouperMilliers(entier: string): string {
  return entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Formate un montant Decimal (chaîne) pour l'affichage fr-FR : espace fine aux milliers,
 * virgule décimale. `null`/vide → tiret (une absence n'est pas un zéro). Une valeur non
 * parsable est rendue TELLE QUELLE plutôt que « NaN » — on n'invente rien.
 *
 * @param decimales Force le nombre de décimales (complète/tronque). Absent = préserve
 *   exactement ce que le serveur a envoyé (le socle quantifie déjà à 0,01).
 */
export function formatMontant(
  valeur: Montant,
  options: { devise?: string | null; vide?: string; decimales?: number } = {},
): string {
  const { devise, vide = '—', decimales } = options;
  if (valeur === null || valeur === undefined || valeur === '') return vide;
  const parts = decomposer(String(valeur));
  if (parts === null) return String(valeur);
  let { frac } = parts;
  const { signe, entier } = parts;
  if (decimales !== undefined) {
    frac = frac.slice(0, decimales).padEnd(decimales, '0');
  }
  const corps = frac ? `${grouperMilliers(entier)},${frac}` : grouperMilliers(entier);
  const texte = `${signe}${corps}`;
  return devise ? `${texte} ${devise}` : texte;
}

/** Montant suivi de sa devise — jamais un montant nu quand la devise est connue (un montant
 *  sans devise n'existe pas dans un système bi-monnaie). */
export function formatMontantDevise(
  valeur: Montant,
  devise: string | null | undefined,
  options: { vide?: string; decimales?: number } = {},
): string {
  return formatMontant(valeur, { ...options, devise });
}

/**
 * Convertit une FRACTION serveur (« 0.2500 ») en pourcentage d'affichage (« 25,00 % »).
 * C'est une conversion d'UNITÉ (× 100 = décalage de la virgule de 2 rangs), pas un calcul
 * métier : la valeur ne change pas, seule sa présentation. Exact via manipulation de chaîne.
 */
export function pourcentDepuisFraction(valeur: Montant, decimales = 2): string {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  const parts = decomposer(String(valeur));
  if (parts === null) return String(valeur);
  const { signe, entier, frac } = parts;
  const chiffres = entier + frac; // suppression du point
  const pointInitial = entier.length;
  const nouveauPoint = pointInitial + 2; // × 100
  let nEntier: string;
  let nFrac: string;
  if (nouveauPoint >= chiffres.length) {
    nEntier = chiffres + '0'.repeat(nouveauPoint - chiffres.length);
    nFrac = '';
  } else {
    nEntier = chiffres.slice(0, nouveauPoint);
    nFrac = chiffres.slice(nouveauPoint);
  }
  nEntier = nEntier.replace(/^0+(?=\d)/, '') || '0';
  nFrac = nFrac.slice(0, decimales).padEnd(decimales, '0');
  const corps = nFrac ? `${nEntier},${nFrac}` : nEntier;
  return `${signe}${corps} %`;
}

// ═══════════════════════════════════════════════════ LIBELLÉS (jamais deviner)
//
// Le backend est la nomenclature canonique ; le front MAPPE pour l'affichage. Un code inconnu
// est rendu TEL QUEL — jamais deviné, jamais masqué (un statut inventé ment à l'auditeur).

function libelleDepuis(table: Record<string, string>, code: string | null | undefined): string {
  if (!code) return '—';
  return table[code] ?? code;
}

const JOURNAUX: Record<string, string> = {
  JCR: 'Journal crédit',
  JEP: 'Journal épargne',
  JCA: 'Journal caisse',
  JMM: 'Journal mobile money',
  JFX: 'Journal change',
  JIN: 'Journal investissement',
  JOD: 'Journal opérations diverses',
};
export const libelleJournal = (code: string | null | undefined): string => libelleDepuis(JOURNAUX, code);

const STATUTS_PIECE: Record<string, string> = {
  BROUILLON: 'Brouillon',
  VALIDEE: 'Validée',
};
export const libelleStatutPiece = (code: string | null | undefined): string =>
  libelleDepuis(STATUTS_PIECE, code);

const STATUTS_DEMANDE: Record<string, string> = {
  EN_ATTENTE: 'En attente',
  APPROUVEE: 'Approuvée',
  REJETEE: 'Rejetée',
};
export const libelleStatutDemande = (code: string | null | undefined): string =>
  libelleDepuis(STATUTS_DEMANDE, code);

const NATURES: Record<string, string> = {
  ACTIF: 'Actif',
  PASSIF: 'Passif',
  CHARGE: 'Charge',
  PRODUIT: 'Produit',
};
export const libelleNature = (code: string | null | undefined): string => libelleDepuis(NATURES, code);

const USAGES_TAUX: Record<string, string> = {
  OPERATIONNEL: 'Opérationnel',
  CLOTURE: 'Clôture',
};
export const libelleUsageTaux = (code: string | null | undefined): string =>
  libelleDepuis(USAGES_TAUX, code);

const SOURCES_TAUX: Record<string, string> = {
  BCC: 'Banque Centrale du Congo',
  INTERNE: 'Décision interne',
  MARCHE: 'Marché parallèle',
};
export const libelleSourceTaux = (code: string | null | undefined): string =>
  libelleDepuis(SOURCES_TAUX, code);

const SENS: Record<string, string> = { DEBIT: 'Débit', CREDIT: 'Crédit' };
export const libelleSens = (code: string | null | undefined): string => libelleDepuis(SENS, code);

// ═══════════════════════════════════════════════════ LECTURE DES VERDICTS SERVEUR
//
// Ces fonctions ne CALCULENT pas : elles LISENT les verdicts déjà rendus par le serveur
// (`equilibre` par devise) et les agrègent booléennement pour l'affichage.

/** Une pièce est équilibrée si TOUTES ses devises le sont — d'après les drapeaux `equilibre`
 *  posés par le serveur, jamais en re-sommant les lignes côté client. `undefined`/vide → on
 *  ne sait pas (`null`), on n'affiche donc pas un verdict inventé. */
export function pieceEquilibree(totaux: TotalPieceParDevise[] | undefined): boolean | null {
  if (!totaux || totaux.length === 0) return null;
  return totaux.every((t) => t.equilibre);
}

/** Déplie une `ApiError` en liste de `{code, message}` pour l'affichage — un 422 multi-erreurs
 *  restitue chaque refus ; sinon on retombe sur le message principal. */
export function deplierErreur(err: unknown): Array<{ code: string; message: string }> {
  if (err instanceof ApiError) {
    if (err.errors && err.errors.length) return err.errors;
    return [{ code: err.code ?? 'ERREUR', message: err.message }];
  }
  return [{ code: 'ERREUR', message: err instanceof Error ? err.message : String(err) }];
}

// ═══════════════════════════════════════════════════════════ API (28 ROUTES)

export const accountingApi = {
  // ── Plan comptable ────────────────────────────────────────────────────────
  comptes: {
    /** GET /accounting/comptes — filtres : classe, devise, nature, actif, cantonnement, q. */
    list: (params: {
      classe?: number; devise?: string; nature?: string; actif?: boolean;
      cantonnement?: string; q?: string; limit?: number; offset?: number;
    } = {}) => request<Page<Compte>>(`/accounting/comptes${qs(params)}`),

    /** GET /accounting/comptes/<code> — inclut `mouvemente` et les `soldes` par devise. */
    detail: (code: string) => request<CompteDetail>(`/accounting/comptes/${encodeURIComponent(code)}`),

    /** POST /accounting/comptes/<code>/activation — PARAMÉTRER (config). */
    activation: (code: string, actif: boolean, motif = '') =>
      request<Compte>(`/accounting/comptes/${encodeURIComponent(code)}/activation`, {
        method: 'POST', body: { actif, motif },
      }),

    /** DELETE /accounting/comptes/<code>/suppression — répond TOUJOURS 409 (append-only) : la
     *  suppression n'existe pas en comptabilité. Exposé pour restituer la RÈGLE, pas pour agir. */
    suppression: (code: string) =>
      request<never>(`/accounting/comptes/${encodeURIComponent(code)}/suppression`, { method: 'DELETE' }),

    demandes: {
      /** GET /accounting/comptes/demandes — file des demandes d'ouverture (read). */
      list: (params: { statut?: string; limit?: number; offset?: number } = {}) =>
        request<Page<DemandeCompte>>(`/accounting/comptes/demandes${qs(params)}`),
      /** POST /accounting/comptes/demandes — MAKER décrit un compte (create). */
      create: (data: DemandeCompteInput) =>
        request<DemandeCompte>('/accounting/comptes/demandes', { method: 'POST', body: data }),
      /** POST /accounting/comptes/demandes/<id>/decision — CHECKER décide (config). */
      decision: (id: number, approuver: boolean, motif = '') =>
        request<DemandeCompte>(`/accounting/comptes/demandes/${id}/decision`, {
          method: 'POST', body: { approuver, motif },
        }),
    },
  },

  // ── Catalogue d'écritures (annexe B) ──────────────────────────────────────
  /** GET /accounting/catalogue — schémas B1…B16 (read-only). */
  catalogue: (params: { actif?: boolean } = {}) =>
    request<{ results: Schema[]; total_rows: number }>(`/accounting/catalogue${qs(params)}`),

  // ── Pièces et lignes ──────────────────────────────────────────────────────
  pieces: {
    /** GET /accounting/pieces — filtres nombreux ; `lignes=true` inclut les lignes+totaux. */
    list: (params: {
      debut?: string; fin?: string; journal?: string; statut?: string; evenement?: string;
      reference?: string; compte?: string; devise?: string; origineType?: string;
      origineId?: string; limit?: number; offset?: number; lignes?: boolean;
    } = {}) => request<Page<Piece>>(`/accounting/pieces${qs(params)}`),

    /** GET /accounting/pieces/<reference> — détail complet (lignes, totaux, liens, résidu FX). */
    detail: (reference: string) =>
      request<PieceDetail>(`/accounting/pieces/${encodeURIComponent(reference)}`),

    /** POST /accounting/pieces/od — MAKER saisit une OD en BROUILLON (create). Cantonnée à JOD.
     *  Le serveur arbitre l'équilibre : un déséquilibre revient en 422, pas un total client. */
    od: (data: SaisieOD) => request<Piece>('/accounting/pieces/od', { method: 'POST', body: data }),

    /** POST /accounting/pieces/<reference>/validation — CHECKER valide (validate).
     *  Le service refuse que le maker se valide lui-même. */
    valider: (reference: string) =>
      request<Piece>(`/accounting/pieces/${encodeURIComponent(reference)}/validation`, {
        method: 'POST', body: {},
      }),

    /** POST /accounting/pieces/<reference>/contrepassation — CHECKER contrepasse (validate). */
    contrepasser: (reference: string, data: Contrepassation = {}) =>
      request<ResultatContrepassation>(
        `/accounting/pieces/${encodeURIComponent(reference)}/contrepassation`,
        { method: 'POST', body: data },
      ),
  },

  // ── Restitutions ──────────────────────────────────────────────────────────
  /** GET /accounting/journaux — journaux auxiliaires (totaux par devise, équilibre serveur). */
  journaux: (params: { debut?: string; fin?: string } = {}) =>
    request<Journaux>(`/accounting/journaux${qs(params)}`),

  /** GET /accounting/balance — `devise` OBLIGATOIRE. Totaux et verdict d'équilibre serveur. */
  balance: (params: { devise: string; as_of?: string }) =>
    request<Balance>(`/accounting/balance${qs(params)}`),

  /** GET /accounting/grand-livre — `compte` ET `devise` OBLIGATOIRES. */
  grandLivre: (params: { compte: string; devise: string; debut?: string; fin?: string }) =>
    request<GrandLivre>(`/accounting/grand-livre${qs(params)}`),

  controles: {
    /** GET /accounting/controles/integrite — pièces déséquilibrées (doit être vide). */
    integrite: (params: { as_of?: string } = {}) =>
      request<ControleIntegrite>(`/accounting/controles/integrite${qs(params)}`),
    /** GET /accounting/controles/fx — rapprochement 588FX (pièces non dénouées + âge). */
    fx: (params: { ageHeures?: number } = {}) =>
      request<ControleFx>(`/accounting/controles/fx${qs(params)}`),
  },

  // ── Taux de change : LECTURE SEULE (gouvernance dans /api/fx/) ─────────────
  taux: {
    /** GET /accounting/taux — projection en lecture seule des taux APPLIQUÉS aux écritures. */
    list: (params: { usage?: string; debut?: string; fin?: string; limit?: number; offset?: number } = {}) =>
      request<Page<TauxAvecProvenance> & { saisie: string }>(`/accounting/taux${qs(params)}`),
    /** POST/PUT/PATCH/DELETE /accounting/taux/saisie — répond 409 : la saisie vit dans /api/fx/.
     *  Exposé pour restituer la RÈGLE plutôt qu'un 404 ambigu. */
    saisieInterdite: () => request<never>('/accounting/taux/saisie', { method: 'POST', body: {} }),
  },

  // ── Provisionnement PAR ───────────────────────────────────────────────────
  provisions: {
    classes: {
      /** GET /accounting/provisions/classes — grille PAR + validité de la couverture [0,∞[. */
      list: (params: { actives?: boolean } = {}) =>
        request<ClassesRisque>(`/accounting/provisions/classes${qs(params)}`),
      /** PATCH /accounting/provisions/classes/<code> — PARAMÉTRER (config). */
      update: (code: string, data: ModifClasseRisque) =>
        request<ClasseRisque>(`/accounting/provisions/classes/${encodeURIComponent(code)}`, {
          method: 'PATCH', body: data,
        }),
    },
    /** GET /accounting/provisions/classification — SIMULATION lecture seule (n'écrit rien). */
    classification: (params: { as_of?: string } = {}) =>
      request<Classification>(`/accounting/provisions/classification${qs(params)}`),
    arretes: {
      /** GET /accounting/provisions/arretes — historique des clôtures de provisionnement. */
      list: (params: { devise?: string; limit?: number } = {}) =>
        request<ArretesProvision>(`/accounting/provisions/arretes${qs(params)}`),
      /** POST /accounting/provisions/arretes — CHECKER passe l'arrêté (validate) : ACTE écrivant. */
      create: (data: { dateArrete?: string; prefixe?: string } = {}) =>
        request<ResultatArrete>('/accounting/provisions/arretes', { method: 'POST', body: data }),
    },
    /** GET /accounting/provisions/classements — photos datées de classification par crédit. */
    classements: (params: { dateArrete?: string; reference?: string; limit?: number } = {}) =>
      request<Classements>(`/accounting/provisions/classements${qs(params)}`),
  },

  // ── États financiers ──────────────────────────────────────────────────────
  etats: {
    /** GET /accounting/etats/bilan — `devise` OBLIGATOIRE. */
    bilan: (params: { devise: string; as_of?: string }) =>
      request<Bilan>(`/accounting/etats/bilan${qs(params)}`),
    /** GET /accounting/etats/resultat — `devise` OBLIGATOIRE. */
    resultat: (params: { devise: string; as_of?: string }) =>
      request<CompteDeResultat>(`/accounting/etats/resultat${qs(params)}`),
    /** GET /accounting/etats/consolide — `as_of` OBLIGATOIRE (rattaché à un taux de clôture daté). */
    consolide: (params: { as_of: string }) =>
      request<EtatsConsolides>(`/accounting/etats/consolide${qs(params)}`),
  },
};

export { ApiError };
