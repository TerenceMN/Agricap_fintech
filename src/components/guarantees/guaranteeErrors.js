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
 *
 * **Règle** : quand le backend n'envoie pas de code, on n'en invente pas — et
 * on ne déduit pas non plus un motif métier d'un statut HTTP. Un même statut
 * recouvre plusieurs causes (cf. les commentaires de `guaranteeErrorMessage`).
 * Mieux vaut une phrase honnêtement vague qu'une phrase précise et fausse.
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
 * Statuts par lesquels le serveur exprime un refus métier structuré.
 *
 * Le front est **volontairement agnostique au statut** : `submit` répond 400,
 * le gage sur actif 422, un conflit d'état 409. Ces choix peuvent évoluer côté
 * serveur (passer `submit` en 422 serait plus conforme au principe 5) sans
 * qu'aucun écran n'ait à changer. C'est le `code` qui porte le sens.
 */
const REFUSAL_STATUSES = [400, 409, 422];

/**
 * Codes émis par d'autres domaines que les actifs/garanties, et volontairement
 * non traduits ici : leur message serveur est plus précis que ce que le front
 * écrirait (il énumère, il chiffre). Les lister évite que le garde-fou
 * `warnUnknownCode` ne crie sur des cas parfaitement normaux — un avertissement
 * qui se déclenche tout le temps ne signale plus rien.
 *
 * Liste indicative et non bloquante : un code absent d'ici n'est pas une erreur,
 * il déclenche seulement un avertissement en développement.
 */
const RELAYED_CODES = new Set([
  'APPLICATION_INCOMPLETE', 'INVALID_TRANSITION',
  'MAKER_CHECKER_VIOLATION', 'maker_checker_violation',
  'DELEGATION_EXCEEDED', 'delegation_exceeded',
  'CLIENT_CONSENT_MISSING', 'consent_required',
  'CLIENT_CONSENT_EXPIRED', 'consent_expired',
  'ASSET_VERIFY_REFUSED', 'ASSET_REJECT_REFUSED',
  'WORKFLOW_ERROR', 'GUARANTEE_ERROR', 'ERREUR',
]);

/** Signale un code non traduit qui n'est pas dans la liste des relayés connus. */
function warnUnknownCode(code, err) {
  if (RELAYED_CODES.has(code)) return;
  console.warn(
    `[garanties] code serveur « ${code} » non traduit et inconnu — code renommé, ` +
    'ou nouveau code à ajouter à GUARANTEE_ERROR_MESSAGES :',
    err?.status ?? '', typeof err?.message === 'string' ? err.message : '',
  );
}

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

  // Un refus métier sans `code` = un endpoint qui n'a pas encore migré vers le
  // format structuré. Le client n'en souffre pas (on relaie le `detail`, qui
  // est rédigé pour lui), mais le trou doit se voir en développement.
  //
  // 400 est inclus volontairement : `submit` répond 400 tout en servant le
  // format structuré. Le filtre porte sur « refus métier », pas sur un statut
  // particulier — voir `REFUSAL_STATUSES`.
  if (REFUSAL_STATUSES.includes(err.status)) {
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

  // Code présent mais absent de la table : soit un code métier nouveau (normal,
  // le repli sur le message serveur convient), soit **un code que je traduisais
  // et qui a été renommé côté serveur** — ce cas-là fait perdre la traduction
  // sans que rien ne le signale. On le rend visible en développement.
  //
  // Cas sensible connu : `GUARANTEE_TYPE_NOT_ELIGIBLE`, seul code de ma table
  // qui transite aussi par le chemin workflow (`_ineligible_guarantee_errors`).
  // `credits/` migre ses codes vers une convention MAJUSCULE unique ; ce garde-
  // fou est le pendant front de leur test qui verrouille le message.
  if (code) warnUnknownCode(code, err);

  const detail = err && typeof err.message === 'string' ? err.message : '';
  const status = err && typeof err.status === 'number' ? err.status : null;

  // Chemin normal quand le code est inconnu : le `detail` backend est rédigé
  // pour l'utilisateur, il est toujours plus précis que ce qu'on inventerait.
  if (detail && !/^Erreur \d+$/.test(detail)) return detail;

  // Dernier recours : ni code, ni detail. On qualifie la **classe** de refus,
  // sans lui prêter de cause métier.
  //
  // Ce qu'il ne faut surtout pas refaire ici : déduire un motif précis d'un
  // statut HTTP. Un 409 signifie, selon l'endpoint, `ASSET_PLEDGED` (actif
  // nanti), `consent_required` (consentement client manquant) ou
  // `maker_checker_violation` ; un 403 va de `delegation_exceeded` au simple
  // refus de permission. Une version antérieure de ce fichier répondait
  // « cet actif est nanti » à tout 409 — faux, et trompeur sur un écran qui
  // engage un crédit.
  if (status === 403) {
    return "Cette opération vous est refusée. Si vous pensez y avoir droit, contactez votre agence — certaines actions sont réservées aux agents AGRICAP.";
  }
  if (status === 409) {
    return "Cette opération entre en conflit avec l'état actuel du dossier. Rechargez la page pour voir la situation à jour avant de réessayer.";
  }
  if (status === 404) {
    return "Élément introuvable — il a peut-être été supprimé entre-temps. Rechargez la page.";
  }
  return fallback;
}

/**
 * Liste **toutes** les causes d'un refus, une entrée par cause.
 *
 * `submit` agrège plusieurs manques (`APPLICATION_INCOMPLETE` avec
 * `errors: [{SUPERFICIE_MANQUANTE}, {GUARANTEE_TYPE_NOT_ELIGIBLE}, …]`).
 * N'afficher que la première ferait redécouvrir les autres une par une, à
 * chaque tentative — CLAUDE.md principe 5 : « une erreur par cause, jamais un
 * message générique », et le standard frontend « 422 structuré → affichage par
 * erreur ».
 *
 * Chaque entrée est traduite si son code est connu, sinon on relaie le message
 * serveur. Retourne toujours au moins une entrée.
 *
 * @param {unknown} err
 * @returns {Array<{code: string|null, message: string}>}
 */
export function guaranteeErrorList(err) {
  const body = (err && typeof err === 'object' && (err.payload || err.body || err.data)) || null;
  const raw =
    (Array.isArray(err?.errors) && err.errors.length ? err.errors : null)
    || (Array.isArray(body?.errors) && body.errors.length ? body.errors : null);

  if (!raw) return [{ code: errorCode(err), message: guaranteeErrorMessage(err) }];

  return raw.map((entry) => {
    const code = entry?.code ? String(entry.code) : null;
    // Le message serveur prime quand il porte une information que le front ne
    // peut pas reconstituer — typiquement l'énumération des types de garantie
    // admis pour la filière, que le client n'a pas le droit de connaître
    // autrement (principe 7 : `eligible_guarantees` ne descend pas au client).
    const serverMessage = typeof entry?.message === 'string' ? entry.message.trim() : '';
    if (serverMessage) return { code, message: serverMessage };
    return {
      code,
      message: (code && GUARANTEE_ERROR_MESSAGES[code]) || "Cause non précisée par le serveur.",
    };
  });
}
