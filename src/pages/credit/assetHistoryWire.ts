/**
 * Lecture de `GET /api/assets/history` — historique de vérification des actifs.
 *
 * La file (`/assets/pending`) ne sert que les `declare` : une fois l'acte posé,
 * l'actif en disparaissait sans laisser de trace consultable. L'agent ne pouvait
 * ni revoir une valeur qu'il avait retenue, ni relire le motif d'un rejet qu'on
 * lui opposait, ni constater qu'un actif qu'il avait vérifié était depuis gagé.
 *
 * Ce module ne fait que **lire** ce que le serveur sert : aucun statut n'y est
 * décidé, aucune valeur retenue n'y est calculée. Les seules choses produites
 * ici sont des comptages d'affichage et la mise en évidence d'incohérences —
 * formulées en faits, jamais en jugements (CLAUDE.md §4.5).
 */
import type { AssetRow } from '@/types/api';

/**
 * Statuts servis par l'historique : miroir strict de `Asset.Status` moins
 * `declare`, qui est la file d'attente et vit dans l'autre vue. L'ordre est
 * celui du cycle de vie (vérifié → gagé → libéré, puis rejeté), pas un tri par
 * effectif : l'agent lit toujours la même grille.
 *
 * Le serveur refuse tout autre statut en 400 `STATUT_INCONNU` — cette liste ne
 * doit donc jamais diverger de la sienne.
 */
export const STATUTS_HISTORIQUE = ['verifie', 'gage', 'libere', 'rejete'] as const;

export type StatutHistorique = (typeof STATUTS_HISTORIQUE)[number];

/** Un statut que le serveur acceptera comme filtre. */
export function estStatutHistorique(code: string): code is StatutHistorique {
  return (STATUTS_HISTORIQUE as readonly string[]).includes(code);
}

/**
 * Effectifs par statut sur le lot affiché.
 *
 * **Base explicite** : ces comptages portent sur les lignes servies, pas sur le
 * registre entier (CLAUDE.md §4.6 — pas de pourcentage sans base). L'écran
 * affiche `total_rows` à côté pour que la distinction reste lisible.
 */
export function effectifsParStatut(items: AssetRow[]): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const s of STATUTS_HISTORIQUE) compte[s] = 0;
  for (const a of items || []) {
    const code = a?.status || 'inconnu';
    compte[code] = (compte[code] ?? 0) + 1;
  }
  return compte;
}

/**
 * Écart entre la valeur DÉCLARÉE par le client et la valeur RETENUE par le
 * serveur.
 *
 * Ce n'est PAS la décote. `assets/views.py::_row` ne sert pas la valeur
 * constatée par l'agent (`valeur_verifiee` n'est ni stockée ni renvoyée) : cet
 * écart mélange donc deux choses non séparables ici — ce que l'agent a corrigé
 * à la déclaration du client, et l'abattement institutionnel appliqué ensuite.
 * L'étiquetter « décote » à l'écran ferait croire à un taux qu'aucun endpoint
 * n'expose. On soustrait deux montants servis par le serveur, rien de plus, et
 * `null` dès que l'un des deux manque.
 */
export function ecartDeclareRetenu(asset: AssetRow): number | null {
  const declaree = Number(asset?.value);
  const retenue = asset?.valeurRetenue;
  if (retenue === null || retenue === undefined) return null;
  if (!Number.isFinite(declaree) || !Number.isFinite(Number(retenue))) return null;
  return declaree - Number(retenue);
}

/** Une anomalie constatée sur une ligne d'historique : un fait, et la question
 *  qu'il ouvre. Jamais une accusation (CLAUDE.md §4.5). */
export interface AnomalieActif {
  code: string;
  fait: string;
  question: string;
}

/**
 * Incohérences lisibles sur une ligne d'historique.
 *
 * Chacune se déduit du seul payload servi : on ne va rien rechercher ailleurs,
 * et on n'infère aucun droit. Un signal isolé n'est pas une conclusion — c'est
 * ce que l'agent doit vérifier avant de s'appuyer sur la ligne.
 */
export function anomalies(asset: AssetRow): AnomalieActif[] {
  const out: AnomalieActif[] = [];
  if (!asset) return out;

  const engage = asset.status === 'verifie' || asset.status === 'gage' || asset.status === 'libere';
  if (engage && (asset.valeurRetenue === null || asset.valeurRetenue === undefined)) {
    out.push({
      code: 'RETENUE_ABSENTE',
      fait: 'Actif au statut « ' + asset.status + " » sans valeur retenue : rien ne chiffre "
        + 'la garantie qu\'il est censé porter.',
      question: 'La vérification a-t-elle bien enregistré une valeur constatée ?',
    });
  }

  if (asset.status === 'rejete' && !(asset.motifRejet || '').trim()) {
    out.push({
      code: 'MOTIF_ABSENT',
      fait: 'Rejet sans motif enregistré, alors que le motif est obligatoire et communiqué '
        + 'au client.',
      question: 'Sur quel constat ce rejet a-t-il été prononcé ?',
    });
  }

  if (asset.status === 'gage' && !asset.gageApplication) {
    out.push({
      code: 'GAGE_SANS_DOSSIER',
      fait: 'Actif gagé sans dossier de crédit rattaché : le gage ne désigne aucune créance.',
      question: 'Quel dossier ce gage garantit-il ?',
    });
  }

  if (asset.status !== 'rejete' && !asset.verifieLe) {
    out.push({
      code: 'HORODATAGE_ABSENT',
      fait: "Aucune date de vérification : l'acte n'est pas situé dans le temps, donc pas "
        + 'reconstituable par un auditeur.',
      question: 'Cet actif a-t-il été instruit avant la mise en place de l’horodatage ?',
    });
  }

  return out;
}

/**
 * Ce que la ligne raconte, en une phrase, du point de vue de l'agent.
 * Purement descriptif — reformulation du statut servi, pas une interprétation.
 */
export function recitActe(asset: AssetRow): string {
  switch (asset?.status) {
    case 'verifie':
      return 'Vérifié sur place : la valeur retenue ci-dessous est celle qui couvrira un crédit.';
    case 'gage':
      return asset.gageApplication
        ? `Nanti sur le dossier ${asset.gageApplication} : il ne peut plus garantir autre chose.`
        : 'Nanti sur un dossier de crédit : il ne peut plus garantir autre chose.';
    case 'libere':
      return 'Gage levé : l’actif redevient mobilisable pour un nouveau crédit, sur la même '
        + 'valeur retenue.';
    case 'rejete':
      return 'Rejeté à la vérification : aucune valeur retenue, aucune garantie possible en '
        + "l'état.";
    default:
      return 'Statut hors du cycle de vie connu — affiché tel quel, sans interprétation.';
  }
}
