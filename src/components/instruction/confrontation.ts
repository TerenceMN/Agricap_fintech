/**
 * Confrontation poste par poste : ce que le demandeur a déclaré dans son
 * classeur, face à ce que le référentiel de sa filière donne pour la même
 * rubrique.
 *
 * ─── CE MODULE NE CALCULE RIEN ───────────────────────────────────────────────
 *
 * Il LIT la sortie de `credits/analyse.py::scorer_technique`, déjà calculée en
 * `Decimal` côté serveur, et la met en forme de tableau. Aucune soustraction,
 * aucun pourcentage, aucun verdict n'est produit ici :
 *
 *   - la valeur déclarée vient de `parModule[].valeur` (extraite des `DataRecord`
 *     de la révision courante — principe 1, ce qui est scoré est ce qui est en base) ;
 *   - la référence vient de `parModule[].reference` (coût unitaire du référentiel
 *     × dimension du dossier, multiplié PAR LE SERVEUR) ;
 *   - l'écart vient de `parModule[].ecartPct` ;
 *   - le verdict « hors plage » vient de `parModule[].horsPlage`, seul endroit où
 *     les tolérances `tol_inf` / `tol_sup` du référentiel sont appliquées.
 *
 * ─── CE QUE LE SERVEUR NE SERT PAS, ET QUE L'ÉCRAN NE FABRIQUERA PAS ─────────
 *
 * Les BORNES de la plage (`reference × (1 − tol_inf)` … `reference × (1 + tol_sup)`)
 * ne figurent dans aucun champ de la réponse : `couts_modules` porte bien
 * `tol_inf` / `tol_sup` en base, mais `scorer_technique` ne les sérialise pas.
 * Les reconstituer dans le navigateur exigerait de recopier des tolérances qui
 * vivent en base et se recalibrent sans redéploiement (principe 8) : la plage
 * affichée serait une plage inventée, et périmée au premier recalibrage. On
 * affiche donc la référence et le verdict du serveur, et on DIT que les bornes
 * ne sont pas servies.
 *
 * ─── ANTI-GAMING (principe 7) ────────────────────────────────────────────────
 *
 * Tout ce que ce module expose — références, écarts, tolérances implicites,
 * effectif du référentiel — est du référentiel chiffré. Réservé au STAFF.
 */
import type { CreditAnalyse } from '@/types/api';

/** Ce que l'écran affiche à la place des bornes de la plage, faute d'être servi. */
export const MESSAGE_BORNES_NON_SERVIES =
  'Bornes non servies par l’API : le moteur applique les tolérances du référentiel '
  + '(`tol_inf` / `tol_sup`) pour rendre son verdict, mais ne les sérialise pas. '
  + 'Cet écran ne les reconstitue pas — une plage recalculée dans le navigateur serait '
  + 'périmée au premier recalibrage du comité.';

/** Motif de repli quand le serveur n'a même pas expliqué son refus de comparer. */
export const MOTIF_NON_CALCULABLE_INCONNU =
  'Le moteur n’a servi aucune comparaison par poste pour cette analyse, et n’en a pas '
  + 'donné le motif. Ré-analysez le dossier ou vérifiez que sa dimension de référence '
  + '(superficie, nombre de ruches, de sujets…) est renseignée.';

/** D'où vient la ligne — le référentiel la couvre, ou pas du tout. */
export type OrigineLigne = 'referentiel' | 'hors_referentiel';

/**
 * Étendue de la comparaison servie.
 *
 * `totale` : le serveur a servi `parModule`, tous les postes du référentiel sont
 * là, dans la plage comme hors plage.
 * `ecarts_seulement` : analyse antérieure à `parModule` — seuls les postes HORS
 * plage sont connus. L'écran doit le dire, sinon un tableau court se lit comme
 * « tout le reste est conforme » alors qu'il n'a simplement pas été servi.
 */
export type Completude = 'totale' | 'ecarts_seulement';

export interface JustificationLigne {
  indicateur: string;
  justification: string;
  agent: string;
  date: string;
}

export interface LigneConfrontation {
  /** Code canonique du moteur (`cout_module:semences`) — c'est LUI qu'attend
   *  `POST .../analyse/justifier/`. `null` pour un poste hors référentiel :
   *  le moteur ne lui attache aucun indicateur, il n'y a rien à justifier. */
  indicateur: string | null;
  /** Code module canonique du backend (principe 6) : jamais retraduit ici. */
  module: string;
  /** Montant déclaré dans le classeur, tel que servi. `null` = non servi —
   *  jamais remplacé par 0 (§4.6). */
  valeurDeclaree: number | null;
  /** Coût de référence du référentiel pour la dimension du dossier. */
  reference: number | null;
  ecartPct: number | null;
  /** Verdict du SERVEUR, jamais recalculé ici. */
  horsPlage: boolean;
  origine: OrigineLigne;
  /** Phrase du moteur (« semences : +52,0 % vs référentiel »), servie telle quelle. */
  message: string;
  justifications: JustificationLigne[];
  /** Le canal de justification n'accepte que les indicateurs QUE LE MOTEUR a
   *  relevés (422 `INDICATEUR_INCONNU` sinon) : proposer le bouton ailleurs
   *  serait offrir une action vouée à l'échec. */
  justifiable: boolean;
}

export interface BaseConfrontation {
  referentiel: string;
  filiere: string;
  /** `indicatif` (plages estimées) ou `appris` (N ≥ 30 dossiers réels). */
  source: string;
  estIndicatif: boolean;
  nCasReels: number;
  version: number | null;
  /** Dimension du dossier retenue par le moteur, DANS L'UNITÉ DU RÉFÉRENTIEL. */
  quantiteReference: number | null;
  uniteReference: string | null;
  totalPlan: number | null;
  totalReferentiel: number | null;
  ecartMoyenPct: number | null;
  devise: string;
  /** Commentaire du moteur (référentiel indicatif, plan sous-dimensionné…). */
  commentaire: string;
  fiabilite: 'indicative' | 'apprise';
  /** §4.6 — l'incertitude s'assume : une plage indicative le dit à l'écran. */
  messageFiabilite: string;
}

export interface Confrontation {
  /** `false` = aucune ligne servie : la comparaison n'a pas eu lieu. Un tableau
   *  vide ne doit JAMAIS se lire comme « aucun écart ». */
  calculable: boolean;
  motifNonCalculable: string;
  completude: Completude;
  lignes: LigneConfrontation[];
  /** Comptage de lignes déjà qualifiées par le serveur — pas un verdict de plus. */
  nbHorsPlage: number;
  nbPostes: number;
  base: BaseConfrontation;
}

// ── Lecteurs défensifs ───────────────────────────────────────────────────────
//
// `CreditAnalyseCritere.details` est typé avec un index `[k: string]: unknown` :
// `parModule` et `modulesNonReferences` y sont servis mais pas déclarés. On les
// lit donc en narrowing explicite plutôt qu'en `as` — un `as` mentirait au
// compilateur sur une forme qu'aucun test de contrat ne vérifie.

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Nombre exploitable, ou `null`. Ne convertit JAMAIS l'absence en 0 (§4.6). */
export function nombreOuNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function texte(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function lignesBrutes(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(estObjet) : [];
}

function justificationsDe(analyse: CreditAnalyse | null, indicateur: string | null): JustificationLigne[] {
  if (!indicateur || !analyse || !Array.isArray(analyse.justifications)) return [];
  return analyse.justifications.filter((j) => j && j.indicateur === indicateur);
}

/**
 * Message de fiabilité du référentiel (§4.6, « incertitude assumée »).
 *
 * Une plage apprise sur 200 dossiers et une estimation initiale n'ont pas la
 * même autorité : l'écran ne doit pas les afficher du même trait.
 */
export function messageFiabilite(estIndicatif: boolean, nCasReels: number): string {
  if (estIndicatif) {
    return `Référentiel INDICATIF (N = ${nCasReels} dossier(s) réel(s)) — fiabilité limitée. `
      + 'Ces plages sont des estimations initiales : elles n’ont pas l’autorité d’une plage '
      + 'apprise, et un écart contre elles se discute avec le demandeur avant de peser sur '
      + 'une décision.';
  }
  return `Référentiel APPRIS sur ${nCasReels} dossier(s) réel(s) de la filière.`;
}

/**
 * Construit le tableau de confrontation à partir d'UNE analyse servie.
 *
 * Ordre : les postes du référentiel dans l'ordre servi par le moteur, puis les
 * écarts relevés à la racine de l'analyse qui n'auraient pas de ligne (analyses
 * anciennes), puis les postes du classeur que le référentiel ne couvre pas.
 * Aucun poste n'est écarté : un poste ignoré du scoring est précisément ce que
 * l'analyste doit voir (§4.4, « l'absence est une donnée »).
 */
export function construireConfrontation(analyse: CreditAnalyse | null): Confrontation {
  const details: Record<string, unknown> = estObjet(analyse?.criteres?.technique?.details)
    ? (analyse!.criteres.technique.details as Record<string, unknown>)
    : {};

  const info = analyse?.referentielInfo;
  const estIndicatif = info?.estIndicatif === true;
  const nCasReels = typeof info?.nCasReels === 'number' ? info.nCasReels : 0;

  const base: BaseConfrontation = {
    referentiel: texte(details.referentiel) || info?.code || analyse?.referentiel || '',
    filiere: info?.filiere ?? '',
    source: info?.source ?? '',
    estIndicatif,
    nCasReels,
    version: typeof info?.version === 'number' ? info.version : null,
    quantiteReference: nombreOuNull(details.quantiteReference),
    uniteReference: texte(details.uniteReference) || null,
    totalPlan: nombreOuNull(details.totalPlan),
    totalReferentiel: nombreOuNull(details.totalReferentiel),
    ecartMoyenPct: nombreOuNull(details.ecartMoyenPct),
    devise: analyse?.devise ?? analyse?.parametres?.devise ?? '',
    commentaire: texte(details.commentaire),
    fiabilite: estIndicatif ? 'indicative' : 'apprise',
    messageFiabilite: messageFiabilite(estIndicatif, nCasReels),
  };

  const parModule = lignesBrutes(details.parModule);
  const ecartsSeuls = lignesBrutes(details.ecartsHorsPlage);
  const completude: Completude = parModule.length > 0 ? 'totale' : 'ecarts_seulement';
  const brutes = parModule.length > 0 ? parModule : ecartsSeuls;

  const lignes: LigneConfrontation[] = [];
  const vues = new Set<string>();

  for (const b of brutes) {
    const indicateur = texte(b.indicateur) || null;
    const horsPlage = parModule.length > 0 ? b.horsPlage === true : true;
    if (indicateur) vues.add(indicateur);
    lignes.push({
      indicateur,
      module: texte(b.module) || (indicateur ? indicateur.split(':').pop() ?? '' : ''),
      valeurDeclaree: nombreOuNull(b.valeur),
      reference: nombreOuNull(b.reference),
      ecartPct: nombreOuNull(b.ecartPct),
      horsPlage,
      origine: 'referentiel',
      message: texte(b.message),
      justifications: justificationsDe(analyse, indicateur),
      justifiable: horsPlage && Boolean(indicateur),
    });
  }

  // Écarts relevés à la racine de l'analyse et absents du détail par module :
  // on n'en perd aucun. Un indicateur signalé d'un seul côté est un signal.
  for (const e of analyse?.indicateursHorsPlage ?? []) {
    const indicateur = texte(e?.indicateur) || null;
    if (!indicateur || vues.has(indicateur)) continue;
    vues.add(indicateur);
    lignes.push({
      indicateur,
      module: indicateur.split(':').pop() ?? indicateur,
      valeurDeclaree: nombreOuNull((e as Record<string, unknown>).valeur),
      reference: nombreOuNull((e as Record<string, unknown>).reference),
      ecartPct: nombreOuNull(e?.ecartPct),
      horsPlage: true,
      origine: 'referentiel',
      message: texte(e?.message),
      justifications: justificationsDe(analyse, indicateur),
      justifiable: true,
    });
  }

  // Postes du classeur que le référentiel ne couvre pas : ils n'entrent dans
  // aucun écart, donc dans aucun score. Les taire reviendrait à scorer un plan
  // amputé sans que personne ne le sache.
  for (const m of lignesBrutes(details.modulesNonReferences)) {
    lignes.push({
      indicateur: null,
      module: texte(m.module),
      valeurDeclaree: nombreOuNull(m.montant),
      reference: null,
      ecartPct: null,
      horsPlage: false,
      origine: 'hors_referentiel',
      message: 'Poste absent du référentiel : il n’entre dans aucun écart, donc dans aucun score.',
      justifications: [],
      justifiable: false,
    });
  }

  return {
    calculable: lignes.length > 0,
    motifNonCalculable: base.commentaire || MOTIF_NON_CALCULABLE_INCONNU,
    completude,
    lignes,
    nbHorsPlage: lignes.filter((l) => l.horsPlage).length,
    nbPostes: lignes.length,
    base,
  };
}
