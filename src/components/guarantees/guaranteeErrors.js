/**
 * Traduction des refus serveur en messages actionnables pour le client.
 *
 * CLAUDE.md principe 5 : « réponse 422 structurée {code, message} par erreur,
 * jamais un message générique ». Ce module est le pendant front : chaque code
 * connu devient une phrase qui dit au client **quoi faire**, pas seulement que
 * ça a échoué.
 *
 * ── État du contrat (résolu en juillet 2026) ───────────────────────────────
 * `ApiError` porte désormais `code` et `errors[]`, et `credits/guarantees.py`
 * donne à chaque règle sa propre classe d'exception avec son code. Le chemin
 * nominal est donc `err.code` — routage sur un contrat stable.
 *
 * `DETAIL_SIGNATURES` reste en filet de sécurité pour les endpoints qui
 * n'émettraient pas encore de `code`, mais ce n'est plus le chemin normal :
 * ne l'étends pas, ajoute le `code` côté serveur. Router sur le texte casse
 * silencieusement au premier reformulage d'un message.
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
 * Signatures des `detail` backend → code, faute de `code` exposé par ApiError.
 * L'ordre compte : les motifs les plus spécifiques d'abord.
 */
const DETAIL_SIGNATURES = [
  [/n['’]appartenant pas|introuvable ou n/i, 'ASSET_NOT_OWNED'],
  [/déjà nanti|deja nanti/i, 'ASSET_ALREADY_PLEDGED'],
  [/nanti/i, 'ASSET_PLEDGED'],
  [/pas été vérifié|pas ete verifie/i, 'ASSET_NOT_VERIFIED'],
  [/aucun type de garantie/i, 'ASSET_CATEGORY_MISMATCH'],
  [/n['’]est pas admise pour la filière|pas admise pour la filiere/i, 'GUARANTEE_TYPE_NOT_ELIGIBLE'],
  [/valeur retenue/i, 'ASSET_NO_RETAINED_VALUE'],
  [/non modifiables par le client/i, 'FIELD_NOT_WRITABLE'],
];

/**
 * Extrait le code d'erreur d'une ApiError, par le champ `code` s'il existe,
 * sinon par la signature du message backend.
 * @param {unknown} err
 * @returns {string|null}
 */
export function errorCode(err) {
  if (!err || typeof err !== 'object') return null;
  // `credits/views.py` sert désormais `{detail, code, errors:[{code, message}]}`.
  // On accepte les deux formes : `code` scalaire et première entrée d'`errors`.
  const body = err.payload || err.body || err.data || null;
  const direct =
    err.code || body?.code
    || (Array.isArray(err.errors) ? err.errors[0]?.code : null)
    || (Array.isArray(body?.errors) ? body.errors[0]?.code : null);
  if (direct) return String(direct);
  const detail = typeof err.message === 'string' ? err.message : '';
  if (!detail) return null;
  for (const [pattern, code] of DETAIL_SIGNATURES) {
    if (pattern.test(detail)) return code;
  }
  // Un 422/409 dont aucune signature ne reconnaît le motif = soit une règle
  // serveur nouvelle, soit un message backend reformulé qui a désaccordé la
  // table ci-dessus. La dégradation reste correcte pour le client (on relaie
  // le `detail`, qui est rédigé pour lui), mais elle serait silencieuse pour
  // le développeur : on la rend bruyante. C'est le garde-fou du contournement,
  // pas sa justification — le correctif reste de faire porter le `code` par
  // `ApiError` (voir l'en-tête de ce fichier).
  if (err.status === 422 || err.status === 409) {
    console.warn(
      '[garanties] refus serveur non reconnu — vérifier DETAIL_SIGNATURES ' +
      'vs les messages de credits/guarantees.py :', err.status, detail,
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
