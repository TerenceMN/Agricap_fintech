/**
 * Traduction des refus serveur en messages actionnables pour le client.
 *
 * CLAUDE.md principe 5 : « réponse 422 structurée {code, message} par erreur,
 * jamais un message générique ». Ce module est le pendant front : chaque code
 * connu devient une phrase qui dit au client **quoi faire**, pas seulement que
 * ça a échoué.
 *
 * ── État du contrat (résolu en juillet 2026) ───────────────────────────────
 * `ApiError` porte `code` et `errors[]` ; `credits/guarantees.py` donne à
 * chaque règle sa propre classe d'exception avec son code. Le routage se fait
 * donc **uniquement** sur `code` : contrat stable, message libre.
 *
 * Le contournement provisoire qui déduisait le code de la *signature textuelle*
 * du `detail` a été **supprimé** dès que le contrat a été livré. Il ne doit pas
 * revenir : router sur le texte casse en silence au premier reformulage, sans
 * erreur de compilation ni test rouge. Il dégradait même certains messages —
 * sur `submit`, le `detail` backend liste les types de garantie admis pour la
 * filière, là où la traduction générique ci-dessous ne le fait pas.
 *
 * Endpoint qui refuse sans `code` ⇒ on relaie son `detail` (rédigé pour
 * l'utilisateur) et on loggue un avertissement : c'est l'endpoint qu'il faut
 * migrer, pas ce fichier qu'il faut étendre.
 */

/** Messages par code canonique. */
export const GUARANTEE_ERROR_MESSAGES = {
  ASSET_NOT_OWNED:
    "Cet actif n'est pas enregistré à votre nom. Seuls les actifs de votre propre inventaire peuvent garantir votre crédit.",
  ASSET_NOT_VERIFIED:
    "Cet actif n'a pas encore été vérifié par un agent de terrain. Un actif simplement déclaré ne peut pas servir de garantie : contactez votre agence pour planifier la vérification.",
  ASSET_ALREADY_PLEDGED:
    "Cet actif est déjà nanti sur un autre dossier de crédit. Il redeviendra mobilisable une fois ce crédit soldé et le gage levé.",
  ASSET_CATEGORY_MISMATCH:
    "La catégorie de cet actif ne correspond à aucun type de garantie (la catégorie « Autre » n'est jamais gageable). Corrigez la catégorie dans Mes Actifs, puis faites-le vérifier.",
  GUARANTEE_TYPE_NOT_ELIGIBLE:
    "Ce type de garantie n'est pas admis pour la filière de votre dossier. Choisissez une garantie d'un autre type parmi celles proposées.",
  ASSET_NO_RETAINED_VALUE:
    "La vérification de cet actif est incomplète : aucune valeur retenue n'a été fixée. L'agent doit terminer le contrôle avant que l'actif puisse couvrir un crédit.",
  ASSET_PLEDGED:
    "Cet actif est nanti sur un dossier de crédit : il ne peut être ni modifié ni supprimé tant que le gage n'est pas levé.",
  FIELD_NOT_WRITABLE:
    "Ce champ est fixé par AGRICAP et ne peut pas être modifié depuis votre espace (le statut et la valeur retenue relèvent de l'agent vérificateur).",
};

/**
 * Extrait le code d'erreur d'une `ApiError`. Routage sur le contrat structuré
 * uniquement — jamais sur le texte du message.
 * @param {unknown} err
 * @returns {string|null}
 */
export function errorCode(err) {
  if (!err || typeof err !== 'object') return null;
  // `credits/views.py` sert `{detail, code, errors:[{code, message}]}` ;
  // `ApiError` expose `code` et `errors`. On accepte les deux formes, plus le
  // corps brut au cas où un appelant le transporterait autrement.
  const body = err.payload || err.body || err.data || null;
  const direct =
    err.code || body?.code
    || (Array.isArray(err.errors) ? err.errors[0]?.code : null)
    || (Array.isArray(body?.errors) ? body.errors[0]?.code : null);
  if (direct) return String(direct);

  // Un 422/409 sans `code` = un endpoint qui n'a pas encore migré vers le
  // format structuré. Le client n'en souffre pas (on relaie le `detail`, qui
  // est rédigé pour lui), mais le trou doit se voir en développement.
  if (err.status === 422 || err.status === 409) {
    console.warn(
      '[garanties] refus serveur sans `code` structuré — endpoint à migrer :',
      err.status, typeof err.message === 'string' ? err.message : '',
    );
  }
  return null;
}

/**
 * Message actionnable à afficher au client pour un refus de garantie/actif.
 * Ne renvoie jamais « une erreur est survenue » : à défaut de code reconnu, on
 * relaie le `detail` du backend, qui est rédigé pour l'utilisateur.
 * @param {unknown} err
 * @param {string} [fallback]
 * @returns {string}
 */
export function guaranteeErrorMessage(err, fallback = "Le serveur a refusé cette opération.") {
  const code = errorCode(err);
  if (code && GUARANTEE_ERROR_MESSAGES[code]) return GUARANTEE_ERROR_MESSAGES[code];

  const detail = err && typeof err.message === 'string' ? err.message : '';
  const status = err && typeof err.status === 'number' ? err.status : null;

  if (detail && !/^Erreur \d+$/.test(detail)) return detail;
  if (status === 403) {
    return "Vous n'avez pas le droit d'effectuer cette opération : le statut et la valeur retenue d'un actif sont fixés par un agent AGRICAP.";
  }
  if (status === 409) return GUARANTEE_ERROR_MESSAGES.ASSET_PLEDGED;
  if (status === 404) return "Élément introuvable — il a peut-être été supprimé entre-temps. Rechargez la page.";
  return fallback;
}
