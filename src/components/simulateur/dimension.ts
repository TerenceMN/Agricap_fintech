/**
 * Dimension du projet — la grandeur à laquelle le référentiel rapporte ses coûts.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * Le moteur compare le plan de financement d'un dossier aux coûts UNITAIRES de
 * sa filière : par hectare pour le maïs, par ruche pour l'apiculture, par sujet
 * pour l'élevage, par m² pour la bioconversion, par sac pour la myciculture, par
 * tonne usinée pour la transformation. Le dossier doit donc porter sa dimension
 * DANS L'UNITÉ DU RÉFÉRENTIEL.
 *
 * `credits/analyse.py::resoudre_quantite_reference` refuse toute conversion :
 * une unité qui ne correspond pas fait échouer l'analyse en 422
 * `DIMENSION_INCOHERENTE`, et c'est un bon refus — il n'existe aucun taux de
 * change entre une ruche et un hectare, et multiplier l'un par l'autre
 * fabriquerait un coût de référence faux, donc un score technique faux (25 % de
 * la note). Le rôle de ce module est de rendre ce refus IMPOSSIBLE À PROVOQUER
 * PAR INADVERTANCE depuis un formulaire : on nomme l'unité attendue, on la
 * verrouille, et on bloque avant l'envoi plutôt qu'après.
 *
 * CE QU'IL NE FAIT PAS
 * --------------------
 * Il ne contient AUCUNE table « filière → unité ». Cette table vit en base
 * (`ReferentielFiliere.unite_reference`) et n'appartient pas au navigateur
 * (principes 6 et 8) : la recopier ici ferait diverger le formulaire du moteur
 * le jour où une filière change d'unité, et le client dimensionnerait alors son
 * dossier dans une unité que le serveur refuse. L'unité vient donc TOUJOURS du
 * serveur ; quand il ne la sert pas, ce module le dit (`source: null`) au lieu
 * de deviner.
 *
 * Aucune arithmétique métier non plus : la quantité saisie n'est ni convertie,
 * ni mise à l'échelle, ni combinée à quoi que ce soit. Elle est transportée.
 */

/** Unité par défaut du modèle historique — les 9 filières mesurées en hectares. */
export const UNITE_HECTARE = 'ha';

/** Forme canonique d'une unité : minuscules, sans espaces superflus.
 *  C'est la comparaison que fait le serveur (`.strip().lower()`) — la refaire à
 *  l'identique évite qu'un « HA » saisi ailleurs passe pour une autre unité. */
export function normaliserUnite(unite: unknown): string {
  return typeof unite === 'string' ? unite.trim().toLowerCase() : '';
}

/**
 * Libellé d'affichage d'une unité canonique.
 *
 * Mapping COSMÉTIQUE uniquement, explicitement permis par le principe 6 (« le
 * backend définit les codes canoniques ; le front mappe pour l'affichage »).
 * Une unité inconnue s'affiche telle quelle : on ne masque jamais un code que
 * le serveur a envoyé, sinon une nouvelle filière deviendrait invisible.
 */
const LIBELLES_UNITE: Record<string, { singulier: string; pluriel: string }> = {
  ha: { singulier: 'hectare', pluriel: 'hectares' },
  ruche: { singulier: 'ruche', pluriel: 'ruches' },
  sujet: { singulier: 'sujet', pluriel: 'sujets' },
  m2: { singulier: 'm²', pluriel: 'm²' },
  sac: { singulier: 'sac', pluriel: 'sacs' },
  t: { singulier: 'tonne usinée', pluriel: 'tonnes usinées' },
};

export function libelleUnite(unite: unknown, quantite?: number | null): string {
  const code = normaliserUnite(unite);
  if (!code) return '';
  const entree = LIBELLES_UNITE[code];
  if (!entree) return code;
  const n = typeof quantite === 'number' ? Math.abs(quantite) : 2;
  return n > 1 ? entree.pluriel : entree.singulier;
}

/** Provenance de l'unité affichée — l'écran doit pouvoir dire d'où elle sort. */
export type SourceUnite = 'simulation' | 'filiere' | null;

export interface UniteResolue {
  /** Unité canonique exigée par le référentiel, ou `null` si le serveur ne l'a
   *  pas (encore) dite. */
  unite: string | null;
  source: SourceUnite;
  /** Code du référentiel qui porte cette unité, quand le serveur le nomme. */
  referentiel?: string | null;
}

/**
 * Unité de référence de la filière, telle que le SERVEUR l'a servie.
 *
 * Deux canaux, du plus autoritatif au plus faible :
 *   1. `refData` d'une simulation — c'est le référentiel que le moteur a
 *      réellement résolu pour ce dossier ; rien ne peut le contredire ;
 *   2. la filière du préremplissage, si elle porte `unite_reference` (champ que
 *      `prefill.py` ne sert pas encore — cf. `CreditPrefillResult`).
 *
 * Retourne `{ unite: null, source: null }` quand aucun des deux ne l'a dite :
 * l'appelant AFFICHE cette ignorance, il ne la comble pas.
 */
export function resoudreUniteReference(args: {
  valueChain?: { unite_reference?: string | null } | null;
  refData?: { uniteReference?: string | null; referentielFiliere?: string | null } | null;
}): UniteResolue {
  const depuisSimulation = normaliserUnite(args.refData?.uniteReference);
  if (depuisSimulation) {
    return {
      unite: depuisSimulation,
      source: 'simulation',
      referentiel: args.refData?.referentielFiliere ?? null,
    };
  }
  const depuisFiliere = normaliserUnite(args.valueChain?.unite_reference);
  if (depuisFiliere) return { unite: depuisFiliere, source: 'filiere', referentiel: null };
  return { unite: null, source: null };
}

export type EtatDimension = 'ok' | 'manquante' | 'invalide' | 'incoherente' | 'unite_inconnue';

export interface VerdictDimension {
  etat: EtatDimension;
  /** Bloque-t-on l'envoi ? Une unité inconnue ne bloque pas : le serveur reste
   *  l'autorité, et un formulaire qui refuse d'avancer parce qu'un champ n'est
   *  pas servi punirait l'utilisateur d'un défaut d'API. */
  bloquant: boolean;
  /** Code aligné sur celui du serveur quand il en existe un — jamais inventé. */
  code?: 'DIMENSION_INCOHERENTE' | 'DIMENSION_MANQUANTE' | 'DIMENSION_INVALIDE';
  message?: string;
}

/**
 * Verdict sur la dimension saisie, AVANT tout appel réseau.
 *
 * `uniteReferentiel` absente = on ne sait pas comparer : état `unite_inconnue`,
 * non bloquant. `uniteSaisie` ≠ `uniteReferentiel` = exactement le refus que le
 * serveur opposera (`DIMENSION_INCOHERENTE`) : autant le dire tout de suite, et
 * avec le même vocabulaire.
 */
export function verifierDimension(args: {
  quantite: string | number | null | undefined;
  uniteSaisie?: string | null;
  uniteReferentiel?: string | null;
}): VerdictDimension {
  const brut = args.quantite;
  const vide = brut === null || brut === undefined || String(brut).trim() === '';
  const valeur = vide ? Number.NaN : Number(brut);
  const uniteSaisie = normaliserUnite(args.uniteSaisie);
  const uniteRef = normaliserUnite(args.uniteReferentiel);

  if (uniteRef && uniteSaisie && uniteSaisie !== uniteRef) {
    return {
      etat: 'incoherente',
      bloquant: true,
      code: 'DIMENSION_INCOHERENTE',
      message:
        `Votre projet est dimensionné en « ${libelleUnite(uniteSaisie)} » alors que `
        + `cette filière se mesure en « ${libelleUnite(uniteRef)} ». Aucune conversion `
        + `n'existe entre ces deux unités : indiquez la quantité dans l'unité de la filière.`,
    };
  }

  if (vide) {
    return {
      etat: 'manquante',
      bloquant: true,
      code: 'DIMENSION_MANQUANTE',
      message: uniteRef
        ? `Indiquez la dimension de votre projet en ${libelleUnite(uniteRef)}.`
        : 'Indiquez la dimension de votre projet.',
    };
  }

  if (!Number.isFinite(valeur) || valeur <= 0) {
    return {
      etat: 'invalide',
      bloquant: true,
      code: 'DIMENSION_INVALIDE',
      message: 'La dimension du projet doit être un nombre strictement positif.',
    };
  }

  if (!uniteRef) {
    return {
      etat: 'unite_inconnue',
      bloquant: false,
      message:
        "L'unité de référence de cette filière n'est pas encore servie par le serveur : "
        + 'la dimension est envoyée telle quelle et sera confrontée au référentiel lors '
        + 'de la simulation.',
    };
  }

  return { etat: 'ok', bloquant: false };
}

/**
 * Corps de requête pour la dimension — `create` et `simulate` partagent la même
 * forme (`quantite_reference` + `unite_reference`).
 *
 * `area_ha` reste envoyé QUAND ET SEULEMENT QUAND l'unité est l'hectare : c'est
 * le champ que `credits/workflow.py` exige encore à la soumission
 * (`SUPERFICIE_MANQUANTE`), et le remplir avec 30 ruches ferait entrer « 30 ha »
 * dans le dossier — précisément la confusion que ce lot supprime.
 */
export function dimensionPayload(args: {
  quantite: string | number | null | undefined;
  unite?: string | null;
}): { area_ha?: number; quantite_reference?: number; unite_reference?: string } {
  const valeur = args.quantite === null || args.quantite === undefined || String(args.quantite).trim() === ''
    ? Number.NaN
    : Number(args.quantite);
  if (!Number.isFinite(valeur) || valeur <= 0) return {};

  const unite = normaliserUnite(args.unite);
  const corps: { area_ha?: number; quantite_reference?: number; unite_reference?: string } = {
    quantite_reference: valeur,
  };
  if (unite) corps.unite_reference = unite;
  if (!unite || unite === UNITE_HECTARE) corps.area_ha = valeur;
  return corps;
}

export interface DimensionProjet {
  /** Unité exigée par le référentiel, telle que servie. `null` = pas encore dite. */
  unite: string | null;
  source: SourceUnite;
  referentiel?: string | null;
  /** Unité dans laquelle la saisie courante est exprimée, et donc envoyée.
   *  C'est `unite` dès que le serveur l'a dite ; sinon l'unité de saisie
   *  mémorisée ; sinon l'hectare, comportement historique du formulaire. */
  uniteEffective: string;
  verdict: VerdictDimension;
  payload: { area_ha?: number; quantite_reference?: number; unite_reference?: string };
  /** `true` quand le serveur vient de révéler une unité qui contredit celle
   *  dans laquelle la valeur a été saisie : la valeur ne peut pas être
   *  convertie, elle doit être ressaisie. L'écran le DEMANDE, il n'efface rien
   *  tout seul — une superficie qui disparaît sans explication est pire qu'un
   *  champ à corriger. */
  ressaisieRequise: boolean;
}

/**
 * État complet de la dimension pour un formulaire — fonction PURE.
 *
 * Rassemble en un seul endroit ce qu'un écran doit savoir : quelle unité
 * afficher, d'où elle vient, si la saisie est acceptable, ce qu'il faut
 * envoyer. Les deux formulaires de demande (espace client et parcours agent)
 * partagent ce raisonnement sans partager leur habillage.
 *
 * `uniteSaisie` est l'unité DANS LAQUELLE la valeur courante a été tapée. Elle
 * n'est pas décorative : c'est elle qui permet de détecter qu'une simulation
 * vient d'apprendre que la filière se mesure en ruches alors que l'utilisateur
 * a saisi des hectares — le seul chemin par lequel une incohérence peut naître
 * dans un formulaire dont l'unité est imposée.
 */
export function etatDimensionProjet(args: {
  quantite: string | number | null | undefined;
  uniteSaisie?: string | null;
  valueChain?: { unite_reference?: string | null } | null;
  refData?: { uniteReference?: string | null; referentielFiliere?: string | null } | null;
}): DimensionProjet {
  const { unite, source, referentiel } = resoudreUniteReference({
    valueChain: args.valueChain, refData: args.refData,
  });
  const uniteSaisie = normaliserUnite(args.uniteSaisie);
  const uniteEffective = unite || uniteSaisie || UNITE_HECTARE;

  const verdict = verifierDimension({
    quantite: args.quantite,
    uniteSaisie: uniteSaisie || uniteEffective,
    uniteReferentiel: unite,
  });

  return {
    unite,
    source,
    referentiel,
    uniteEffective,
    verdict,
    // Une saisie incohérente n'est jamais transmise : le serveur la refuserait,
    // et l'envoyer quand même ferait porter le refus par l'analyse plutôt que
    // par le formulaire.
    payload: verdict.etat === 'incoherente'
      ? {}
      : dimensionPayload({ quantite: args.quantite, unite: uniteEffective }),
    ressaisieRequise: verdict.etat === 'incoherente',
  };
}

/**
 * Le serveur a-t-il RETENU la dimension envoyée ?
 *
 * `dataio_simulate` renvoie dans `refData` la dimension qu'il a effectivement
 * utilisée. Tant que `credits/views.py::simulate_scoring` ne relaie pas
 * `quantite_reference` / `unite_reference`, un dossier apicole est simulé en
 * hectares sans que rien ne le signale : la fiabilité technique sort « non
 * calculable » et personne ne sait pourquoi. Cette fonction rend l'écart
 * visible — c'est un CONSTAT sur la réponse, pas un calcul métier.
 *
 * `null` quand la comparaison n'est pas possible (pas de `refData`).
 */
export function dimensionRetenueParLeServeur(args: {
  refData?: { uniteDossier?: string | null; quantiteReference?: number | null } | null;
  quantiteEnvoyee: string | number | null | undefined;
  uniteEnvoyee?: string | null;
}): { retenue: boolean; uniteServeur: string | null; quantiteServeur: number | null } | null {
  const refData = args.refData;
  if (!refData) return null;

  const uniteServeur = normaliserUnite(refData.uniteDossier) || null;
  const quantiteServeur = typeof refData.quantiteReference === 'number'
    ? refData.quantiteReference
    : null;
  if (uniteServeur === null && quantiteServeur === null) return null;

  const uniteEnvoyee = normaliserUnite(args.uniteEnvoyee) || null;
  const quantiteEnvoyee = Number(args.quantiteEnvoyee);

  const memeUnite = uniteEnvoyee === null || uniteServeur === null || uniteEnvoyee === uniteServeur;
  const memeQuantite = !Number.isFinite(quantiteEnvoyee) || quantiteServeur === null
    ? true
    : Math.abs(quantiteServeur - quantiteEnvoyee) < 1e-6;

  return { retenue: memeUnite && memeQuantite, uniteServeur, quantiteServeur };
}
