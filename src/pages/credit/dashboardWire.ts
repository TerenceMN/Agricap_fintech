/**
 * Formes servies par `GET /api/credits/dashboard/` que `src/types/api.ts` ne
 * couvre pas, et **métadonnées d'honnêteté** de chaque KPI (§7.2).
 *
 * `types/api.ts` ne type que trois des six vues de `backend/credits/dashboard.py`
 * (`client`, `agent`, `credit_committee`) et referme l'union sur
 * `Record<string, unknown>` : les vues `admin`, `branch_manager` et
 * `regional_director` n'ont aucun type. Elles sont décrites ici, à l'identique
 * du serveur — aucune clé inventée, chaque champ est tracé à sa ligne d'origine.
 *
 * Référence unique : `backend/credits/dashboard.py`.
 *
 * ── Pourquoi des métadonnées et pas seulement des types ──────────────────────
 * Le §7.2 exige que chaque carte porte sa période, son périmètre et sa devise.
 * Ces trois informations ne sont PAS servies par l'API : elles sont une propriété
 * du calcul serveur (quel queryset, quelle fenêtre temporelle, quelle conversion).
 * Les écrire ici, à côté du type, les rend révisables en même temps que le
 * contrat — plutôt que dispersées dans du JSX où elles se périment en silence.
 */

// ── Vues non typées dans `types/api.ts` ───────────────────────────────────────

/** `_admin_dashboard` — vue institution. */
export interface DashboardAdmin {
  role: 'admin';
  counts: {
    draft: number;
    submitted: number;
    in_analysis: number;
    approved: number;
    pending_disbursement: number;
    active: number;
    rejected: number;
    adjourned: number;
    closed: number;
    total: number;
  };
  financials: {
    /** ⚠ `Sum("disbursed_amount")` SANS conversion — voir `AGREGAT_NON_CONVERTI`. */
    totalEncoursUsd: number;
    /** ⚠ Rejetés ÷ (actifs + clôturés + rejetés) × 100. La base n'est pas servie. */
    defaultRatePct: number;
  };
  alerts: {
    pendingMoralGuarantees: number;
    expiredConsents: number;
    scoringCriteriaActive: number;
  };
}

/** `_branch_dashboard` — vue agence (`gest_zone`). */
export interface DashboardBranch {
  role: 'branch_manager';
  summary: {
    totalApplications: number;
    pendingApproval: number;
    approved: number;
    activeCredits: number;
    rejectedApplications: number;
    closedCredits: number;
    defaultRatePct: number;
  };
  monthlyDisbursements: { count: number; volumeUsd: number };
}

/** `_regional_dashboard` — vue direction (`dg`, `dir_ops`). */
export interface DashboardRegional {
  role: 'regional_director';
  summary: {
    totalApplications: number;
    activeCredits: number;
    pendingApplications: number;
    totalEncoursUsd: number;
    defaultRatePct: number;
  };
  /** Tronquée à 10 filières par le serveur (`[:10]`), triée par encours. */
  activeByValueChain: Array<{
    value_chain__code: string | null;
    value_chain__label: string | null;
    count: number;
    encours: number;
  }>;
}

/** `_regional_dashboard` coupe la répartition par filière à `[:10]`. */
export const VALUE_CHAIN_ROWS_CAP = 10;

/** Toute réponse du tableau de bord, avant discrimination sur `role`.
 *  `role` est toujours servi par le backend (les six branches le posent). */
export type DashboardAny = { role?: string } & Record<string, unknown>;

// ── Métadonnées d'honnêteté (§7.2) ────────────────────────────────────────────

/**
 * Périmètre réellement calculé par le serveur, vue par vue.
 *
 * Écart de spécification assumé et affiché : `_agent_dashboard(sub)` et
 * `_branch_dashboard(sub)` reçoivent le `sub` de l'utilisateur mais ne s'en
 * servent jamais — leur queryset est `CreditApplication.objects.all()`. Le §7.1
 * demande « un agent SES dossiers » ; le serveur sert l'institution entière.
 * L'écran ne peut pas restreindre lui-même (ce serait un filtre métier côté
 * client, et un filtre sur une liste déjà tronquée) : il dit la vérité.
 */
export const PERIMETRE_REEL: Record<string, string> = {
  client: 'Vos dossiers uniquement (filtre serveur sur votre identifiant).',
  agent:
    'Institution entière — le serveur ne restreint PAS cette vue à vos dossiers '
    + '(`_agent_dashboard` ignore le `sub` reçu).',
  branch_manager:
    'Institution entière — le serveur ne restreint PAS cette vue à votre agence '
    + '(`_branch_dashboard` ignore le `sub` reçu).',
  regional_director: 'Institution entière, toutes agences.',
  credit_committee:
    'Dossiers en analyse dont le montant converti en USD dépasse le plafond de délégation.',
  admin: 'Institution entière, toutes agences, tous statuts.',
};

/** Fenêtre temporelle réellement appliquée par le serveur, par KPI. */
export const PERIODE = {
  /** Aucun filtre de date : photographie du stock à l'instant de la requête. */
  STOCK: "Stock à l'instant de la requête — aucun filtre de date.",
  /** `now.replace(day=1, hour=0…)` → début du mois calendaire, heure serveur. */
  MOIS_COURANT: 'Mois calendaire en cours (depuis le 1er, heure serveur).',
  /** `updated_at < now - 7 jours`. */
  STALE_7J: "Dossiers sans mise à jour depuis plus de 7 jours (à l'instant de la requête).",
  /** `client_consent_expires` dans les 24 h. */
  H24: 'Fenêtre glissante des 24 prochaines heures.',
  /** Cumul historique sans borne. */
  DEPUIS_ORIGINE: "Cumul depuis l'origine — aucune borne temporelle.",
} as const;

/**
 * Avertissement des agrégats monétaires non convertis.
 *
 * Le suffixe `Usd` des clés `totalEncoursUsd` / `volumeUsd` / `encours` est un
 * nom, pas une conversion : le serveur fait `Sum("disbursed_amount")` sur un
 * queryset multi-devises (`CreditApplication.currency` vaut USD **ou** CDF).
 * Additionner des CDF à des USD produit un nombre qui n'est l'un ni l'autre.
 * Seul `_committee_dashboard` convertit réellement (`_amount_usd`).
 *
 * Le front ne maquille pas et ne convertit pas non plus (ce serait un chiffre
 * métier calculé côté client) : il affiche le total tel quel et le disqualifie.
 */
export const AGREGAT_NON_CONVERTI =
  'Somme brute multi-devises : le serveur additionne des montants USD et CDF sans '
  + "conversion journalisée, malgré le suffixe « Usd ». Chiffre inutilisable tel quel.";

/**
 * Avertissement du « taux de défaut ».
 *
 * `_compute_default_rate` calcule `rejetés ÷ (actifs + clôturés + rejetés)`.
 * Un dossier **rejeté à l'instruction** n'est pas un prêt en défaut : ce ratio
 * mesure la sélectivité de l'instruction, pas la sinistralité du portefeuille.
 * Et sa base (le dénominateur) n'est servie par aucune clé de la réponse.
 */
export const TAUX_DEFAUT_NOTE =
  'Défini côté serveur comme « dossiers rejetés ÷ dossiers résolus » : c\'est un taux '
  + "de rejet à l'instruction, pas une sinistralité de portefeuille. Base (dénominateur) "
  + 'non servie par l\'API.';

/** Devise d'un KPI de comptage : aucune. Le dire évite la carte muette. */
export const SANS_DEVISE = 'Effectif (nombre de dossiers) — sans devise.';
