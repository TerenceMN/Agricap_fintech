/**
 * Lecture d'une demande de caution servie par
 * `GET /api/credits/guarantee-requests/`.
 *
 * Contrat : `docs/status-fragments/lot6-backend.md` §1.1, publié figé par
 * `lot6-backend` avant implémentation. Les clés lues ici sont **exactement**
 * celles du contrat — aucune orthographe alternative n'est tentée. Une première
 * version de ce fichier acceptait camelCase et snake_case indifféremment, écrite
 * pendant que le contrat n'existait pas ; elle a été retirée dès sa publication.
 * Une souplesse de lecture qui survit au contrat qu'elle attendait ne protège
 * plus de rien : elle empêche seulement de voir que le serveur a changé de forme.
 *
 * Enveloppe hybride assumée côté serveur : clés de **liste** en `snake_case`
 * (`total_rows`, `consent_window_hours`, comme `assets/mine`), clés d'**item** en
 * `camelCase` (comme `serialize_application`). C'est la convention déjà en place
 * dans le dépôt, pas une troisième forme.
 *
 * Ce fichier est le seul endroit de l'écran qui touche aux clés de l'API :
 * `GuaranteeRequests.jsx` et les composants ne connaissent que la forme
 * canonique produite ici.
 *
 * Règle tenue de bout en bout : **rien n'est calculé**. Un champ absent vaut
 * `null`, l'interface le dit (« non communiqué »), et `warnMissing()` le crie en
 * développement. Un montant manquant ne devient jamais 0 — sur cet écran, 0
 * serait un engagement faux.
 */

/** Nombre servi par l'API, ou `null`. Ne convertit jamais l'absence en 0. */
function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Statuts du contrat §1.1. */
export const REQUEST_STATUS = {
  PENDING: 'pending_consent',
  CONSENTED: 'consented',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  /** Caution constituée par l'agent — équivalent du `constituted` de la SPEC. */
  ACTIVE: 'active',
  RELEASED: 'released',
  CALLED: 'called',
};

/**
 * Présentation par statut. Une demande **expirée n'est pas une demande en
 * attente** : elle ne porte ni le même badge, ni les mêmes actions, et l'écran
 * la range dans un autre bloc.
 *
 * `actionable` décide de l'affichage des boutons Accepter / Refuser. C'est une
 * restitution du statut serveur, jamais une inférence : le serveur re-vérifie
 * de toute façon à l'appel (§1.2), le front ne fait que ne pas proposer un acte
 * dont il sait déjà qu'il sera refusé.
 */
export const REQUEST_STATUS_META = {
  [REQUEST_STATUS.PENDING]: {
    label: 'En attente de votre réponse',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    actionable: true,
  },
  [REQUEST_STATUS.CONSENTED]: {
    label: 'Vous avez accepté',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    actionable: false,
  },
  [REQUEST_STATUS.DECLINED]: {
    label: 'Vous avez refusé',
    badge: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
    actionable: false,
  },
  [REQUEST_STATUS.EXPIRED]: {
    label: 'Délai dépassé — demande caduque',
    badge: 'bg-red-500/15 text-red-300 border-red-500/40',
    actionable: false,
  },
  [REQUEST_STATUS.ACTIVE]: {
    label: 'Caution constituée',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    actionable: false,
  },
  [REQUEST_STATUS.RELEASED]: {
    label: 'Caution levée',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
    actionable: false,
  },
  [REQUEST_STATUS.CALLED]: {
    label: 'Caution appelée',
    badge: 'bg-red-500/20 text-red-200 border-red-500/50',
    actionable: false,
  },
};

/** Métadonnée d'un statut inconnu — visible en développement, jamais silencieuse. */
export function statusMeta(status) {
  const known = status ? REQUEST_STATUS_META[status] : null;
  if (known) return known;
  if (status) {
    console.warn(
      `[caution] statut « ${status} » absent de REQUEST_STATUS_META — statut ajouté `
      + 'côté serveur sans mise à jour du contrat §1.1. Aucune action ne sera proposée.',
    );
  }
  return {
    label: status ? `Statut : ${status}` : 'Statut non communiqué',
    badge: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
    // Défaut prudent : un statut qu'on ne comprend pas n'ouvre pas un acte
    // juridique. Le garant voit la demande, sans pouvoir s'engager par erreur.
    actionable: false,
  };
}

/**
 * Présentation **effectivement affichée** pour une demande.
 *
 * ── Pourquoi `status` seul ne suffit pas ───────────────────────────────────
 * L'expiration n'est matérialisée en base qu'à la lecture : il n'y a pas
 * d'ordonnanceur qui bascule les demandes en `expired` (pas de Celery dans le
 * projet — limite assumée, `lot6-backend.md` §6). Une demande dont la fenêtre
 * est dépassée est donc servie avec `status: "pending_consent"` **et**
 * `isExpired: true`.
 *
 * `isActionable()` traitait déjà ce cas et retirait les boutons. Le **badge**,
 * lui, lisait `status` seul : la carte affichait « En attente de votre réponse »
 * en ambre sur une demande morte, rangée dans l'historique. Contradiction dans
 * la même carte, et exactement le contraire de la consigne « une demande expirée
 * n'est pas une demande en attente ».
 *
 * `isExpired` prime donc sur `status` partout où l'on présente l'état. Les deux
 * viennent du serveur ; aucune comparaison de date n'intervient.
 */
export function displayStatusMeta(request) {
  if (request?.isExpired) return REQUEST_STATUS_META[REQUEST_STATUS.EXPIRED];
  return statusMeta(request?.status);
}

/**
 * Champs sans lesquels la carte ne peut pas être honnête. Leur absence est un
 * défaut de contrat, pas un cas métier — d'où l'avertissement bruyant.
 * `coveredAmount` en fait partie : c'est le montant de l'engagement.
 */
const REQUIRED = ['id', 'applicantName', 'coveredAmount', 'status'];

function warnMissing(normalized, raw) {
  const missing = REQUIRED.filter((k) => normalized[k] === null || normalized[k] === undefined);
  if (missing.length === 0) return;
  console.warn(
    `[caution] demande incomplète — champs absents : ${missing.join(', ')}. `
    + 'Écart au contrat `lot6-backend.md` §1.1. Objet reçu :',
    raw,
  );
}

/**
 * Normalise une demande brute (§1.1) vers la forme consommée par l'écran.
 *
 * @param {Record<string, any>} raw
 */
export function normalizeRequest(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const applicant = source.applicant && typeof source.applicant === 'object'
    ? source.applicant : {};
  const chain = source.valueChain && typeof source.valueChain === 'object'
    ? source.valueChain : {};

  const normalized = {
    id: source.id ?? null,
    applicationCode: str(source.applicationCode),
    status: str(source.status),

    applicantName: str(applicant.displayName),
    /** Groupes **communs** au demandeur et au garant — la justification du lien. */
    sharedGroups: Array.isArray(applicant.sharedGroups)
      ? applicant.sharedGroups
        .filter((g) => g && typeof g === 'object')
        .map((g) => ({ id: g.id ?? null, name: str(g.name), type: str(g.type) }))
      : [],

    // `label` est prêt à afficher (contrat) ; le front ne mappe aucune des deux
    // nomenclatures de filières du projet (CLAUDE.md §6) — il affiche ce libellé.
    valueChainLabel: str(chain.label),
    valueChainCode: str(chain.code),

    loanAmount: num(source.loanAmount),
    loanCurrency: str(source.loanCurrency),
    coveredAmount: num(source.coveredAmount),
    coveredCurrency: str(source.coveredCurrency),

    consentExpiresAt: str(source.consentExpiresAt),
    consentedAt: str(source.consentedAt),
    declinedAt: str(source.declinedAt),
    createdAt: str(source.createdAt),
    /** Servi par le serveur — jamais déduit de l'horloge du navigateur. */
    isExpired: source.isExpired === true,
  };

  warnMissing(normalized, raw);
  return normalized;
}

/**
 * Normalise l'enveloppe de liste (§1.1).
 *
 * `consentWindowHours` est la fenêtre **configurée** (`InstitutionConfig`), pas
 * une constante : c'est elle qu'on affiche quand on doit nommer la durée, jamais
 * « 72 h » écrit en dur (principe 8 — les règles vivent en base).
 *
 * @param {unknown} payload
 */
export function normalizeRequestList(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const rawItems = Array.isArray(body.items) ? body.items : [];

  return {
    items: rawItems.map(normalizeRequest),
    totalRows: num(body.total_rows),
    consentWindowHours: num(body.consent_window_hours),
  };
}

/**
 * Une demande appelle-t-elle une réponse du garant ?
 *
 * Deux sources serveur, toutes deux serveur : le statut, et `isExpired`. Le
 * contrat dit qu'une demande périmée bascule en `expired` à la lecture, donc les
 * deux devraient concorder ; s'ils divergeaient, on retient le plus prudent.
 * Aucune comparaison de date n'intervient ici — l'horloge du navigateur ne
 * décide pas de la validité d'un engagement financier.
 */
export function isActionable(request) {
  if (!request || request.isExpired) return false;
  return statusMeta(request.status).actionable === true;
}
