/**
 * Colle de l'écran « Données de référence » (admin) : ce que le contrat partagé
 * ne porte pas encore, plus les libellés et formateurs communs aux quatre
 * sections.
 *
 * Les formes de réponse vivent désormais dans `src/types/api.ts` (tenu par
 * `front-socle`) : `FileTemplate*`, `Reference*`, `Bareme*`, `ReferentielVersion`.
 * Ce fichier ne les redéclare PAS — il les ré-exporte sous les noms courts
 * utilisés par les panneaux. Une forme déclarée deux fois est une forme qui
 * divergera : la seule chose qu'on redéclare ici est ce que le contrat n'a pas
 * (le détail de template, servi par un endpoint plus récent que le type).
 *
 * Principe 7 (anti-gaming) : tout ce qui transite par cet écran — barèmes,
 * seuils, tolérances, plages, poids modules — est du référentiel chiffré. Il ne
 * va qu'à du staff. Aucun module de ce dossier ne doit être importé par un écran
 * client.
 *
 * Références backend (lues, pas devinées) :
 *   - `backend/dataio/views_templates.py`     → liste, détail, upload, activation
 *   - `backend/dataio/services_templates.py`  → `derive_schema`, `diff_schema`
 *   - `backend/reference_data/views.py`       → filières, uploads, upload, activation
 *   - `backend/reference_data/services.py`    → `activate_file` (maker ≠ checker)
 *   - `backend/credits/views.py` + `baremes.py` → barèmes, preview, propose, activate
 *   - `backend/referentiel/views.py`          → `versions`
 */
import { ApiError } from '@/services/api';
import { toFieldErrors, type FieldError } from '@/components/backoffice/States';
import type {
  Bareme,
  BaremeCurvePoint,
  BaremeImpactPreview,
  BaremeListResult,
  BaremeRevision,
  FileTemplateActivateResult,
  FileTemplateDiff,
  FileTemplateListResult,
  FileTemplateRow,
  FileTemplateSchema,
  FileTemplateUploadResult,
  ReferentielVersion,
  ReferenceUploadActivateResult,
  ReferenceUploadResult,
  ReferenceUploadRow,
  ReferenceValueChain,
} from '@/types/api';

// ── 1. Templates de fichiers (principe 11) ───────────────────────────────────

export type TemplateRow = FileTemplateRow;
export type TemplateSchema = FileTemplateSchema;
export type TemplateDiff = FileTemplateDiff;
export type TemplateListResponse = FileTemplateListResult;
export type TemplateUploadResponse = FileTemplateUploadResult;
export type TemplateActivateResponse = FileTemplateActivateResult;

/**
 * `diffBaseline.relation` dit CONTRE QUOI le serveur a calculé le diff, au lieu
 * de laisser l'écran le deviner (`views_templates._diff_baseline`) :
 *   - `'active'`     → template `pending` comparé au template ACTIF : c'est
 *                      exactement la question du checker (« qu'est-ce que son
 *                      activation change ? ») ;
 *   - `'supersedes'` → template `active`/`archived` comparé à celui qu'il a
 *                      remplacé : la trace historique de son activation ;
 *   - `id`/`version` à `null` (+ `diff.hasPrevious === false`) → tout premier
 *                      template pour ce type : il n'y a rien à comparer.
 */
export interface TemplateDiffBaseline {
  id: number | null;
  version: number | null;
  relation: 'active' | 'supersedes' | null;
}

/**
 * `GET /api/dataio/templates/<id>` — schéma dérivé COMPLET + diff calculé par le
 * serveur. Absent de `types/api.ts` (l'endpoint est postérieur au type) : c'est
 * la seule forme que cet écran déclare lui-même.
 *
 * Le diff n'est jamais reconstitué côté client. Un diff fabriqué par le front
 * n'est pas la règle de validation ; un checker qui déciderait dessus déciderait
 * sur une information fausse — pire que l'absence d'information.
 */
export interface TemplateDetail extends FileTemplateRow {
  schema: FileTemplateSchema;
  diff: FileTemplateDiff;
  diffBaseline: TemplateDiffBaseline;
}

export const DIFF_BASELINE_LABELS: Record<string, string> = {
  active: 'Comparé au template ACTIF — ce que son activation changerait.',
  supersedes: 'Comparé au template qu’il a remplacé — trace de son activation.',
};

/** `dataio/models.py::KIND_FEUILLE_BESOINS` — types de fichier client qu'un
 *  template régit. Nomenclature backend (principe 6) : le front mappe pour
 *  l'affichage, il ne crée pas de code. Aucun endpoint ne les liste ; ce miroir
 *  est documenté comme tel. */
export const TEMPLATE_KINDS: Array<{ code: string; label: string }> = [
  { code: 'FEUILLE_BESOINS', label: 'Feuille de besoins (client)' },
];

export const TEMPLATE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'En attente d’activation', color: 'text-amber-300 bg-amber-500/20' },
  active: { label: 'Actif', color: 'text-emerald-300 bg-emerald-500/20' },
  archived: { label: 'Archivé', color: 'text-slate-400 bg-slate-500/20' },
};

/** `templates()` coupe à `qs[:100]` sans renvoyer le total (dette backend
 *  signalée à l'affichage plutôt que masquée). */
export const TEMPLATES_CAP = 100;

// ── 2. Filières `ValueChain` (référentiel maker-checker) ─────────────────────

export type ValueChainRow = ReferenceValueChain;
export type ReferenceUpload = ReferenceUploadRow;
export type ReferenceUploadOk = ReferenceUploadResult;
export type ReferenceActivateResult = ReferenceUploadActivateResult;

/** `reference_data/models.py::ReferenceFileUpload.FileType` — nomenclature
 *  backend. Seul `value_chains` a un validateur ; les deux autres sont acceptés
 *  par le modèle mais rejetés à la validation (`services.process_upload`). */
export const REFERENCE_FILE_TYPES: Array<{ code: string; label: string; supported: boolean }> = [
  { code: 'value_chains', label: 'Chaînes de valeur (filières)', supported: true },
  { code: 'suppliers', label: 'Fournisseurs agréés', supported: false },
  { code: 'rates', label: 'Grille de taux', supported: false },
];

export const REFERENCE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_validation: { label: 'En attente d’activation', color: 'text-amber-300 bg-amber-500/20' },
  active: { label: 'Active', color: 'text-emerald-300 bg-emerald-500/20' },
  archived: { label: 'Archivée', color: 'text-slate-400 bg-slate-500/20' },
  rejected: { label: 'Rejetée', color: 'text-red-300 bg-red-500/20' },
};

/** `list_uploads` coupe à `qs[:50]` sans indicateur de troncature : l'écran
 *  l'annonce lui-même dès que la liste atteint le plafond. */
export const REFERENCE_UPLOADS_CAP = 50;

// ── 3. Barèmes de score (principe 8) ─────────────────────────────────────────

export type BaremeRow = Bareme;
export type BaremeListResponse = BaremeListResult;
export type BaremeRevisionRow = BaremeRevision;
export type CurvePoint = BaremeCurvePoint;
export type ImpactPreview = BaremeImpactPreview;

/** `credits/baremes.py::GOLDEN_LIMIT` — le golden set est plafonné à 200
 *  dossiers (dernière analyse par dossier). */
export const GOLDEN_SET_CAP = 200;

export const REVISION_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Proposée — en attente d’activation', color: 'text-amber-300 bg-amber-500/20' },
  active: { label: 'Active', color: 'text-emerald-300 bg-emerald-500/20' },
  archived: { label: 'Archivée', color: 'text-slate-400 bg-slate-500/20' },
  rejected: { label: 'Rejetée', color: 'text-red-300 bg-red-500/20' },
};

/** `credits/baremes.py::AFFECTED_CRITERIA` — ce que chaque barème pilote
 *  réellement. Affiché pour que le comité sache ce qu'il déplace avant de
 *  proposer : un barème n'est pas un réglage abstrait. */
export const BAREME_PORTEE: Record<string, string> = {
  DSCR: 'Critères « dscr » et « stress » du score global.',
  ECART_TECHNIQUE: 'Critère « technique » du score global.',
  COUVERTURE_GARANTIES: 'Critère « garanties » du score global.',
  DECISION: 'Aucun critère : déplace la recommandation et la lettre (seuils + grille).',
};

/** Abscisse de chaque courbe — ce que `x` représente, pour que la table de
 *  points ne soit pas une suite de nombres sans unité (`_new_score_for_criterion`). */
export const BAREME_ABSCISSE: Record<string, string> = {
  DSCR: 'x = DSCR (ratio, ex. 1,25).',
  ECART_TECHNIQUE: 'x = écart technique moyen en fraction (ex. 0,15 pour 15 %).',
  COUVERTURE_GARANTIES: 'x = ratio de couverture des garanties (ex. 1,2).',
};

// ── 4. Référentiel technico-économique ───────────────────────────────────────

export type ReferentielVersionRow = ReferentielVersion;

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

/** Delta signé — le signe vient du serveur, on ne l'invente pas. */
export function fmtSigned(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—';
  const s = fmtNum(value, digits);
  return value > 0 ? `+${s}` : s;
}

/** `Decimal` sérialisé en chaîne par le serveur : affiché tel quel, jamais
 *  reconverti en `number` (principe 4 — l'écran l'affiche, il ne l'additionne
 *  pas). Un `x`/`y` de courbe peut arriver en nombre comme en chaîne. */
export function fmtRaw(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  return String(value);
}

export function labelOf(
  table: Record<string, { label: string; color: string }>,
  key: string,
): { label: string; color: string } {
  return table[key] ?? { label: key, color: 'text-slate-400 bg-slate-500/20' };
}

// ── Erreurs ──────────────────────────────────────────────────────────────────

/**
 * Erreurs affichables d'un refus de `reference_data`.
 *
 * Ce référentiel-là ne parle pas le même dialecte que le reste du backend : sur
 * un upload invalide il répond `{valid:false, structureError, errors:[…]}` où
 * `errors` est un tableau de **chaînes** (`reference_data/validators.py`), et
 * sans clé `detail`. Le client HTTP partagé (`api.ts::request`) n'attend que des
 * `{code, message}` : il produit alors autant de lignes vides que d'erreurs.
 *
 * Plutôt que d'afficher des puces muettes — le pire des deux mondes : l'écran
 * dit qu'il y a des erreurs sans dire lesquelles — on remplace le lot par une
 * ligne qui dit la vérité : combien d'erreurs, et pourquoi leur texte manque.
 * Correctif réel attendu côté `api.ts` (normalisation des erreurs-chaînes),
 * fichier hors de ce périmètre.
 */
export function refDataErrors(err: unknown): FieldError[] {
  const base = toFieldErrors(err);
  const muettes = base.filter((e) => !e.message);
  if (muettes.length === 0) return base;
  const parlantes = base.filter((e) => e.message);
  return [
    ...parlantes,
    {
      code: 'ERREURS_NON_RELAYEES',
      message:
        `Le serveur a rejeté le fichier avec ${muettes.length} erreur(s) de validation `
        + 'dont le texte n’est pas transmis par le client HTTP partagé (le référentiel '
        + '`reference_data` renvoie des erreurs sous forme de chaînes, format que '
        + '`api.ts` ne normalise pas encore). Corrigez le classeur d’après le rapport '
        + 'de validation côté serveur, ou faites relayer ce format.',
    },
  ];
}

/** Vrai quand le refus est un 403 d'autorisation (pas une panne, une décision). */
export function isForbidden(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 403;
}
