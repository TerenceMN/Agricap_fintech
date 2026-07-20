/**
 * Traduction des refus serveur **propres au parcours du garant** (lot 6).
 *
 * Contrat : `docs/status-fragments/lot6-backend.md` §1.2 — les onze codes du
 * tableau sont tous traduits ici, aucun n'est décoratif.
 *
 * ── Pourquoi un fichier séparé de `guaranteeErrors.js` ─────────────────────
 * `guaranteeErrors.js` couvre le parcours du **demandeur** (pose d'un gage sur
 * actif, soumission du dossier). Les codes ci-dessous concernent le **garant**,
 * un autre utilisateur, sur un autre écran, avec un autre vocabulaire d'action.
 * Les fusionner ferait une table où la moitié des entrées ne peut jamais sortir
 * sur l'écran qui la consulte — et le garde-fou « code inconnu » perdrait son
 * sens sur les deux écrans.
 *
 * La **convention**, elle, est reprise telle quelle et c'est ce qui compte :
 *   1. le routage se fait sur `code`, jamais sur le texte du message ;
 *   2. un code non traduit n'est pas avalé — on relaie le `detail` backend
 *      (rédigé pour l'utilisateur) et on avertit en développement ;
 *   3. on n'invente pas de motif métier à partir d'un statut HTTP.
 * Le repli délègue à `guaranteeErrorMessage()`, qui porte déjà ces trois règles :
 * il n'y a pas deux implémentations à maintenir en phase.
 *
 * ── Les cinq règles de capacité sortent aussi ici ──────────────────────────
 * `GUARANTOR_OVEREXTENDED`, `GUARANTOR_TOO_MANY_PLEDGES`, `GUARANTOR_IN_DEFAULT`,
 * `CROSS_GUARANTEE_FORBIDDEN` et `GUARANTOR_NOT_IN_GROUP` sont des règles de la
 * *pose* (SPEC §2.5) que le backend **re-vérifie intégralement au consentement** :
 * l'engagement se forme au clic du garant, pas à sa désignation, et entre les
 * deux il a pu s'engager ailleurs, tomber en défaut ou quitter le groupe.
 * Leur formulation ici est donc écrite au moment du refus vécu par le garant,
 * pas au moment de la désignation par le demandeur.
 *
 * Ton retenu : ces refus ne sont pas des erreurs de manipulation, ce sont des
 * protections. Un garant surengagé à qui l'on refuse une caution de plus est
 * protégé, pas puni — les messages le disent.
 */
import { errorCode, guaranteeErrorMessage } from './guaranteeErrors';

/** Messages par code canonique — contrat §1.2. */
export const GUARANTOR_ERROR_MESSAGES = {
  // ── Forme de la requête ────────────────────────────────────────────────
  ACCEPT_REQUIRED:
    "Votre réponse n'a pas été transmise correctement au serveur. Rechargez la page "
    + 'et cliquez à nouveau sur Accepter ou sur Refuser.',

  // ── Autorisation ───────────────────────────────────────────────────────
  GUARANTOR_NOT_DESIGNATED:
    "Vous n'êtes pas le garant désigné de cette demande : vous ne pouvez pas y répondre. "
    + 'Si vous pensez le contraire, contactez votre agence — personne d’autre que le garant '
    + 'nommé sur un dossier ne peut engager sa caution.',

  // ── État de la demande ─────────────────────────────────────────────────
  GUARANTOR_ALREADY_ANSWERED:
    'Vous avez déjà répondu à cette demande. Une réponse est définitive : elle ne peut être '
    + 'ni modifiée ni reprise depuis cet écran. Rechargez la page pour voir votre réponse '
    + 'enregistrée ; pour la contester, adressez-vous à votre agence.',

  INVALID_GUARANTEE_STATE:
    "Cette caution a changé d'état pendant que vous consultiez la page — elle a été levée "
    + 'ou appelée entre-temps. Rechargez la page pour voir la situation à jour.',

  GUARANTOR_CONSENT_EXPIRED:
    'Le délai de réponse est dépassé : cette demande est caduque et votre réponse ne peut '
    + "plus être enregistrée. Si vous souhaitez toujours vous porter garant, le demandeur "
    + 'doit vous solliciter à nouveau depuis son dossier.',

  // ── Capacité d'engagement, re-vérifiée au consentement (§1.2) ──────────
  GUARANTOR_OVEREXTENDED:
    "Votre capacité d'engagement est atteinte : le total de vos cautions en cours, augmenté "
    + 'de celle-ci, dépasserait le plafond adossé à votre épargne AGRICAP. Vous pourrez à '
    + "nouveau vous porter garant quand l'un des crédits que vous cautionnez sera soldé, ou "
    + 'après avoir renforcé votre épargne. Cette limite vous protège : elle empêche que vous '
    + 'soyez appelé au-delà de vos moyens.',

  GUARANTOR_TOO_MANY_PLEDGES:
    'Vous avez atteint le nombre maximal de cautions actives autorisé. Attendez qu’un des '
    + 'crédits que vous garantissez soit soldé pour en accepter une nouvelle.',

  GUARANTOR_IN_DEFAULT:
    'Un incident de remboursement est enregistré à votre nom — crédit en défaut ou en '
    + "blocage, ou caution déjà appelée et non soldée. Tant qu'il n'est pas régularisé, vous "
    + 'ne pouvez pas garantir un nouveau crédit. Rapprochez-vous de votre agence pour faire '
    + 'le point sur votre situation.',

  CROSS_GUARANTEE_FORBIDDEN:
    'Le demandeur garantit déjà un de vos crédits en cours. Deux personnes qui se cautionnent '
    + "mutuellement ne se garantissent en réalité ni l'une ni l'autre : en cas de difficulté, "
    + 'les deux dossiers tombent ensemble. Cette demande doit être portée par un autre garant.',

  // ── Défaut de la demande elle-même ─────────────────────────────────────
  // Sort à la **pose** (`guarantees/moral/`, §1.3), pas au consentement : une
  // caution à montant nul ou négatif n'est jamais créée, donc jamais servie à
  // cet écran. Traduit quand même — le coût est nul, et si ce code atteignait un
  // jour le garant, la phrase générique de repli ne lui dirait rien d'utile.
  GUARANTOR_INVALID_AMOUNT:
    "Le montant à garantir est absent ou invalide : cette demande n'a pas pu être "
    + 'constituée. Le demandeur doit la reprendre depuis son dossier. Vous n’avez rien '
    + 'à faire, et rien ne vous engage.',

  GUARANTOR_NOT_IN_GROUP:
    "Vous n'avez plus de groupe ni de coopérative en commun avec le demandeur. La caution "
    + 'solidaire repose sur ce lien : elle ne peut être donnée qu’entre membres d’un même '
    + 'groupe. Si votre affiliation a changé récemment, signalez-le à votre agence.',
};

/**
 * Message actionnable pour un refus du parcours garant.
 *
 * Code connu → message enrichi ci-dessus. Sinon → délégation à
 * `guaranteeErrorMessage()`, qui relaie le `detail` du serveur et avertit en
 * développement. Ne renvoie jamais « une erreur est survenue » tout court.
 *
 * Le 404 du contrat §1.2 arrive **sans `code`** (id inconnu, ou garantie qui
 * n'est pas une caution morale) : il tombe donc dans le repli, qui a déjà une
 * phrase juste pour ce cas (« Élément introuvable […] Rechargez la page. »).
 * Lui fabriquer une clé ici n'apporterait rien, puisqu'il n'y a pas de code sur
 * lequel router.
 *
 * @param {unknown} err
 * @param {string} [fallback]
 * @returns {string}
 */
export function guarantorErrorMessage(err, fallback) {
  const code = errorCode(err);
  if (code && GUARANTOR_ERROR_MESSAGES[code]) return GUARANTOR_ERROR_MESSAGES[code];
  return guaranteeErrorMessage(
    err,
    fallback || "Le serveur a refusé d'enregistrer votre réponse.",
  );
}

/**
 * Liste **toutes** les causes d'un refus, une entrée par cause — pendant garant
 * de `guaranteeErrorList()`.
 *
 * Le consentement n'agrège probablement qu'une cause à la fois (contrairement à
 * `submit`), mais rien dans le contrat ne l'interdit et le coût de le prévoir
 * est nul : mieux vaut afficher les trois raisons d'un coup que les faire
 * découvrir une par une.
 *
 * @param {unknown} err
 * @returns {Array<{code: string|null, message: string}>}
 */
export function guarantorErrorList(err) {
  const body = (err && typeof err === 'object' && (err.payload || err.body || err.data)) || null;
  const raw =
    (Array.isArray(err?.errors) && err.errors.length ? err.errors : null)
    || (Array.isArray(body?.errors) && body.errors.length ? body.errors : null);

  if (!raw) return [{ code: errorCode(err), message: guarantorErrorMessage(err) }];

  return raw.map((entry) => {
    const code = entry?.code ? String(entry.code) : null;
    // Ma traduction prime ici sur le message serveur, à l'inverse du choix fait
    // dans `guaranteeErrorList`. La raison est propre à cet écran : côté
    // demandeur, le serveur énumère des informations que le front ne peut pas
    // reconstituer (types de garantie admis pour la filière). Côté garant, le
    // serveur n'énumère rien — principe 7, il ne descend au garant ni les
    // plafonds d'engagement, ni la décote, ni le score du dossier. Un `detail`
    // du type « capacité d'engagement dépassée » ne dit donc pas au garant que
    // la limite le protège, ni quand il pourra à nouveau s'engager.
    if (code && GUARANTOR_ERROR_MESSAGES[code]) {
      return { code, message: GUARANTOR_ERROR_MESSAGES[code] };
    }
    const serverMessage = typeof entry?.message === 'string' ? entry.message.trim() : '';
    if (serverMessage) return { code, message: serverMessage };
    return { code, message: 'Cause non précisée par le serveur.' };
  });
}
