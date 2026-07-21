/**
 * Formes de réponse de l'écran « Données de référence » (admin) et helpers de
 * présentation partagés par ses quatre sections.
 *
 * Pourquoi ici et pas dans `src/types/api.ts` : ce fichier appartient à l'agent
 * `front-socle`, qui tient le socle typé et les méthodes d'appel. Cet écran ne
 * l'écrit jamais. Les formes ci-dessous sont donc déclarées localement, lues sur
 * le backend, et les réponses y sont converties explicitement — même convention
 * que `src/pages/credit/wire.ts`. Si `types/api.ts` finit par les porter, ces
 * déclarations disparaissent au profit des siennes.
 *
 * Références backend (lues, pas devinées) :
 *   - `backend/dataio/views_templates.py`   → `templates`, `upload_template`, `activate_template`
 *   - `backend/dataio/services_templates.py`→ `derive_schema`, `diff_schema`, `activate_template`
 *   - `backend/reference_data/views.py`     → `list_value_chains`, `list_uploads`, `upload_reference_file`
 *   - `backend/credits/views.py`            → `list_baremes`, `bareme_detail`, `bareme_preview`, `bareme_activate`
 *   - `backend/credits/baremes.py`          → `previsualiser_impact`, `serialize_bareme`
 *   - `backend/referentiel/views.py`        → `versions`
 *
 * Principe 7 (anti-gaming) : tout ce qui est décrit ici — barèmes, seuils,
 * tolérances, plages, poids — est du référentiel chiffré. Il ne transite que
 * vers du staff. Aucune de ces formes ne doit être importée par un écran client.
 */

// ── 1. Templates de fichiers (principe 11) ───────────────────────────────────

export type TemplateStatus = 'pending' | 'active' | 'archived';

/** Une feuille du schéma dérivé — `services_templates.derive_schema`. */
export interface TemplateSheet {
  name: string;
  position: number;
  columns: string[];
  n_columns: number;
  types: Record<string, string>;
  row_labels: string[];
}

/** Schéma dérivé du template à son activation : c'est LA règle de validation. */
export interface TemplateSchema {
  sheets: TemplateSheet[];
  sheet_names: string[];
  synthesis_sheet: string | null;
  rubriques: string[];
  derived_at: string;
}

/** Diff serveur entre le schéma actif et le schéma proposé (`diff_schema`). */
export interface TemplateDiff {
  sheetsAdded: string[];
  sheetsRemoved: string[];
  sheetsColumnsChanged: string[];
  rubriquesAdded: string[];
  rubriquesRemoved: string[];
  hasPrevious: boolean;
}

/** Ligne de `_template_row`. La LISTE reste volontairement un résumé
 *  (`sheetNames`, `rubriques`) ; le schéma complet et le diff viennent de
 *  `GET /api/dataio/templates/<id>` (`TemplateDetail`). */
export interface TemplateRow {
  id: number;
  kind: string;
  version: number;
  status: TemplateStatus;
  originalName: string;
  sha256: string;
  uploadedBy: string | null;
  uploadedAt: string;
  activatedBy: string | null;
  activatedAt: string | null;
  supersedes: number | null;
  sheetNames: string[];
  rubriques: string[];
  schema?: TemplateSchema;
  diff?: TemplateDiff;
  message?: string;
}

export interface TemplateActiveRef {
  id: number;
  version: number;
  kind: string;
  activatedAt: string | null;
}

export interface TemplateListResponse {
  active: TemplateActiveRef | null;
  templates: TemplateRow[];
}

/**
 * Détail d'un template : `GET /api/dataio/templates/<id>`.
 *
 * Le `diff` est calculé PAR LE SERVEUR (`services_templates.diff_schema`) — le
 * front ne reconstitue jamais un diff de schéma : un diff fabriqué côté client
 * n'est pas la règle de validation, et laisser un checker décider dessus serait
 * pire que l'absence d'information.
 *
 * `diffBaseline.relation` dit CONTRE QUOI le diff a été calculé, au lieu de
 * laisser l'écran le deviner :
 *   - `'active'`      → template `pending` comparé au template ACTIF : c'est
 *                       exactement la question du checker (« qu'est-ce que son
 *                       activation change ? ») ;
 *   - `'supersedes'`  → template `active`/`archived` comparé à celui qu'il a
 *                       remplacé : la trace historique de son activation ;
 *   - `null` (+ `diff.hasPrevious === false`) → tout premier template, rien à
 *                       comparer.
 */
export interface TemplateDiffBaseline {
  id: number | null;
  version: number | null;
  relation: 'active' | 'supersedes' | null;
}

export interface TemplateDetail extends TemplateRow {
  schema: TemplateSchema;
  diff: TemplateDiff;
  diffBaseline: TemplateDiffBaseline;
}

export const DIFF_BASELINE_LABELS: Record<string, string> = {
  active: 'Comparé au template ACTIF — ce que son activation changerait.',
  supersedes: 'Comparé au template qu’il a remplacé — trace de son activation.',
};

/** `dataio/models.py::TEMPLATE_KINDS` — types de fichier client qu'un template
 *  régit. Nomenclature backend (principe 6) : le front mappe l'affichage, il ne
 *  crée pas de code. Aucun endpoint ne les liste ; ce miroir est documenté. */
export const TEMPLATE_KINDS: Array<{ code: string; label: string }> = [
  { code: 'FEUILLE_BESOINS', label: 'Feuille de besoins (client)' },
];

export const TEMPLATE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'En attente d’activation', color: 'text-amber-300 bg-amber-500/20' },
  active: { label: 'Actif', color: 'text-emerald-300 bg-emerald-500/20' },
  archived: { label: 'Archivé', color: 'text-slate-400 bg-slate-500/20' },
};

// ── 2. Filières `ValueChain` (référentiel maker-checker) ─────────────────────

export interface ValueChainRow {
  code: string;
  label: string;
  cycleMonths: number;
  /** `Decimal` sérialisé en chaîne côté serveur — jamais reconverti en `number`
   *  pour du calcul ici (principe 4) : l'écran l'affiche, il ne l'additionne pas. */
  costPerHectareUsd: string;
  costPerHectareCdf: string;
  moduleWeights: Record<string, number>;
  riskFactor: string;
  minScoreRequired: number;
  baseRate: string;
  harvestMonths: number[];
  eligibleGuarantees: string[];
}

export type ReferenceUploadStatus = 'pending_validation' | 'active' | 'archived' | string;

export interface ReferenceUploadRow {
  id: number;
  fileType: string;
  version: string;
  uploadedBy: string;
  uploadedAt: string;
  activatedBy: string | null;
  activatedAt: string | null;
  status: ReferenceUploadStatus;
  rowCount: number;
  /** `diff_summary` du modèle : forme libre côté serveur, rendue génériquement. */
  diff: Record<string, unknown> | null;
}

export interface ReferenceUploadResult {
  valid: boolean;
  uploadId: number;
  status: string;
  rowCount?: number;
  diff?: Record<string, unknown> | null;
  message?: string;
}

export interface ReferenceActivateResult {
  status: string;
  activatedAt: string;
  activatedBy: string;
  chainsCreated: number;
  message: string;
}

/** `reference_data/models.py::ReferenceFileUpload.FileType` — nomenclature backend. */
export const REFERENCE_FILE_TYPES: Array<{ code: string; label: string }> = [
  { code: 'value_chains', label: 'Chaînes de valeur (filières)' },
  { code: 'suppliers', label: 'Fournisseurs agréés' },
  { code: 'rates', label: 'Grille de taux' },
];

export const REFERENCE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_validation: { label: 'En attente d’activation', color: 'text-amber-300 bg-amber-500/20' },
  active: { label: 'Active', color: 'text-emerald-300 bg-emerald-500/20' },
  archived: { label: 'Archivée', color: 'text-slate-400 bg-slate-500/20' },
};

/** `list_uploads` coupe à `qs[:50]` sans indicateur de troncature. */
export const REFERENCE_UPLOADS_CAP = 50;

// ── 3. Barèmes de score (principe 8) ─────────────────────────────────────────

/** Un point de courbe. Le serveur sérialise des `Decimal` : `x`/`y` arrivent en
 *  CHAÎNES depuis `seed_analyse`, en nombres depuis un payload réédité. Les deux
 *  formes sont acceptées en lecture ; l'écran ne fait que les transporter. */
export interface CurvePoint {
  x: string | number;
  y: string | number;
}

export type BaremeRevisionStatus = 'draft' | 'active' | 'archived';

export interface BaremeImpactRow {
  applicationCode: string;
  evaluable: boolean;
  scoreGlobalAvant?: number;
  scoreGlobalApres?: number;
  deltaScore?: number;
  recommandationAvant?: string;
  recommandationApres?: string;
  recommandationChange?: boolean;
  lettreAvant?: string;
  lettreApres?: string;
}

/**
 * Impact d'un barème proposé sur le golden set, **calculé et figé par le
 * serveur** (`credits/baremes.py::previsualiser_impact`). L'écran l'affiche tel
 * quel : il ne recalcule jamais un score, un delta ni une bascule — le principe 1
 * (« ce qui est scoré est ce qui est en base ») vaut aussi pour la simulation
 * d'un recalibrage.
 */
export interface BaremeImpactPreview {
  baremeCode: string;
  type: 'courbe' | 'regles';
  goldenSet: { nbDossiers: number; nbEvalues: number; source: string };
  sampleGrid: Array<{ x: number; scoreAvant: number | null; scoreApres: number; delta: number | null }>;
  impacts: BaremeImpactRow[];
  resume: {
    nbScoreChange: number;
    nbRecommandationFlip: number;
    nbLettreFlip: number;
    deltaScoreMoyen: number;
    deltaScoreMax: number;
  };
}

export interface BaremeRevisionRow {
  id: number;
  baremeCode: string;
  version: number;
  status: BaremeRevisionStatus;
  comment: string | null;
  proposedBySub: string;
  proposedAt: string | null;
  decidedBySub: string | null;
  decidedAt: string | null;
  points?: CurvePoint[];
  parametres?: Record<string, unknown>;
  impactPreview?: BaremeImpactPreview;
}

export interface BaremeRow {
  code: string;
  libelle: string | null;
  type: 'courbe' | 'regles';
  points: CurvePoint[];
  parametres: Record<string, unknown>;
  actif: boolean;
  version: number;
  updatedAt: string | null;
  pendingRevision: BaremeRevisionRow | null;
  revisions?: BaremeRevisionRow[];
}

export interface BaremeListResponse {
  baremes: BaremeRow[];
  totalRows: number;
}

/** `credits/baremes.py::GOLDEN_LIMIT` — le golden set est plafonné à 200 dossiers. */
export const GOLDEN_SET_CAP = 200;

export const REVISION_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Proposée — en attente d’activation', color: 'text-amber-300 bg-amber-500/20' },
  active: { label: 'Active', color: 'text-emerald-300 bg-emerald-500/20' },
  archived: { label: 'Archivée', color: 'text-slate-400 bg-slate-500/20' },
};

// ── 4. Référentiel technico-économique ───────────────────────────────────────

export interface ReferentielVersionRow {
  id: number;
  label: string;
  imported_at: string;
  is_active: boolean;
  n_ranges: number;
}

// ── Formatage (aucun calcul métier) ──────────────────────────────────────────

export function fmtDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('fr-FR') : '—';
}

export function fmtDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString('fr-FR') : '—';
}

/** Un `sub` IdP est illisible en entier dans un tableau ; il reste copiable via
 *  le `title`. Jamais tronqué dans un message d'audit, seulement à l'affichage. */
export function shortSub(sub: string | null | undefined): string {
  if (!sub) return '—';
  return sub.length <= 14 ? sub : `${sub.slice(0, 8)}…${sub.slice(-4)}`;
}

export function shortHash(sha: string | null | undefined): string {
  if (!sha) return '—';
  return sha.length <= 16 ? sha : `${sha.slice(0, 12)}…`;
}

/** Nombre servi par le serveur → affichage fr-FR. Aucune arithmétique. */
export function fmtNum(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—';
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Delta signé (le signe vient du serveur, on ne l'invente pas). */
export function fmtSigned(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—';
  const s = fmtNum(value, digits);
  return value > 0 ? `+${s}` : s;
}

export function labelOf(
  table: Record<string, { label: string; color: string }>,
  key: string,
): { label: string; color: string } {
  return table[key] ?? { label: key, color: 'text-slate-400 bg-slate-500/20' };
}
