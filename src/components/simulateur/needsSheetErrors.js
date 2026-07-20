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
