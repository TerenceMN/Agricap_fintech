/**
 * Rapport de restitution CLIENT des critères d'une simulation de crédit.
 *
 * CE QUE CET ÉCRAN DISAIT, ET POURQUOI C'ÉTAIT UN DÉFAUT
 * ------------------------------------------------------
 * `CriteresClient` listait les cinq critères, marquait « — non évalué à ce
 * stade » ceux que le moteur n'avait pas pu noter, puis concluait :
 *
 *     « 4 critères n'ont pas pu être évalués avec les informations
 *       disponibles : votre agent AGRICAP peut vous dire ce qui manque. »
 *
 * L'écran CONSTATAIT un vide et renvoyait le demandeur vers un humain sans
 * jamais nommer ce qui manquait. Le client ne pouvait ni corriger, ni fournir :
 * la phrase était l'aveu que l'écran, lui, ne le disait pas. Ce module produit
 * le rapport qui manquait — critère par critère, dans les deux sens :
 *
 *   - critère ÉVALUÉ    → sur quelles informations de SON dossier il l'a été
 *                         (« les 6 postes de votre feuille de besoins,
 *                         révision 2, rapportés à 5 hectares ») ;
 *   - critère NON ÉVALUÉ → le FAIT, la CAUSE et l'ACTION (CLAUDE.md §4.6),
 *                         et — distinction décisive — si l'action revient au
 *                         demandeur ou à AGRICAP.
 *
 * LA LIGNE QUE CE MODULE NE FRANCHIT PAS (principe 7)
 * ---------------------------------------------------
 * Le demandeur voit son score, sa lettre et ce qui manque à SON dossier. Il ne
 * voit jamais les barèmes, les seuils, les tolérances, les plages du
 * référentiel, les poids ni les règles du moteur. Concrètement, ce module :
 *
 *   - n'affiche JAMAIS `breakdown[].detail`. Le serveur y met des phrases
 *     d'instruction (« Écart moyen de 42 % au référentiel MAIS-v3 », « DSCR =
 *     0.64 (insuffisante) », « le barème « ECART_TECHNIQUE » n'est pas
 *     configuré en base ») : elles citent une plage, un ratio, un code de
 *     barème. Utile à l'analyste, jouable par le demandeur ;
 *   - ne lit ni `score`, ni `points`, ni `maxPoints`, ni `weight`, ni
 *     `tarification`, ni `refTotals`, ni `minScoreRequired` ;
 *   - traduit un CODE de cause servi par le serveur en une phrase écrite ICI.
 *     Un code inconnu ne se recopie pas à l'écran : il devient « motif non
 *     restitué ». Rien de ce que le serveur rédige ne traverse cette frontière.
 *
 * La règle de partage tient en deux exemples :
 *   ✅ « Aucune garantie n'est enregistrée sur votre dossier. Ajoutez un actif
 *      ou une caution pour que ce critère soit noté. » — actionnable, aucun
 *      barème.
 *   ❌ « Votre couverture de 42 % est sous le seuil de 60 % requis. » — révèle
 *      le seuil et apprend à se caler juste au-dessus.
 * Un demandeur doit pouvoir COMPLÉTER son dossier, jamais l'OPTIMISER contre le
 * barème.
 *
 * ZÉRO CALCUL MÉTIER (standard front §5)
 * ---------------------------------------
 * Rien n'est déduit, noté ni comparé ici. Ce module met en forme des faits
 * SERVIS : `calculable`, `cause.code`, la dimension retenue (`refData`), la
 * révision de la feuille, le nombre de postes financés. Les deux seules
 * causes établies sans code serveur — dimension absente, dimension exprimée
 * dans une autre unité que la filière — sont des CONSTATS sur la réponse
 * (`refData.quantiteReference`, `refData.uniteDossier` vs `uniteReference`),
 * du même ordre que `dimensionRetenueParLeServeur` : aucune règle du moteur
 * n'est rejouée.
 *
 * CE QUE LE SERVEUR NE SERT PAS ENCORE
 * ------------------------------------
 * `dataio_simulator` connaît la cause exacte de chaque non-évaluation, mais ne
 * la sert que sous forme de PROSE dans `detail` — non lisible par une machine,
 * et non diffusable telle quelle (elle nomme les barèmes et les référentiels).
 * Le contrat qui manque est décrit dans `CauseNonEvaluation` et
 * `FaitsDossier` : ce module les consomme dès qu'ils existent, sans
 * modification. En attendant, un critère non évalué dont la cause n'est pas
 * déductible est annoncé comme tel — « le motif n'est pas restitué » — plutôt
 * que doté d'une raison inventée par le navigateur.
 */
import { libelleUnite, normaliserUnite } from './dimension';

/** À qui revient l'action. La distinction n'est pas cosmétique : dire à un
 *  demandeur « complétez votre dossier » alors que c'est un référentiel AGRICAP
 *  qui manque est un mensonge, et l'envoie corriger un fichier déjà complet. */
export type OrigineMotif = 'dossier' | 'institution' | 'indeterminee';

/**
 * Cause de non-évaluation, telle qu'elle DEVRAIT être servie par le moteur.
 *
 * CONTRAT ATTENDU sur `breakdown[]` (app `credits`, non modifiée par ce lot) :
 *
 *     "cause": {
 *       "code": "DIMENSION_ABSENTE",
 *       "origine": "dossier",                     // ou "institution"
 *       "parametres": { "uniteReferentiel": "ruche" }
 *     }
 *
 * `code` est la seule clé indispensable : le libellé affiché est écrit côté
 * front (whitelist `MOTIFS`), précisément pour qu'aucune phrase rédigée par le
 * moteur — donc susceptible de citer un barème — ne parvienne au demandeur.
 */
export interface CauseNonEvaluation {
  code?: string | null;
  origine?: string | null;
  parametres?: Record<string, unknown> | null;
}

/** Une ligne de `breakdown[]`, vue par cet écran. Volontairement partielle :
 *  `score`, `points`, `maxPoints`, `weight` et `detail` existent dans la
 *  réponse et ne sont PAS déclarés ici — ce qui n'est pas typé ne peut pas
 *  être affiché par inadvertance. */
export interface CritereServi {
  code?: string | null;
  label?: string | null;
  calculable?: boolean | null;
  cause?: CauseNonEvaluation | null;
}

/**
 * Faits du dossier servis par le moteur — contrat ATTENDU, tout optionnel.
 *
 * C'est le pendant « positif » de `cause` : ce qui a permis d'évaluer. Le
 * moteur les connaît tous (`scorer_comportemental` compte les prêts,
 * `extract_module_totals` les postes, `referentiel.est_indicatif` l'autorité de
 * la comparaison) mais ne les sert aujourd'hui qu'en prose d'analyste.
 *
 * Aucun de ces champs n'est un barème : ce sont des faits sur le dossier DU
 * DEMANDEUR, qu'il peut de toute façon recompter lui-même.
 */
export interface FaitsDossier {
  /** Nombre de postes financés lus dans la feuille de besoins. */
  nbPostes?: number | null;
  /** Révision de la feuille de besoins effectivement scorée. */
  revision?: number | null;
  /** Nombre de crédits antérieurs du demandeur chez AGRICAP. `0` est une
   *  information : le critère se construira avec le premier prêt. */
  nbCreditsAnterieurs?: number | null;
  /** Nombre de garanties rattachées à la demande. */
  nbGaranties?: number | null;
  /** §4.6 — la comparaison s'appuie-t-elle sur une plage encore indicative ? */
  referentielIndicatif?: boolean | null;
}

/** Ce que la simulation sert et que cet écran a le droit de lire. */
export interface SimulationLue {
  breakdown?: CritereServi[] | null;
  refData?: {
    uniteReference?: string | null;
    uniteDossier?: string | null;
    quantiteReference?: number | null;
  } | null;
  needsSource?: { revision?: number | null } | null;
  moduleFinancing?: unknown[] | null;
  dossier?: FaitsDossier | null;
  unavailable?: { code?: string | null; message?: string | null } | null;
}

/** Le fait, la cause et l'action — les trois choses que §4.6 exige ensemble. */
export interface MotifCritere {
  code: string;
  origine: OrigineMotif;
  /** Le FAIT, formulé pour le demandeur, sans chiffre de barème. */
  fait: string;
  /** L'ACTION : ce qu'il faut faire, et par qui. Jamais « demandez à un agent ». */
  action: string;
}

export interface LigneRapport {
  code: string;
  label: string;
  evalue: boolean;
  /** Évalué : sur quelles informations du dossier. Non évalué : ce que le
   *  critère aurait examiné. Toujours renseigné — un critère ne se présente
   *  jamais nu, c'est tout l'objet de ce lot. */
  fondement: string;
  /** Présent uniquement quand le critère n'a pas été évalué ET que la cause est
   *  connue (servie ou constatée). Absent = motif non restitué. */
  motif?: MotifCritere;
}

export interface RapportCriteres {
  lignes: LigneRapport[];
  /** Ce que LE DEMANDEUR doit fournir. C'est la liste qui remplace
   *  « votre agent peut vous dire ce qui manque ». */
  manquantsDossier: MotifCritere[];
  /** Ce qu'AGRICAP doit configurer : le demandeur n'a rien à y faire, et le lui
   *  faire croire l'enverrait corriger un dossier déjà complet. */
  manquantsInstitution: MotifCritere[];
  nbNonEvalues: number;
  /** Critères non évalués dont le moteur ne restitue pas encore le motif.
   *  Compté, jamais listé par libellé : un libellé répété deux fois à l'écran
   *  ne dit rien de plus et brouille la lecture. */
  nbMotifsNonRestitues: number;
  /** §4.6 — incertitude assumée. Vide quand rien ne l'exige. */
  reserves: string[];
}

// ── Ce que chaque critère examine, et sur quoi il s'appuie ───────────────────
//
// Ces phrases décrivent la NATURE de chaque critère. Savoir que la fiabilité
// technique compare des postes à des projets de même nature aide un demandeur à
// préparer son dossier ; cela ne lui dit ni ce que le critère pèse, ni où se
// trouve la barre. C'est exactement la frontière déjà retenue pour la liste des
// critères examinés.

const OBJET_CRITERE: Record<string, string> = {
  technique: 'Ce critère compare les postes de votre feuille de besoins à ceux '
    + 'de projets de même nature, ramenés à la taille du vôtre.',
  dscr: 'Ce critère rapporte les revenus attendus de votre projet à vos '
    + 'remboursements.',
  stress: 'Ce critère rejoue votre plan de remboursement avec des revenus '
    + 'volontairement dégradés, pour voir s’il tiendrait quand même.',
  comportemental: 'Ce critère regarde vos crédits antérieurs chez AGRICAP et la '
    + 'façon dont ils ont été remboursés.',
  garanties: 'Ce critère regarde les garanties rattachées à votre demande.',
};

interface ContexteDossier {
  nbPostes: number | null;
  revision: number | null;
  quantite: number | null;
  uniteDossier: string;
  uniteReferentiel: string;
  nbCreditsAnterieurs: number | null;
  nbGaranties: number | null;
}

/** « 5 hectares », « 30 ruches », ou `''` quand la dimension n'est pas servie. */
function dimensionLisible(ctx: ContexteDossier): string {
  if (ctx.quantite === null) return '';
  const unite = libelleUnite(ctx.uniteDossier || ctx.uniteReferentiel, ctx.quantite);
  return unite ? `${ctx.quantite} ${unite}` : String(ctx.quantite);
}

/**
 * Sur quelles informations du dossier le critère a été évalué.
 *
 * Chaque phrase ne cite que des faits SERVIS. Quand un fait n'est pas servi, la
 * phrase l'omet au lieu de le supposer : « les postes de votre feuille de
 * besoins » plutôt qu'un nombre inventé.
 */
function fondementEvalue(code: string, ctx: ContexteDossier): string {
  if (code === 'technique') {
    const postes = ctx.nbPostes && ctx.nbPostes > 0
      ? `des ${ctx.nbPostes} postes de votre feuille de besoins`
      : 'des postes de votre feuille de besoins';
    const revision = ctx.revision != null ? ` (révision ${ctx.revision})` : '';
    const dimension = dimensionLisible(ctx);
    const rapport = dimension ? `, rapportés à ${dimension}` : '';
    return `Évalué à partir ${postes}${revision}${rapport}, comparés à des `
      + 'projets de même nature.';
  }
  if (code === 'dscr') {
    return 'Évalué à partir du montant que vous demandez et du plan de '
      + 'remboursement affiché plus bas.';
  }
  if (code === 'stress') {
    return 'Évalué en rejouant ce même plan de remboursement avec des revenus '
      + 'dégradés.';
  }
  if (code === 'comportemental') {
    if (ctx.nbCreditsAnterieurs === 0) {
      return 'Évalué sans aucun crédit antérieur à votre nom chez AGRICAP : ce '
        + 'critère se construira avec votre premier prêt.';
    }
    if (ctx.nbCreditsAnterieurs && ctx.nbCreditsAnterieurs > 0) {
      const pluriel = ctx.nbCreditsAnterieurs > 1 ? 'crédits' : 'crédit';
      return `Évalué à partir de vos ${ctx.nbCreditsAnterieurs} ${pluriel} `
        + 'antérieurs chez AGRICAP.';
    }
    return 'Évalué à partir de votre historique de crédit chez AGRICAP.';
  }
  if (code === 'garanties') {
    if (ctx.nbGaranties === 0) {
      return 'Évalué sans aucune garantie rattachée à votre demande : ce critère '
        + 'reste à consolider.';
    }
    if (ctx.nbGaranties && ctx.nbGaranties > 0) {
      const pluriel = ctx.nbGaranties > 1 ? 'garanties rattachées' : 'garantie rattachée';
      return `Évalué à partir des ${ctx.nbGaranties} ${pluriel} à votre demande.`;
    }
    return 'Évalué à partir des garanties rattachées à votre demande.';
  }
  return 'Évalué à partir des informations de votre dossier.';
}

// ── Motifs de non-évaluation — whitelist de codes ────────────────────────────
//
// Chaque entrée est RÉDIGÉE ICI. Le serveur fournit un code, jamais la phrase :
// c'est ce qui garantit qu'un message d'instruction (« le barème
// « ECART_TECHNIQUE » n'est pas configuré en base ») ne peut pas se retrouver
// sur l'écran d'un demandeur, même le jour où quelqu'un enrichit `detail`.

type FabriqueMotif = (ctx: ContexteDossier, parametres: Record<string, unknown>) => MotifCritere;

function uniteDe(valeur: unknown, repli: string): string {
  const brut = normaliserUnite(valeur);
  return libelleUnite(brut || repli, 2) || brut || repli;
}

const MOTIFS: Record<string, FabriqueMotif> = {
  DIMENSION_ABSENTE: (ctx, p) => ({
    code: 'DIMENSION_ABSENTE',
    origine: 'dossier',
    fait: 'La dimension de votre projet n’est pas renseignée : sans elle, vos '
      + 'postes ne peuvent être rapportés à rien.',
    action: `Indiquez la taille de votre projet en ${
      uniteDe(p.uniteReferentiel ?? ctx.uniteReferentiel, ctx.uniteReferentiel || 'ha')
    }, puis relancez la simulation.`,
  }),
  DIMENSION_INCOHERENTE: (ctx, p) => ({
    code: 'DIMENSION_INCOHERENTE',
    origine: 'dossier',
    fait: `Votre projet est dimensionné en ${
      uniteDe(p.uniteDossier ?? ctx.uniteDossier, ctx.uniteDossier || 'ha')
    } alors que cette filière se mesure en ${
      uniteDe(p.uniteReferentiel ?? ctx.uniteReferentiel, ctx.uniteReferentiel || 'ha')
    }. Aucune conversion n’existe entre ces deux unités.`,
    action: `Ressaisissez la quantité en ${
      uniteDe(p.uniteReferentiel ?? ctx.uniteReferentiel, ctx.uniteReferentiel || 'ha')
    }, puis relancez la simulation.`,
  }),
  FEUILLE_BESOINS_ABSENTE: () => ({
    code: 'FEUILLE_BESOINS_ABSENTE',
    origine: 'dossier',
    fait: 'Votre feuille de besoins ne porte aucun montant par poste : il n’y a '
      + 'rien à examiner pour ce critère.',
    action: 'Déposez votre feuille de besoins, ou complétez les postes laissés '
      + 'vides, puis relancez la simulation.',
  }),
  DSCR_NON_ESTIMABLE: () => ({
    code: 'DSCR_NON_ESTIMABLE',
    origine: 'dossier',
    fait: 'Les revenus attendus de votre projet n’ont pas pu être estimés : ce '
      + 'critère les compare à vos remboursements, il lui manque un des deux '
      + 'termes.',
    action: 'Précisez ce que vous comptez produire et vendre — quantités, prix, '
      + 'période de vente — dans votre feuille de besoins.',
  }),
  HISTORIQUE_ABSENT: () => ({
    code: 'HISTORIQUE_ABSENT',
    origine: 'dossier',
    fait: 'Aucun crédit antérieur à votre nom chez AGRICAP : il n’y a pas '
      + 'encore d’historique de remboursement à lire.',
    action: 'Rien à corriger : ce critère se construira avec votre premier prêt. '
      + 'Une épargne régulière y contribue également.',
  }),
  GARANTIE_ABSENTE: () => ({
    code: 'GARANTIE_ABSENTE',
    origine: 'dossier',
    fait: 'Aucune garantie n’est enregistrée sur votre dossier.',
    action: 'Ajoutez un actif à mettre en gage, une épargne à nantir ou une '
      + 'caution pour que ce critère soit noté.',
  }),
  REFERENTIEL_FILIERE_ABSENT: () => ({
    code: 'REFERENTIEL_FILIERE_ABSENT',
    origine: 'institution',
    fait: 'AGRICAP ne publie pas encore de données de comparaison pour votre '
      + 'filière : il n’y a rien à quoi comparer votre projet.',
    action: 'Rien à faire de votre côté — votre dossier n’est pas en cause. '
      + 'Ce critère sera repris lors de l’instruction.',
  }),
  BAREME_NON_CONFIGURE: () => ({
    code: 'BAREME_NON_CONFIGURE',
    origine: 'institution',
    fait: 'La grille d’évaluation de ce critère n’est pas encore en service '
      + 'chez AGRICAP.',
    action: 'Rien à faire de votre côté — votre dossier n’est pas en cause. '
      + 'Ce critère sera repris lors de l’instruction.',
  }),
};

/**
 * Cause SERVIE par le moteur, traduite par la whitelist.
 *
 * `null` quand aucun code n'est servi, ou quand le code est inconnu de cet
 * écran : la prose du serveur n'est jamais reprise en secours. Un code inconnu
 * est un motif non restitué, pas une phrase à recopier.
 */
function motifServi(critere: CritereServi, ctx: ContexteDossier): MotifCritere | null {
  const code = typeof critere.cause?.code === 'string' ? critere.cause.code.trim() : '';
  if (!code) return null;
  const fabrique = MOTIFS[code];
  if (!fabrique) return null;
  const parametres = (critere.cause?.parametres ?? {}) as Record<string, unknown>;
  return fabrique(ctx, parametres);
}

/**
 * Cause CONSTATÉE sur la réponse, en l'absence de code servi.
 *
 * Deux constats seulement, et tous deux portent sur des champs que le serveur
 * sert explicitement : la dimension qu'il a retenue (`quantiteReference`) et
 * l'unité dans laquelle il a scoré (`uniteDossier`) face à celle de la filière
 * (`uniteReference`). Ce ne sont pas des règles du moteur rejouées côté
 * navigateur — c'est la lecture de ce que le moteur DIT avoir utilisé.
 *
 * Limité au critère technique : c'est le seul dont la dimension conditionne le
 * calcul (`_score_technique`). L'étendre aux autres serait une supposition.
 */
function motifConstate(code: string, ctx: ContexteDossier): MotifCritere | null {
  if (code !== 'technique') return null;

  if (ctx.uniteReferentiel && ctx.uniteDossier && ctx.uniteDossier !== ctx.uniteReferentiel) {
    return MOTIFS.DIMENSION_INCOHERENTE(ctx, {});
  }
  if (ctx.quantite !== null && ctx.quantite <= 0) return MOTIFS.DIMENSION_ABSENTE(ctx, {});
  return null;
}

function contexte(sim: SimulationLue): ContexteDossier {
  const faits = sim.dossier ?? null;
  const refData = sim.refData ?? null;

  const nbPostesServi = typeof faits?.nbPostes === 'number' ? faits.nbPostes : null;
  const nbPostesFinances = Array.isArray(sim.moduleFinancing) ? sim.moduleFinancing.length : null;

  const revisionServie = typeof faits?.revision === 'number' ? faits.revision : null;
  const revisionLignage = typeof sim.needsSource?.revision === 'number'
    ? sim.needsSource.revision
    : null;

  // `quantiteReference` absente de la réponse ≠ dimension absente du dossier :
  // un serveur qui ne sert pas le champ ne dit rien. `null` = on ne sait pas,
  // et l'écran ne conclut pas.
  const quantite = typeof refData?.quantiteReference === 'number'
    ? refData.quantiteReference
    : null;

  return {
    nbPostes: nbPostesServi ?? nbPostesFinances,
    revision: revisionServie ?? revisionLignage,
    quantite,
    uniteDossier: normaliserUnite(refData?.uniteDossier),
    uniteReferentiel: normaliserUnite(refData?.uniteReference),
    nbCreditsAnterieurs: typeof faits?.nbCreditsAnterieurs === 'number'
      ? faits.nbCreditsAnterieurs
      : null,
    nbGaranties: typeof faits?.nbGaranties === 'number' ? faits.nbGaranties : null,
  };
}

/** Déduplication par code : deux critères bloqués par la même cause ne
 *  produisent qu'une seule ligne d'action — répéter « déposez votre feuille de
 *  besoins » quatre fois ne rend pas l'action plus claire. */
function dedupliquer(motifs: MotifCritere[]): MotifCritere[] {
  const vus = new Set<string>();
  const sortie: MotifCritere[] = [];
  for (const motif of motifs) {
    if (vus.has(motif.code)) continue;
    vus.add(motif.code);
    sortie.push(motif);
  }
  return sortie;
}

/**
 * Construit le rapport client d'une simulation.
 *
 * `null` quand il n'y a rien à restituer (pas de réponse, ou aucun critère
 * servi) : l'appelant affiche alors son état vide, il ne fabrique pas un
 * rapport sans contenu.
 */
export function construireRapport(sim: SimulationLue | null | undefined): RapportCriteres | null {
  const breakdown = Array.isArray(sim?.breakdown) ? sim!.breakdown : [];
  if (!breakdown.length) return null;

  const ctx = contexte(sim!);
  const lignes: LigneRapport[] = [];
  const dossier: MotifCritere[] = [];
  const institution: MotifCritere[] = [];
  let nbNonEvalues = 0;
  let nbMotifsNonRestitues = 0;

  for (const critere of breakdown) {
    const code = String(critere.code ?? '').trim();
    const label = String(critere.label ?? '').trim() || code || 'Critère';
    // `calculable` absent = critère servi par un moteur qui ne l'émet pas
    // (`scoring.py` ne projette que des critères calculés) : évalué par défaut.
    const evalue = critere.calculable !== false;

    if (evalue) {
      lignes.push({ code, label, evalue: true, fondement: fondementEvalue(code, ctx) });
      continue;
    }

    nbNonEvalues += 1;
    const motif = motifServi(critere, ctx) ?? motifConstate(code, ctx) ?? undefined;
    if (!motif) nbMotifsNonRestitues += 1;
    else if (motif.origine === 'institution') institution.push(motif);
    else dossier.push(motif);

    lignes.push({
      code,
      label,
      evalue: false,
      fondement: OBJET_CRITERE[code] ?? 'Ce critère n’a pas pu être examiné.',
      motif,
    });
  }

  // §4.6 — incertitude assumée. La réserve n'est portée que lorsque le serveur
  // la DIT : une comparaison faite contre une plage encore indicative n'a pas
  // l'autorité d'une plage apprise sur des centaines de dossiers.
  const reserves: string[] = [];
  if (sim!.dossier?.referentielIndicatif) {
    reserves.push(
      'Les projets de comparaison de votre filière reposent encore sur un '
      + 'nombre limité de dossiers réels : la comparaison est indicative, et '
      + 'l’instruction pourra la revoir.',
    );
  }

  return {
    lignes,
    manquantsDossier: dedupliquer(dossier),
    manquantsInstitution: dedupliquer(institution),
    nbNonEvalues,
    nbMotifsNonRestitues,
    reserves,
  };
}

/**
 * Phrase de synthèse des non-évaluations — ce qui remplace « votre agent
 * AGRICAP peut vous dire ce qui manque ».
 *
 * `''` quand tout a été évalué : pas de phrase pour ne rien dire.
 */
export function syntheseNonEvalues(rapport: RapportCriteres | null): string {
  if (!rapport || rapport.nbNonEvalues === 0) return '';
  const n = rapport.nbNonEvalues;
  const tete = n === 1
    ? 'Un critère n’a pas pu être évalué'
    : `${n} critères n’ont pas pu être évalués`;

  if (rapport.manquantsDossier.length) {
    return `${tete} : voici ce qu’il manque à votre dossier et ce qui le débloque.`;
  }
  if (rapport.manquantsInstitution.length && !rapport.nbMotifsNonRestitues) {
    return `${tete}, et rien ne manque de votre côté : la cause est chez AGRICAP `
      + 'et votre demande peut suivre son cours.';
  }
  return `${tete}. Aucune information manquante n’a été identifiée dans votre `
    + 'dossier à partir de ce que la simulation restitue ; ces critères seront '
    + 'repris lors de l’instruction.';
}
