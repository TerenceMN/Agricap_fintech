/**
 * Refus de `POST /credits/needs-sheet/parse/` → consignes actionnables.
 *
 * Le backend (`credits/needs_sheet.py`) renvoie un 422 avec **une entrée par
 * erreur** : `{code, message}`, où le message chiffre déjà l'écart constaté
 * (« la feuille 5 annonce 1330,00 alors que la somme des lignes vaut 1120,00 »).
 * Ce message-là est plus précis que tout ce que le front pourrait rédiger : on
 * le relaie tel quel (c'est `guaranteeErrorList` qui s'en charge).
 *
 * Ce module n'ajoute donc **que la couche pédagogique** : pour chaque code, le
 * geste à faire dans le classeur. Cf. CLAUDE.md §4.6 — chaque anomalie est
 * livrée avec le fait, la cause probable, et ce qu'on demande à l'utilisateur.
 */

/** Gravité d'affichage. `manipulation` n'accuse pas : il attire l'œil. */
export const NEEDS_SHEET_HINTS = {
  FEUILLE_MANQUANTE: {
    titre: 'Feuille absente du classeur',
    conseil:
      "Repartez du template officiel et ne renommez ni ne supprimez les feuilles "
      + '« 4_Besoins_Financiers » et « 5_Synthese_Besoins ».',
  },
  COLONNE_MANQUANTE: {
    titre: 'Colonne absente',
    conseil:
      "N'effacez pas la ligne d'en-tête du template : c'est elle qui identifie les "
      + 'colonnes. Ajoutez vos lignes en dessous, sans déplacer les colonnes.',
  },
  RUBRIQUE_MANQUANTE: {
    titre: 'Rubrique absente de la synthèse',
    conseil:
      'Les 8 rubriques doivent figurer en feuille 5, même à 0. Ne supprimez pas les '
      + "lignes que vous n'utilisez pas : laissez-les à zéro.",
  },
  RUBRIQUE_INCONNUE: {
    titre: 'Rubrique non reconnue',
    conseil:
      'Utilisez la liste déroulante de la colonne « Rubrique » : une rubrique saisie '
      + 'à la main ne peut être rattachée à aucun poste de financement.',
  },
  TYPE_INVALIDE: {
    titre: 'Valeur non numérique',
    conseil:
      'Saisissez des nombres seuls, sans devise ni texte dans la cellule (« 1 200 » et '
      + 'non « 1 200 USD »). Aucune valeur ne peut être négative.',
  },
  INCOHERENCE_INTERNE: {
    titre: 'La synthèse ne découle plus du détail',
    accent: true,
    conseil:
      'La feuille 5 doit se calculer automatiquement depuis la feuille 4. Un écart '
      + "signifie qu'un total a été saisi ou collé à la main par-dessus la formule. "
      + 'Corrigez vos lignes en feuille 4 et laissez la feuille 5 se recalculer seule : '
      + "un montant qui ne s'appuie sur aucune ligne de détail ne peut pas être instruit.",
  },
  TOTAL_INCOHERENT: {
    titre: 'Total général incohérent',
    accent: true,
    conseil:
      'Le TOTAL GÉNÉRAL doit être la somme des 8 rubriques. Rétablissez la formule de '
      + 'cette cellule plutôt que de saisir le montant voulu.',
  },
  CLASSEUR_ILLISIBLE: {
    titre: 'Classeur illisible',
    conseil:
      'Ré-enregistrez le fichier au format .xlsx depuis Excel ou LibreOffice, puis '
      + 'réessayez.',
  },
  CLASSEUR_NON_RECONNU: {
    titre: "Ce n'est pas une feuille de besoins",
    conseil:
      'Téléchargez le template officiel ci-dessus et remplissez-le : un autre classeur '
      + "(simulateur, référentiel) n'a pas la structure attendue.",
  },
  FORMAT_INVALIDE: {
    titre: 'Format de fichier refusé',
    conseil: 'Seuls les classeurs .xlsx sont acceptés — ni .xls, ni .xlsm, ni .csv.',
  },
  APPLICATION_NOT_DRAFT: {
    titre: 'Dossier non modifiable',
    conseil:
      'Une fois le dossier soumis, la feuille de besoins est figée : elle est la base de '
      + "l'instruction. Contactez votre agence si un chiffre doit être corrigé.",
  },
  NEEDS_SOURCE_MISSING: {
    titre: 'Aucune feuille de besoins',
    conseil:
      'Téléversez votre feuille de besoins avant de lancer la simulation : le score se '
      + 'calcule sur les montants du fichier, jamais sur une saisie.',
  },
};

/**
 * Complément pédagogique d'une cause de refus, ou `null` si le code est inconnu.
 * @param {string|null|undefined} code
 * @returns {{titre: string, conseil: string, accent?: boolean}|null}
 */
export function needsSheetHint(code) {
  if (!code) return null;
  return NEEDS_SHEET_HINTS[code] || null;
}

// ── Refus du fichier vs panne de transport ───────────────────────────────────
//
// Distinction indispensable, et pas cosmétique. Tout échec affiché sous
// « N points à corriger dans votre fichier » dit au client que SON CLASSEUR est
// en cause. Si un jeton expire ou si le serveur tombe, ce cadre l'envoie
// modifier un fichier parfaitement valide — il « corrigera » jusqu'à casser un
// document qui n'avait rien. Un écran qui se trompe de coupable coûte plus cher
// qu'un écran qui dit simplement « réessayez ».

/** Statuts par lesquels le serveur met en cause le CONTENU du classeur. */
const VALIDATION_STATUSES = [400, 409, 422];

/**
 * Refus métier BLOQUANTS qui empruntent le même statut qu'un refus de fichier.
 *
 * Un 422 ne dit pas toujours « votre classeur est mauvais ». Certaines règles de
 * gouvernance refusent l'opération elle-même, quel que soit le contenu du
 * fichier : re-téléverser ne les lèvera JAMAIS. Les afficher sous « N points à
 * corriger dans votre fichier » envoie le client modifier un classeur
 * irréprochable, en boucle, sans qu'aucune correction ne change quoi que ce soit.
 *
 * Ces codes prennent donc le cadre « ce n'est pas votre fichier », avec l'action
 * réelle à accomplir.
 */
const BUSINESS_BLOCKING_CODES = new Set([
  // Un membre du personnel ne peut pas être bénéficiaire d'un crédit : il serait
  // juge et partie. L'action est d'assigner le dossier à un client, pas de
  // toucher au classeur.
  'BENEFICIAIRE_INTERNE',
]);

/** Le refus vient-il d'une règle de gouvernance plutôt que du classeur ? */
export function isBusinessBlockingError(err) {
  const code = err && typeof err === 'object' ? err.code : null;
  if (code && BUSINESS_BLOCKING_CODES.has(code)) return true;
  // Le code peut aussi arriver dans le détail d'un 422 structuré.
  const causes = err && Array.isArray(err.errors) ? err.errors : [];
  return causes.some((c) => c && BUSINESS_BLOCKING_CODES.has(c.code));
}

/**
 * L'échec porte-t-il sur le fichier (→ cadre « à corriger ») ou sur le
 * transport (→ cadre « réessayez, ne touchez pas à votre classeur ») ?
 *
 * Un 422 du pipeline porte toujours `errors[]` ; on l'accepte donc même si le
 * statut évoluait. 401 / 403 / 404 / 5xx / échec réseau ne disent jamais rien
 * du contenu du classeur.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isFileValidationError(err) {
  if (!err || typeof err !== 'object') return false;
  // Une règle de gouvernance passe avant le statut : un 422 « bénéficiaire
  // interne » n'est pas un défaut de classeur, et aucun re-téléversement ne le
  // lèvera.
  if (isBusinessBlockingError(err)) return false;
  if (Array.isArray(err.errors) && err.errors.length > 0) return true;
  return VALIDATION_STATUSES.includes(err.status);
}

/**
 * Message d'un échec qui n'est PAS imputable au fichier. Nomme la cause quand
 * le statut la donne, reste vague sinon — jamais un motif métier inventé.
 *
 * @param {unknown} err
 * @returns {{titre: string, message: string, reconnexion?: boolean}}
 */
export function transportErrorMessage(err) {
  const status = err && typeof err.status === 'number' ? err.status : null;

  // Refus de gouvernance : le classeur n'est pas en cause, et le dire est le
  // seul moyen d'éviter que le client le « corrige » indéfiniment. On relaie le
  // message du serveur, qui nomme déjà la personne et le rôle en cause.
  if (isBusinessBlockingError(err)) {
    const cause = (Array.isArray(err?.errors) ? err.errors : [])
      .find((c) => c && BUSINESS_BLOCKING_CODES.has(c.code));
    return {
      titre: 'Ce crédit doit être assigné à un client',
      message:
        (cause?.message || err?.message
          || "Un membre du personnel ne peut pas être bénéficiaire d'un crédit.")
        + ' Votre classeur n\'est pas en cause : le modifier ou le téléverser à nouveau ne '
        + 'changera rien. Reprenez la demande en désignant le client bénéficiaire.',
    };
  }

  // Garde-fou local : sans code de dossier utilisable, l'envoi partirait avec
  // `application_code=""`, que le backend lit comme « pas de dossier » et qui le
  // fait basculer sur le parse hérité — en mémoire, sans ingestion ni révision.
  // Le client verrait « feuille enregistrée » sur une feuille jamais ingérée.
  if (err && err.code === 'DRAFT_CODE_MISSING') {
    return {
      titre: "Votre dossier n'a pas pu être ouvert",
      message:
        "La feuille n'a pas été envoyée : AGRICAP n'a pas pu créer le dossier qui doit la "
        + 'recevoir. Rechargez la page et réessayez — votre classeur n\'est pas en cause.',
    };
  }

  if (status === 401) {
    return {
      titre: 'Votre session a expiré',
      reconnexion: true,
      message:
        "Votre fichier n'a pas été envoyé — il n'a rien à se reprocher. Reconnectez-vous, "
        + 'puis téléversez-le à nouveau tel quel.',
    };
  }
  if (status === 403) {
    return {
      titre: 'Envoi refusé',
      message:
        "Vous n'avez pas l'autorisation de déposer une feuille sur ce dossier. Si vous pensez "
        + 'y avoir droit, contactez votre agence — ne modifiez pas votre classeur.',
    };
  }
  if (status === 404) {
    return {
      titre: 'Dossier introuvable',
      message:
        'Le dossier rattaché à cette demande est introuvable. Rechargez la page ; votre classeur '
        + "n'est pas en cause.",
    };
  }
  if (status && status >= 500) {
    return {
      titre: 'Le service est momentanément indisponible',
      message:
        "L'envoi a échoué côté AGRICAP, pas dans votre fichier. Réessayez dans quelques instants "
        + 'avec le même classeur.',
    };
  }
  return {
    titre: "L'envoi n'a pas abouti",
    message:
      'Votre feuille n\'a pas pu être transmise — vérifiez votre connexion et réessayez. '
      + "Ne modifiez pas votre classeur : rien n'indique qu'il soit en cause.",
  };
}
