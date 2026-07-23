/**
 * Service du **Référentiel technico-économique** (app Django `referentiel`) et de
 * l'**agenda des remboursements** (app `portfolio`).
 *
 * Pourquoi un module séparé de `services/api.ts` ?
 * ─────────────────────────────────────────────────────────────────────────────
 * Deux raisons, une de périmètre et une de discipline.
 *
 *  1. `api.ts` porte DÉJÀ les wrappers `ranges()/chains()/config()`, mais aucun
 *     écran ne les appelait : la transparence des barèmes n'existait qu'en
 *     théorie. Ce module est la couche que consomme la page Référentiel — il
 *     réutilise ces wrappers là où ils existent et AJOUTE ceux qui manquaient
 *     (`versions`, `calendar`) sans toucher au fichier d'un autre propriétaire.
 *
 *  2. Toute la LOGIQUE d'affichage vit ici, en fonctions pures et testables
 *     (`formatBounds`, `analysePoids`, `sortVersions`, `groupCalendarByDay`…).
 *     Les composants `.tsx`/`.jsx` ne font qu'appeler ces fonctions et rendre
 *     leur résultat. C'est la seule couche que `vitest` peut réellement
 *     protéger : un composant qui rend du JSX n'est pas déterministe, une
 *     fonction de tri ou de formatage l'est.
 *
 * ⚠ ANTI-GAMING (principe 7). `ranges`, `config` et `versions` servent des
 * barèmes, seuils et plages internes : le serveur les réserve à `IsStaff`
 * (vérifié dans `referentiel/views.py`). Ce module n'affaiblit pas ce contrôle
 * — la garde d'affichage (`me.is_staff`) n'est qu'un confort, le refus fait
 * autorité vient du serveur (403) et est relayé tel quel. Aucune de ces
 * fonctions ne CALCULE un chiffre financier : elles formatent ou regroupent des
 * valeurs déjà servies par le serveur (principe front « zéro calcul métier »).
 */
import { api, ApiError } from './api';
import { tokens, refresh } from './oidc';
import type { ReferenceRange, ScheduleRow } from '@/types/api';

// ── Formes servies par le serveur ───────────────────────────────────────────

export interface ChainRow {
  code: string;
  libelle: string;
  specialite: string;
}

export interface RangesResponse {
  /** Libellé de la version active du référentiel, ou `null` si aucune. */
  version: string | null;
  ranges: ReferenceRange[];
}

/**
 * Configuration institution active (`referentiel/views.py::config`).
 *
 * Les champs décimaux sont typés `number | string` à dessein : DRF sérialise un
 * `DecimalField` en CHAÎNE par défaut (`COERCE_DECIMAL_TO_STRING`). Les lire
 * comme `number` en dur produirait un `NaN` silencieux le jour où le réglage
 * serveur change. On coerce à l'affichage via `toNum`.
 */
export interface InstitutionConfigPayload {
  seuil_dscr: number | string;
  seuil_dscr_stresse: number | string;
  couverture_min: number | string;
  score_global_min: number | string;
  poids: {
    technique: number | string;
    financier: number | string;
    stress: number | string;
    comportemental: number | string;
    garanties: number | string;
  };
  taux_interet_annuel: number | string;
  plafond_delegue: number | string;
  phase_deploiement: string;
}

export interface ReferentielVersionRow {
  id: number;
  label: string;
  imported_at: string;
  is_active: boolean;
  n_ranges: number;
}

/** Une échéance de l'agenda global : une ligne d'échéancier + le dossier. */
export interface CalendarEntry extends ScheduleRow {
  reference: string;
  operator: string;
  currency: string;
}

export interface LoanScheduleTotals {
  total_principal: number;
  total_interest: number;
  total_payments: number;
  apr: number;
}

export interface LoanScheduleResponse {
  schedule: ScheduleRow[];
  totals: LoanScheduleTotals;
  currency: string;
}

// ── Accès réseau des endpoints SANS wrapper dans `api.ts` ────────────────────
//
// `versions` et `calendar` n'ont pas de wrapper côté `api.ts` (l'un existe sous
// un autre nom mais non typé, l'autre n'existe pas), et ce fichier n'est pas le
// nôtre à éditer. On refait donc ici un GET minimal — même contrat d'auth que
// `api.ts` (Bearer + un seul refresh sur 401), même classe d'erreur `ApiError`
// pour que `toFieldErrors`/`isForbidden` fonctionnent à l'identique en aval.

async function getJson<T>(path: string, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;

  const res = await fetch(`/api${path}`, { method: 'GET', headers });

  if (res.status === 401 && retry && (await refresh())) {
    return getJson<T>(path, false);
  }
  if (!res.ok) {
    let detail = '';
    let code: string | null = null;
    let errors: Array<{ code: string; message: string }> = [];
    try {
      const body = (await res.json()) as {
        detail?: string;
        code?: string;
        errors?: Array<string | { code?: string; message?: string }>;
      };
      detail = body.detail || detail;
      code = body.code ?? null;
      if (Array.isArray(body.errors)) {
        errors = body.errors.map((e) =>
          typeof e === 'string'
            ? { code: 'ERREUR', message: e }
            : { code: e.code || 'ERREUR', message: e.message || '' });
        if (!detail && errors.length) detail = errors[0].message;
      }
    } catch { /* corps non-JSON : repli ci-dessous */ }
    if (!detail) detail = `Erreur ${res.status}`;
    throw new ApiError(res.status, detail, code, errors);
  }
  const ct = res.headers.get('content-type') || '';
  return (ct.includes('application/json') ? await res.json() : (res as unknown)) as T;
}

/**
 * Couche d'accès du Référentiel + agenda. Délègue à `api.*` là où un wrapper
 * existe déjà (ne pas dupliquer l'auth), complète le reste.
 */
export const referentielApi = {
  /** Plages min/max de la version active, filtrables par chaîne. `IsStaff`. */
  ranges: (chain?: string): Promise<RangesResponse> => api.ranges(chain),
  /** Catalogue des 14 chaînes (code/libellé/spécialité). Non chiffré. */
  chains: (): Promise<ChainRow[]> => api.chains(),
  /** Config institution active (seuils, poids, taux). `IsStaff`. */
  config: (): Promise<InstitutionConfigPayload> =>
    api.config() as unknown as Promise<InstitutionConfigPayload>,
  /** Historique des versions du référentiel typé. `IsStaff`. */
  versions: (): Promise<ReferentielVersionRow[]> =>
    getJson<ReferentielVersionRow[]>('/referentiel/versions'),
  /** Agenda global des prochaines échéances (dossiers actifs). `IsStaff`. */
  calendar: (): Promise<CalendarEntry[]> => getJson<CalendarEntry[]>('/portfolio/calendar'),
  /** Échéancier serveur d'un dossier (CRD, principal, intérêts). `IsStaff`. */
  loanSchedule: (ref: string): Promise<LoanScheduleResponse> =>
    api.portfolio.loanSchedule(ref) as unknown as Promise<LoanScheduleResponse>,
};

// ── Logique pure (cœur testé) ────────────────────────────────────────────────

/**
 * Coercition tolérante vers un nombre : accepte `number`, la chaîne DRF d'un
 * `Decimal` (« 1.05 ») et la saisie francophone (« 1,05 »). Renvoie `null` pour
 * l'absence (chaîne vide, `null`, illisible) — jamais `NaN`, qui s'afficherait.
 */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const NUM_FMT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });


/** Nombre fr-FR, ou « — » si la valeur n'est pas exploitable. */
export function fmtNum(v: unknown): string {
  const n = toNum(v);
  return n === null ? '—' : NUM_FMT.format(n).replace(/[  ]/g, ' ');
}

/**
 * Formate une plage `[min, max]` du référentiel pour l'affichage. NE CALCULE
 * RIEN : borne l'intervalle tel que servi.
 *   - deux bornes    → « 1 200 – 1 800 kg/ha »
 *   - min seul       → « ≥ 1 200 kg/ha »
 *   - max seul       → « ≤ 1 800 kg/ha »
 *   - aucune         → « — »
 */
export function formatBounds(
  bounds: readonly [unknown, unknown] | null | undefined,
  unite?: string | null,
): string {
  const suffix = unite ? ` ${unite}` : '';
  const lo = bounds ? toNum(bounds[0]) : null;
  const hi = bounds ? toNum(bounds[1]) : null;
  if (lo === null && hi === null) return '—';
  if (lo !== null && hi === null) return `≥ ${fmtNum(lo)}${suffix}`;
  if (lo === null && hi !== null) return `≤ ${fmtNum(hi)}${suffix}`;
  return `${fmtNum(lo as number)} – ${fmtNum(hi as number)}${suffix}`;
}

export interface ChainRanges {
  chain_code: string;
  chain_libelle: string;
  ranges: ReferenceRange[];
}

/** Regroupe les plages par chaîne, chaînes triées par code. */
export function groupRangesByChain(ranges: ReferenceRange[]): ChainRanges[] {
  const map = new Map<string, ChainRanges>();
  for (const r of ranges) {
    let g = map.get(r.chain_code);
    if (!g) {
      g = { chain_code: r.chain_code, chain_libelle: r.chain_libelle, ranges: [] };
      map.set(r.chain_code, g);
    }
    g.ranges.push(r);
  }
  return [...map.values()].sort((a, b) => a.chain_code.localeCompare(b.chain_code));
}

const POIDS_LABELS: Record<string, string> = {
  technique: 'Technique',
  financier: 'Financier',
  stress: 'Stress',
  comportemental: 'Comportemental',
  garanties: 'Garanties',
};

export interface PoidsPart {
  key: string;
  label: string;
  value: number;
}

export interface PoidsCheck {
  parts: PoidsPart[];
  sum: number;
  /** Invariant CLAUDE.md §5 : la somme des poids du scoring doit valoir 100. */
  consistent: boolean;
}

/**
 * Décompose et VÉRIFIE les cinq poids du scoring. La somme = 100 est un
 * invariant de configuration (donnée interne, staff) — pas un chiffre financier
 * d'un client. Un total ≠ 100 est un défaut de config à signaler, pas à corriger
 * ici.
 */
export function analysePoids(poids: InstitutionConfigPayload['poids'] | null | undefined): PoidsCheck {
  const src = (poids ?? {}) as Record<string, unknown>;
  const parts: PoidsPart[] = Object.keys(POIDS_LABELS).map((k) => ({
    key: k,
    label: POIDS_LABELS[k],
    value: toNum(src[k]) ?? 0,
  }));
  const sum = parts.reduce((acc, p) => acc + p.value, 0);
  return { parts, sum, consistent: Math.abs(sum - 100) < 0.001 };
}

/** Versions triées : l'active d'abord, puis les plus récemment importées. */
export function sortVersions(versions: ReferentielVersionRow[]): ReferentielVersionRow[] {
  return [...versions].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return (b.imported_at || '').localeCompare(a.imported_at || '');
  });
}

export type VersionsAnomaly = 'none' | 'no-active' | 'multiple-active';

/**
 * Diagnostic de l'historique : aucune version active (le moteur n'a pas de
 * plage de référence) ou plusieurs (ambiguïté d'import). Sur une liste vide, il
 * n'y a pas d'anomalie — c'est l'état vide qui parle.
 */
export function versionsAnomaly(versions: ReferentielVersionRow[]): VersionsAnomaly {
  if (versions.length === 0) return 'none';
  const actives = versions.filter((v) => v.is_active).length;
  if (actives === 0) return 'no-active';
  if (actives > 1) return 'multiple-active';
  return 'none';
}

export interface CalendarDay {
  date: string;
  entries: CalendarEntry[];
}

/**
 * Regroupe les échéances par jour, jours triés. NE SOMME PAS les montants (ce
 * serait un calcul financier côté client) : chaque échéance garde les valeurs
 * servies par le serveur ; l'écran affiche au plus un COMPTE d'échéances.
 */
export function groupCalendarByDay(entries: CalendarEntry[]): CalendarDay[] {
  const map = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    const list = map.get(e.date);
    if (list) list.push(e);
    else map.set(e.date, [e]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, es]) => ({ date, entries: es }));
}

export interface CalendarMonth {
  /** Clé « YYYY-MM », déterministe et triable. */
  key: string;
  days: CalendarDay[];
}

/** Regroupe l'agenda par mois puis par jour. Aucune somme d'argent. */
export function groupCalendarByMonth(entries: CalendarEntry[]): CalendarMonth[] {
  const byDay = groupCalendarByDay(entries);
  const map = new Map<string, CalendarDay[]>();
  for (const day of byDay) {
    const key = (day.date || '').slice(0, 7);
    const list = map.get(key);
    if (list) list.push(day);
    else map.set(key, [day]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, days]) => ({ key, days }));
}

/** `true` si l'erreur est un refus d'habilitation serveur (403). */
export function isForbidden(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 403;
}

/** Date courte fr-FR ; « — » si absente, valeur brute si illisible. */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Horodatage complet fr-FR ; « — » si absent, valeur brute si illisible. */
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Libellé « août 2026 » d'une clé mensuelle « YYYY-MM ». Repli : la clé brute. */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!m) return key || '—';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}
