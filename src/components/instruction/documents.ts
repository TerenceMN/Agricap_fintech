/**
 * Documents de référence d'une analyse — rendre VISIBLE ce que le moteur choisit
 * tout seul.
 *
 * ─── DEUX RÉFÉRENCES, DEUX MÉCANIQUES, À NE PAS CONFONDRE ────────────────────
 *
 * 1. **Le référentiel filière** (`credits.ReferentielFiliere`) : c'est LUI que
 *    `executer_analyse` utilise pour comparer les postes du classeur. Il est
 *    résolu par `resoudre_referentiel(application)` sur le code de la filière du
 *    dossier, et il est **journalisé avec l'analyse** (clé étrangère
 *    `AnalyseCredit.referentiel`, servie en `referentielInfo` : code, filière,
 *    source, `estIndicatif`, `nCasReels`, version). Cette référence-là est déjà
 *    rejouable (principe 1) — elle n'est simplement pas CHOISISSABLE.
 *
 * 2. **Le classeur simulateur** (`dataio.DataSource`, `kind=SIMULATEUR`,
 *    `is_current=True`) : lu par `credits/dataio_simulator.py::_find_source`,
 *    qui l'apparie à la filière **par mots du nom de fichier** (jetons ≥ 3
 *    caractères), avec repli sur le générique. Il alimente `POST /credits/simulate/`
 *    — la simulation SANS écriture — et n'est PAS journalisé : rien, dans une
 *    analyse enregistrée, ne dit contre quel classeur elle a été faite.
 *
 * ─── CE QUE CE MODULE FAIT, ET CE QU'IL REFUSE DE FAIRE ──────────────────────
 *
 * Il présente la liste des classeurs simulateurs COURANTS (servie par
 * `GET /dataio/sources`, `IsStaff`) et marque celui que le serveur dit avoir
 * retenu. Il **ne rejoue pas** l'appariement par jetons de `_find_source` : le
 * nom retenu vient du serveur (`refData.sourceFile`), le rapprochement se fait
 * par égalité stricte de nom. Réimplémenter l'heuristique côté navigateur
 * produirait un « document retenu » qui pourrait différer du vrai — exactement
 * l'opacité que ce panneau doit lever.
 *
 * ─── ANTI-GAMING (principe 7) ────────────────────────────────────────────────
 *
 * `GET /dataio/sources` sert TOUTES les sources, y compris les feuilles de
 * besoins des dossiers d'autres clients. Le filtre `SIMULATEUR` ci-dessous n'est
 * donc pas cosmétique : il évite d'afficher, sur un écran d'instruction, les
 * pièces d'un dossier tiers.
 */
import type { CreditSimulateResult, DataSource } from '@/types/api';

/** `kind` des classeurs de simulation, nomenclature `dataio.models` (principe 6). */
export const KIND_SIMULATEUR = 'SIMULATEUR';

/** Le contrat exact qui manque pour que le choix devienne un acte, pas un affichage. */
export const MESSAGE_CHOIX_NON_TRANSMISSIBLE =
  'Le serveur n’accepte aujourd’hui aucun document de référence explicite : ni '
  + '`POST .../reanalyser/` ni `POST /credits/simulate/` ne portent de champ de source. '
  + 'Cet écran ne propose donc pas un choix qu’il ne pourrait pas transmettre — il rend '
  + 'visible et vérifiable le choix que le moteur fait seul, et c’est déjà ce qui manquait : '
  + 'aucune analyse enregistrée ne dit, aujourd’hui, contre quel classeur elle a été faite.';

export interface DocumentReference {
  id: number;
  nom: string;
  datasetKey: string;
  revision: number;
  /** Vide tant que l'inspection n'a pas eu lieu : une source sans empreinte
   *  n'est pas rejouable, à signaler plutôt qu'à interpréter. */
  sha256: string;
  committedAt: string | null;
  /** Le serveur dit avoir retenu CE document pour la simulation du dossier. */
  retenuParLeMoteur: boolean;
}

export interface ChoixDocuments {
  /** Classeurs simulateurs courants, du plus récemment enregistré au plus ancien. */
  documents: DocumentReference[];
  /** Nom du classeur retenu, tel que le serveur l'a nommé (`refData.sourceFile`). */
  nomRetenu: string | null;
  /** Libellé de la référence retenue (`refData.source`) : ce peut être un nom de
   *  fichier OU « Référentiel filière <code> » quand aucun classeur ne colle. */
  libelleRetenu: string | null;
  /** Code du `ReferentielFiliere` que le serveur a résolu pour ce dossier. */
  referentielFiliere: string | null;
  /** `false` = le classeur retenu n'est PAS celui de la filière du dossier.
   *  Substitution silencieuse de référentiel — exactement ce que le principe 10
   *  interdit de laisser passer sans le dire. `null` = le serveur ne l'a pas dit. */
  correspondFiliere: boolean | null;
  /** Le serveur a nommé un document introuvable parmi les courants : soit il a
   *  été remplacé depuis, soit la liste et le moteur ne regardent pas la même
   *  base. Dans les deux cas, l'écran le signale au lieu de ne rien marquer. */
  retenuIntrouvable: boolean;
  /** Aucun classeur simulateur courant en base : le moteur retombera sur le
   *  référentiel filière seul. */
  aucunDocument: boolean;
}

function texteOuNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Champs de `refData` réellement servis par `dataio_simulator` mais ABSENTS du
 * contrat déclaré `CreditSimulateRefData` (`source`, `sourceFile`,
 * `sourceMatchesChain`). On les lit en narrowing, sans `as` : le contrat front
 * décrit une réponse plus pauvre que celle du serveur, écart signalé au lot.
 */
function lireRefData(simulation: CreditSimulateResult | null): {
  nomRetenu: string | null;
  libelleRetenu: string | null;
  referentielFiliere: string | null;
  correspondFiliere: boolean | null;
} {
  const brut: unknown = simulation?.refData;
  const ref: Record<string, unknown> =
    typeof brut === 'object' && brut !== null ? (brut as Record<string, unknown>) : {};
  const correspond = ref.sourceMatchesChain;
  return {
    nomRetenu: texteOuNull(ref.sourceFile),
    libelleRetenu: texteOuNull(ref.source),
    referentielFiliere: texteOuNull(ref.referentielFiliere),
    correspondFiliere: typeof correspond === 'boolean' ? correspond : null,
  };
}

/**
 * Assemble la vue « documents de référence » à partir des deux réponses serveur.
 *
 * @param sources réponse brute de `GET /dataio/sources` (toutes les sources).
 * @param simulation réponse de `POST /credits/simulate/` — appel en LECTURE
 *        SEULE : il ne crée aucune analyse et ne modifie aucun dossier.
 */
export function construireChoixDocuments(
  sources: DataSource[] | null,
  simulation: CreditSimulateResult | null,
): ChoixDocuments {
  const { nomRetenu, libelleRetenu, referentielFiliere, correspondFiliere } = lireRefData(simulation);

  const courants = (sources ?? []).filter((s) => s && s.kind === KIND_SIMULATEUR && s.is_current);

  const documents: DocumentReference[] = courants.map((s) => ({
    id: s.id,
    nom: s.original_name,
    datasetKey: s.dataset_key,
    revision: s.revision,
    sha256: s.sha256 ?? '',
    committedAt: s.committed_at ?? null,
    retenuParLeMoteur: nomRetenu !== null && s.original_name === nomRetenu,
  }));

  return {
    documents,
    nomRetenu,
    libelleRetenu,
    referentielFiliere,
    correspondFiliere,
    retenuIntrouvable: nomRetenu !== null && !documents.some((d) => d.retenuParLeMoteur),
    aucunDocument: documents.length === 0,
  };
}
