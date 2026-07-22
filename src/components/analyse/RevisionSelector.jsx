import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Fingerprint, History, RefreshCw,
} from 'lucide-react';
import { api } from '@/services/api';
import { ErrorPanel, Forbidden, TruncationNotice, toFieldErrors } from '@/components/backoffice/States';
import { formatDateTimeFr, NULL_DISPLAY } from './analyseFormat';
import { useNeedsRevisions } from './useNeedsRevisions';

/**

 * @param {{
 *   code: string,
 *   lignage?: {needsSourceId?: number|null, revision?: number|null, sha256?: string|null,
 *              datasetKey?: string|null}|null,
 * }} props
 */
const RevisionSelector = ({ code, lignage }) => {
  // `lignage.datasetKey` est prioritaire quand le serveur le sert : le front
  // cesse alors de reconstruire `fb__<code>` de son côté (cf. `useNeedsRevisions`).
  const { revisions, loading, error, loaded, forbidden, reload } = useNeedsRevisions(
    code, true, lignage?.datasetKey,
  );
  const [selectionId, setSelectionId] = useState(null);
  const [contenuOuvert, setContenuOuvert] = useState(false);

  const idAnalysee = lignage?.needsSourceId ?? null;
  const shaAnalysee = lignage?.sha256 ? String(lignage.sha256) : '';


  useEffect(() => {
    if (!loaded || revisions.length === 0) return;
    setSelectionId((actuel) => {
      if (actuel !== null && revisions.some((r) => r.id === actuel)) return actuel;
      const analysee = revisions.find((r) => r.id === idAnalysee);
      const courante = revisions.find((r) => r.estCourante);
      return (analysee || courante || revisions[0]).id;
    });
  }, [loaded, revisions, idAnalysee]);

  useEffect(() => { setContenuOuvert(false); }, [selectionId]);

  const selection = useMemo(
    () => revisions.find((r) => r.id === selectionId) || null,
    [revisions, selectionId],
  );
  const analysee = useMemo(
    () => revisions.find((r) => r.id === idAnalysee) || null,
    [revisions, idAnalysee],
  );
  const courante = useMemo(() => revisions.find((r) => r.estCourante) || null, [revisions]);

  const nbIngerees = revisions.filter((r) => r.ingeree).length;
  const nbRefusees = revisions.length - nbIngerees;

  if (forbidden) {
    return (
      <Forbidden
        message="Historique des révisions réservé au personnel habilité."
        detail="Le serveur réserve l'historique des dépôts (`/dataio/history`) aux rôles staff."
      />
    );
  }

  return (
    <section className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-700 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-white text-sm flex items-center gap-2">
            <History className="w-4 h-4 text-sky-400" aria-hidden="true" />
            Révisions de la feuille de besoins
          </h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {loaded && revisions.length > 0
              ? `${revisions.length} dépôt(s) — ${nbIngerees} ingéré(s), ${nbRefusees} refusé(s) `
                + 'à la validation. Chronologie du plus récent au plus ancien.'
              : "Trajectoire des dépôts du client et empreinte de chaque version du fichier."}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-slate-300 hover:bg-slate-700"
          onClick={reload}
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Actualiser
        </Button>
      </header>

      {loading && revisions.length === 0 && (
        <p className="px-4 py-5 text-sm text-slate-400">Chargement de l'historique des dépôts…</p>
      )}

      {error && !forbidden && (
        <div className="p-4">
          <ErrorPanel errors={toFieldErrors(error)} title="Historique des révisions indisponible" />
          <p className="text-[11px] text-slate-500 mt-2">
            L'analyse ci-dessous reste valable : elle porte sa propre référence de révision.
            Seule la comparaison entre révisions est momentanément impossible.
          </p>
        </div>
      )}

      {loaded && !error && revisions.length === 0 && (
        <p className="px-4 py-5 text-sm text-slate-400">
          Aucun dépôt de feuille de besoins enregistré pour ce dossier. L'analyse a donc été
          exécutée sans lignée de fichier — vérifiez d'où viennent ses montants avant de
          conclure.
        </p>
      )}

      {revisions.length > 0 && (
        <>
          <AlerteDecalage analysee={analysee} courante={courante} lignage={lignage} />

          {/* ── Sélecteur ── */}
          <div className="px-4 py-3 border-b border-slate-700">
            <label
              htmlFor="revision-feuille-besoins"
              className="text-[11px] uppercase tracking-wide text-slate-500 block mb-1"
            >
              Révision examinée
            </label>
            <select
              id="revision-feuille-besoins"
              className="w-full bg-slate-900/70 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 [&>option]:bg-slate-800 [&>option]:text-white"
              value={selectionId ?? ''}
              onChange={(e) => setSelectionId(Number(e.target.value))}
            >
              {revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  {libelleRevision(r)} — {formatDateTimeFr(r.deposeeLe)}
                  {r.id === idAnalysee ? ' — analysée' : ''}
                  {r.estCourante ? ' — courante' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* ── Comparaison des empreintes ── */}
          {selection && (
            <ComparaisonEmpreintes
              selection={selection}
              analysee={analysee}
              idAnalysee={idAnalysee}
              shaAnalysee={shaAnalysee}
            />
          )}

          {/* ── Contenu ingéré de la révision sélectionnée ── */}
          {selection && (
            <ContenuRevision
              revision={selection}
              ouvert={contenuOuvert}
              onToggle={() => setContenuOuvert((v) => !v)}
            />
          )}

          {/* ── Trajectoire ── */}
          <ul className="divide-y divide-slate-800">
            {revisions.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectionId(r.id)}
                  aria-pressed={r.id === selectionId}
                  className={`w-full text-left px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 transition-colors ${
                    r.id === selectionId ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <span className="text-sm text-slate-100 font-medium">{libelleRevision(r)}</span>
                  <span className="text-[11px] text-slate-500">{formatDateTimeFr(r.deposeeLe)}</span>
                  {r.id === idAnalysee && (
                    <Badge tone="bg-sky-500/15 text-sky-300 border-sky-500/30">Analysée</Badge>
                  )}
                  {r.estCourante && (
                    <Badge tone="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Courante</Badge>
                  )}
                  {!r.ingeree && (
                    <Badge tone="bg-red-500/15 text-red-300 border-red-500/30">Refusée à la validation</Badge>
                  )}
                  {r.memeEmpreinteQuePrecedente === true && (
                    <Badge tone="bg-amber-500/15 text-amber-300 border-amber-500/30">
                      Fichier identique au dépôt précédent
                    </Badge>
                  )}
                  <span className="ml-auto text-[11px] font-mono text-slate-500" title={r.sha256 || undefined}>
                    {empreinteCourte(r.sha256)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <p className="px-4 py-2.5 text-[11px] text-slate-500 border-t border-slate-700">
            Les dépôts refusés à la validation sont conservés : une tentative écartée fait partie
            de la trajectoire du dossier. Un enchaînement de re-dépôts dont chaque version se
            rapproche des seuils est un élément factuel à verser au dossier, pas une conclusion.
          </p>
        </>
      )}
    </section>
  );
};

const Badge = ({ tone, children }) => (
  <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${tone}`}>
    {children}
  </span>
);

/** « Révision N » pour une source ingérée, « tentative » pour un dépôt refusé. */
function libelleRevision(r) {
  if (r.ingeree && r.revision !== null && r.revision !== undefined) return `Révision ${r.revision}`;
  return 'Dépôt non ingéré';
}

function empreinteCourte(sha) {
  if (!sha) return NULL_DISPLAY;
  return `${String(sha).slice(0, 12)}…`;
}


const AlerteDecalage = ({ analysee, courante, lignage }) => {
  const idAnalysee = lignage?.needsSourceId ?? null;

  if (idAnalysee === null || idAnalysee === undefined) {
    return (
      <p className="mx-4 my-3 flex items-start gap-2 text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Cette analyse ne référence aucune révision de feuille de besoins. Impossible de la
          rattacher à un fichier précis, donc impossible de la rejouer à l'identique.
        </span>
      </p>
    );
  }

  if (analysee === null) {
    return (
      <p className="mx-4 my-3 flex items-start gap-2 text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          La révision analysée (source #{idAnalysee}) n'apparaît pas dans l'historique de ce
          dossier. À signaler : une analyse doit toujours pointer vers une source de la lignée
          du dossier.
        </span>
      </p>
    );
  }

  if (courante && analysee.id !== courante.id) {
    return (
      <p className="mx-4 my-3 flex items-start gap-2 text-xs text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          <strong>Analyse exécutée sur une révision qui n'est plus courante.</strong>{' '}
          Elle porte sur {libelleRevision(analysee).toLowerCase()} ; la feuille courante du
          dossier est {libelleRevision(courante).toLowerCase()}
          {' '}(déposée le {formatDateTimeFr(courante.deposeeLe)}). Les chiffres affichés
          ci-dessous ne décrivent donc pas le fichier le plus récent : une ré-analyse est
          nécessaire avant toute décision.
        </span>
      </p>
    );
  }

  return (
    <p className="mx-4 my-3 flex items-start gap-2 text-xs text-emerald-200/90 bg-emerald-500/[0.07] border border-emerald-500/25 rounded-lg px-3 py-2">
      <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        L'analyse affichée porte sur la révision courante de la feuille de besoins
        ({libelleRevision(analysee).toLowerCase()}).
      </span>
    </p>
  );
};


const ComparaisonEmpreintes = ({ selection, analysee, idAnalysee, shaAnalysee }) => {
  const memeSource = selection.id === idAnalysee;
  const shaRef = analysee?.sha256 || shaAnalysee || '';
  const comparable = Boolean(selection.sha256 && shaRef);
  const identiques = comparable ? selection.sha256 === shaRef : null;

  return (
    <div className="px-4 py-3 border-b border-slate-700 space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
        <Fingerprint className="w-3.5 h-3.5" aria-hidden="true" />
        Comparaison des empreintes SHA-256
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <EmpreinteCarte
          titre={`Sélection — ${libelleRevision(selection)}`}
          sousTitre={`Déposée le ${formatDateTimeFr(selection.deposeeLe)}`}
          sha={selection.sha256}
        />
        <EmpreinteCarte
          titre={analysee ? `Analysée — ${libelleRevision(analysee)}` : 'Révision analysée'}
          sousTitre={
            analysee
              ? `Ingérée le ${formatDateTimeFr(analysee.ingereeLe)}`
              : `Source #${idAnalysee ?? NULL_DISPLAY} — absente de l'historique`
          }
          sha={shaRef}
        />
      </div>

      {memeSource ? (
        <p className="text-xs text-slate-400">
          Il s'agit de la révision sur laquelle l'analyse affichée a été exécutée : son empreinte
          est, par construction, celle du lignage de l'analyse.
        </p>
      ) : !comparable ? (
        <p className="text-xs text-amber-200/90">
          Comparaison impossible : au moins une des deux empreintes est absente. Une source sans
          SHA-256 n'est pas rejouable — à signaler plutôt qu'à interpréter.
        </p>
      ) : identiques ? (
        <p className="text-xs text-amber-200/90 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <strong>Empreintes identiques.</strong> Le fichier de ces deux dépôts est le même
            bit à bit : aucun contenu n'a changé entre eux, seul l'horodatage diffère. Question à
            poser au client : que cherchait-il à corriger en re-déposant le même fichier ?
          </span>
        </p>
      ) : (
        <p className="text-xs text-slate-300 flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
          <span>
            <strong>Empreintes différentes.</strong> Le contenu du fichier a changé entre ces deux
            dépôts. Le détail de ce qui a changé n'est pas calculé ici : le comparer poste par
            poste demande un diff produit par le serveur sur les données ingérées, pas une
            soustraction faite dans le navigateur.
          </span>
        </p>
      )}
    </div>
  );
};

const EmpreinteCarte = ({ titre, sousTitre, sha }) => (
  <div className="bg-slate-900/50 rounded-lg p-3 min-w-0">
    <p className="text-xs text-slate-300 font-medium">{titre}</p>
    <p className="text-[11px] text-slate-500 mt-0.5">{sousTitre}</p>
    <p className="text-[11px] font-mono text-slate-400 mt-1.5 break-all">
      {sha || NULL_DISPLAY}
    </p>
  </div>
);

/**
 * Contenu ingéré de la révision sélectionnée (`GET /dataio/sources/<id>/tables`).
 *
 * Affichage brut des `DataRecord` tels que le serveur les sert : c'est ce qui a
 * été scoré (principe 1). Aucune somme, aucun total, aucune comparaison de
 * valeurs n'est produite ici — l'analyste lit les lignes, le moteur reste seul
 * à calculer.
 */
const ContenuRevision = ({ revision, ouvert, onToggle }) => {
  const [contenu, setContenu] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [chargement, setChargement] = useState(false);

  useEffect(() => {
    setContenu(null);
    setErreur(null);
  }, [revision.id]);

  useEffect(() => {
    if (!ouvert || contenu || chargement || !revision.ingeree) return;
    let vivant = true;
    setChargement(true);
    api.sourceTables(revision.id)
      .then((data) => { if (vivant) setContenu(data); })
      .catch((e) => { if (vivant) setErreur(e); })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, [ouvert, contenu, chargement, revision.id, revision.ingeree]);

  if (!revision.ingeree) {
    return (
      <p className="px-4 py-3 border-b border-slate-700 text-xs text-slate-400">
        Ce dépôt a été refusé à la validation : aucune ligne n'a été ingérée, donc rien n'a été
        scoré à partir de lui. Le fichier reste conservé comme trace de la tentative.
      </p>
    );
  }

  return (
    <div className="border-b border-slate-700">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={ouvert}
        className="w-full px-4 py-2.5 flex items-center gap-2 text-xs text-slate-300 hover:bg-white/[0.03]"
      >
        {ouvert
          ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
        Contenu ingéré de cette révision ({revision.nTables} table(s))
      </button>

      {ouvert && (
        <div className="px-4 pb-3 space-y-3">
          {chargement && <p className="text-xs text-slate-400">Chargement des lignes ingérées…</p>}
          {erreur && <ErrorPanel errors={toFieldErrors(erreur)} title="Contenu indisponible" />}
          {contenu?.tables?.length === 0 && (
            <p className="text-xs text-slate-400">
              Aucune table ingérée pour cette révision.
            </p>
          )}
          {(contenu?.tables || []).map((t) => (
            <TableIngeree key={t.id} table={t} />
          ))}
        </div>
      )}
    </div>
  );
};

/** Plafond serveur des lignes servies par `/dataio/sources/<id>/tables`. */
const PLAFOND_LIGNES = 500;

const TableIngeree = ({ table }) => {
  const colonnes = Array.isArray(table?.columns) ? table.columns : [];
  const lignes = Array.isArray(table?.rows) ? table.rows : [];

  return (
    <div className="rounded-lg border border-slate-700 overflow-hidden">
      <p className="px-3 py-2 bg-slate-900/60 text-xs text-slate-300 font-medium">
        {table.name}
        <span className="text-slate-500 font-normal">
          {' '}— {table.n_rows} ligne(s), {table.n_cols} colonne(s)
        </span>
      </p>
      <div className="overflow-x-auto max-h-64 overflow-y-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-slate-900/90">
            <tr className="text-slate-500 uppercase tracking-wide">
              {colonnes.map((c) => (
                <th key={c.name} scope="col" className="text-left font-medium px-2 py-1.5 whitespace-nowrap">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {lignes.map((r) => (
              <tr key={r.id}>
                {colonnes.map((c) => (
                  <td key={c.name} className="px-2 py-1 text-slate-300 whitespace-nowrap">
                    {r.values?.[c.name] ?? NULL_DISPLAY}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TruncationNotice shown={lignes.length} total={table.n_rows ?? lignes.length} cap={PLAFOND_LIGNES} />
    </div>
  );
};

export default RevisionSelector;
