/**
 * Corbeille du comité de crédit — `/credit/comite`.
 *
 * Deux moitiés, et la seconde ne s'ouvre que sur un dossier choisi :
 *
 *   1. **la corbeille** — `GET /api/credits/dashboard/?view=committee`
 *      (`credits/dashboard.py::_committee_dashboard`) : les dossiers `in_analysis`
 *      dont le montant dépasse le plafond de délégation du niveau agence, avec
 *      pour chacun le montant demandé, la recommandation du moteur (score +
 *      lettre, lus de l'analyse du dossier) et son ancienneté ;
 *   2. **la délibération** — `CommitteeVotePanel` : procès-verbal des votes,
 *      quorum atteint / requis, et l'acte de vote lui-même.
 *
 * Ce que cet écran ne fait pas :
 *   - il ne calcule aucun chiffre métier. Volumes, plafond, quorum, décompte,
 *     score et lettre viennent du serveur ; l'ancienneté et l'ordre d'affichage
 *     sont les seules dérivations, et elles sont présentées comme telles ;
 *   - il n'infère aucun droit. La lentille comité est refusée en 403 par le
 *     serveur (`COMMITTEE_ROLES`), le vote l'est indépendamment, et maker ≠
 *     checker n'est jamais pré-jugé ici — on tente, et le refus s'affiche tel quel ;
 *   - il ne décide rien de lui-même : le moteur recommande, l'humain décide
 *     (principe 2), et la décision naît du quorum, pas d'un bouton.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext.jsx';
import {
  Empty, ErrorPanel, Forbidden, KpiCard, Loading, TruncationNotice,
  toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { recommandationConfig } from '@/components/analyse/recommandation';
import {
  PENDING_LIST_CAP, ageInDays, fmtAmount, fmtDate, statusOf,
} from './wire';
import CommitteeVotePanel from './CommitteeVotePanel';
import {
  ANALYSE_ABSENTE, lettreClass, toMoteur,
  type CommitteeRow, type CreditDashboardCommittee, type MoteurEntry,
} from './committeeWire';

/** Nombre d'analyses chargées de front — la corbeille sert au plus 20 lignes. */
const MOTEUR_CONCURRENCY = 3;

type SortKey = 'amount' | 'age';

/** Cellule « recommandation du moteur » d'une ligne de corbeille. */
const MoteurCell: React.FC<{ entry: MoteurEntry | undefined }> = ({ entry }) => {
  if (!entry || entry.state === 'loading') {
    return <span className="text-xs text-slate-500">chargement…</span>;
  }
  if (entry.state === 'absent') {
    return (
      <span className="text-xs text-amber-200" title={entry.message}>
        aucune analyse
      </span>
    );
  }
  if (entry.state === 'error') {
    return (
      <span className="text-xs text-slate-500" title={entry.message}>
        non chargée
      </span>
    );
  }
  const reco = recommandationConfig(entry.data.recommandation);
  return (
    <div className="flex items-center justify-center gap-2 flex-wrap">
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${lettreClass(entry.data.scoreLettre)}`}>
        {entry.data.scoreLettre}
      </span>
      <span className="text-xs text-slate-300">{entry.data.scoreGlobal}/100</span>
      <span className="flex items-center gap-1" title={reco.label}>
        <span className={`w-2 h-2 rounded-full ${reco.dot}`} aria-hidden />
        <span className="sr-only">{reco.label}</span>
      </span>
    </div>
  );
};

const Committee: React.FC = () => {
  // `AuthContext` est en JS non typé : la forme lue ici se limite au `sub`, qui
  // sert uniquement à marquer « vous » au procès-verbal.
  const auth = useAuth() as unknown as { user?: { sub?: string } | null } | null;
  const mySub = auth?.user?.sub ?? null;

  const [data, setData] = useState<CreditDashboardCommittee | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);

  const [moteurs, setMoteurs] = useState<Record<string, MoteurEntry>>({});
  const runId = useRef(0);

  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [selected, setSelected] = useState<string | null>(null);

  /**
   * Recommandation du moteur, dossier par dossier.
   *
   * La corbeille ne porte ni score ni lettre : ils vivent dans l'analyse du
   * dossier (`GET analyse/`), qui est la seule source autorisée — la lettre est
   * figée par analyse et ne se dérive jamais d'un score côté navigateur.
   * L'absence d'analyse (404 `ANALYSE_ABSENTE`) n'est pas une panne : c'est un
   * fait à montrer au comité, qui délibérerait alors sans recommandation.
   */
  const loadMoteurs = useCallback(async (codes: string[]) => {
    const ticket = ++runId.current;
    if (codes.length === 0) { setMoteurs({}); return; }
    setMoteurs(Object.fromEntries(codes.map((c) => [c, { state: 'loading' } as MoteurEntry])));

    const queue = [...codes];
    const worker = async () => {
      for (let code = queue.shift(); code !== undefined; code = queue.shift()) {
        let entry: MoteurEntry;
        try {
          entry = { state: 'ok', data: toMoteur(await api.credits.analyse(code)) };
        } catch (e) {
          if (e instanceof ApiError && e.code === ANALYSE_ABSENTE) {
            entry = { state: 'absent', message: e.message };
          } else {
            entry = { state: 'error', message: e instanceof Error ? e.message : String(e) };
          }
        }
        if (ticket !== runId.current) return; // corbeille rechargée entre-temps
        const done = entry;
        const key = code;
        setMoteurs((prev) => ({ ...prev, [key]: done }));
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MOTEUR_CONCURRENCY, queue.length) }, worker),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    try {
      const res = await api.credits.dashboard('committee');
      const dash = res as unknown as CreditDashboardCommittee;
      setData(dash);
      void loadMoteurs((dash.pendingApplications ?? []).map((r) => r.code));
    } catch (e) {
      setData(null);
      runId.current += 1;
      setMoteurs({});
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(e.message);
      } else {
        setErrors(toFieldErrors(e));
      }
    } finally {
      setLoading(false);
    }
  }, [loadMoteurs]);

  useEffect(() => { void load(); }, [load]);

  const summary = data?.summary;
  const rows: CommitteeRow[] = useMemo(() => data?.pendingApplications ?? [], [data]);

  /** Ré-ordonnancement d'affichage des lignes DÉJÀ servies — jamais un tri global. */
  const ordered = useMemo(() => {
    const copy = [...rows];
    if (sortKey === 'age') {
      copy.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else {
      copy.sort((a, b) => (b.amount_requested ?? 0) - (a.amount_requested ?? 0));
    }
    return copy;
  }, [rows, sortKey]);

  const selectedRow = selected ? rows.find((r) => r.code === selected) ?? null : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 text-white">
      <Helmet><title>Comité de crédit — AGRICAP FINTECH</title></Helmet>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Comité de crédit</h1>
          <p className="text-sm text-slate-400 mt-1">
            Dossiers en analyse au-dessus du plafond de délégation du niveau agence.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/credit/dossiers" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            File d'instruction
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
          >
            Rafraîchir
          </button>
        </div>
      </div>

      {/* ── Bandeau de doctrine — il n'est pas décoratif ────────────────────── */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
        <p className="text-sm font-semibold text-emerald-200">
          Le moteur recommande, l'humain décide.
        </p>
        <p className="text-xs text-slate-300 mt-1 leading-relaxed">
          Le score, la lettre et la recommandation affichés ici sont une aide à la
          délibération : aucune approbation n'est automatique. Chaque vote est un acte
          nominatif, motivé, définitif — il s'inscrit au procès-verbal et ne peut être ni
          modifié ni retiré. La décision du comité n'est prise que lorsqu'un sens réunit le
          quorum, et elle passe alors par la machine à états du dossier.
        </p>
      </div>

      {loading && <Loading label="Chargement de la corbeille du comité…" />}

      {!loading && forbidden && (
        <Forbidden
          message="Corbeille du comité réservée à la direction."
          detail={forbidden}
        />
      )}

      {!loading && !forbidden && <ErrorPanel errors={errors} title="Chargement impossible" />}

      {!loading && !forbidden && summary && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard
              label="Dossiers en attente d'accord comité"
              value={String(summary.pendingReview)}
              scope="Statut « en analyse », montant ≥ plafond agence, toutes agences"
              period="Instantané — à la date de consultation"
            />
            <KpiCard
              label="Volume demandé cumulé"
              value={fmtAmount(summary.totalVolumeUsd, 'USD')}
              scope={`Somme des montants demandés des ${summary.pendingReview} dossier(s) ci-dessus`}
              period="Instantané — à la date de consultation"
              note="Le serveur additionne les montants sans conversion de devise : à lire comme un ordre de grandeur tant que la conversion CDF/USD n'est pas journalisée."
            />
            <KpiCard
              label="Plafond de délégation agence"
              value={fmtAmount(summary.delegationThresholdUsd, 'USD')}
              scope="Paramètre serveur CREDIT_DELEGATION_USD (rôle gest_zone)"
              period="Valeur en vigueur"
            />
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-semibold text-sm text-slate-300 uppercase tracking-wide">
                Dossiers soumis au comité
              </h2>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-xs text-slate-400 flex items-center gap-2">
                  Ordre d'affichage
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    className="bg-white/10 border border-white/20 rounded px-2 py-1 text-xs text-white"
                  >
                    <option value="amount">Montant décroissant</option>
                    <option value="age">Ancienneté (plus ancien d'abord)</option>
                  </select>
                </label>
                <span className="text-xs text-slate-500">
                  {rows.length} affiché(s) — total_rows = {summary.pendingReview}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="text-left p-4">Code</th>
                    <th className="text-left p-4">Filière</th>
                    <th className="text-right p-4">Montant demandé</th>
                    <th className="text-center p-4">Moteur (lettre / score)</th>
                    <th className="text-left p-4">Ancienneté</th>
                    <th className="text-center p-4">Statut</th>
                    <th className="p-4" />
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((r) => {
                    const st = statusOf(r.status);
                    const jours = ageInDays(r.created_at);
                    const isSelected = r.code === selected;
                    return (
                      <tr
                        key={r.code}
                        className={`border-t border-white/5 ${
                          isSelected ? 'bg-emerald-500/10' : 'hover:bg-white/5'
                        }`}
                      >
                        <td className="p-4 font-mono text-xs text-emerald-300">{r.code}</td>
                        <td className="p-4 text-slate-300">{r.value_chain__label ?? '—'}</td>
                        <td className="p-4 text-right font-semibold whitespace-nowrap">
                          {fmtAmount(r.amount_requested, r.currency)}
                        </td>
                        <td className="p-4 text-center">
                          <MoteurCell entry={moteurs[r.code]} />
                        </td>
                        <td className="p-4 text-slate-400 whitespace-nowrap">
                          {jours === null ? '—' : `${jours} j`}
                          <span className="block text-[11px] text-slate-500">
                            créé le {fmtDate(r.created_at)}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.color}`}>{st.label}</span>
                        </td>
                        <td className="p-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelected(isSelected ? null : r.code)}
                            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs"
                          >
                            {isSelected ? 'Fermer' : 'Délibérer'}
                          </button>
                          <Link
                            to={`/credit/dossiers/${r.code}`}
                            className="text-primary text-xs underline ml-3"
                          >
                            Dossier
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {rows.length === 0 && (
              <Empty
                title="Aucun dossier n'attend l'accord du comité."
                hint="Les dossiers dépassant le plafond de délégation agence apparaîtront ici."
              />
            )}

            <TruncationNotice
              shown={rows.length}
              total={summary.pendingReview}
              cap={PENDING_LIST_CAP}
            />

            {rows.length > 0 && sortKey === 'age' && rows.length < summary.pendingReview && (
              <p className="text-xs text-amber-300/90 px-4 pb-3">
                Le serveur trie par montant décroissant avant de tronquer : ce ré-ordonnancement
                par ancienneté ne porte que sur les {rows.length} lignes servies, et le dossier le
                plus ancien de la corbeille peut ne pas en faire partie.
              </p>
            )}
          </div>

          {/* ── Délibération du dossier choisi ──────────────────────────────── */}
          {selected && (
            <div className="space-y-2">
              {selectedRow && (
                <p className="text-xs text-slate-400">
                  Dossier sélectionné : <span className="font-mono text-slate-300">{selectedRow.code}</span>
                  {' — '}{selectedRow.value_chain__label ?? 'filière non renseignée'}
                  {', '}{fmtAmount(selectedRow.amount_requested, selectedRow.currency)}
                  {', déposé le '}{fmtDate(selectedRow.created_at)}.
                </p>
              )}
              <CommitteeVotePanel
                code={selected}
                mySub={mySub}
                moteur={moteurs[selected]}
                onResolved={() => { void load(); }}
                onClose={() => setSelected(null)}
              />
            </div>
          )}

          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-slate-400 space-y-2">
            <p className="text-slate-300 font-semibold text-sm">Lecture de cet écran</p>
            <p>
              La corbeille et la délibération sont servies par deux endpoints distincts : la
              liste vient du tableau de bord comité, le procès-verbal et le quorum du dossier
              lui-même. Le quorum est un paramètre d'institution (`quorum_comite`) — il n'est
              jamais codé côté navigateur, et chaque vote enregistre le quorum en vigueur au
              moment où il est exprimé.
            </p>
            <p>
              Le vote est réservé aux membres du comité et refusé à celui qui a soumis ou initié
              le dossier (maker ≠ checker). Cette règle n'est pas anticipée ici : le bouton reste
              proposé, le serveur tranche, et son refus s'affiche mot pour mot.
            </p>
            <p>
              Le seuil de mise au comité est comparé au montant demandé <em>sans conversion de
              devise</em> pour construire cette liste, alors que le contrôle au moment du vote,
              lui, convertit en USD : un dossier libellé en CDF peut donc apparaître ici et se
              voir refuser le vote (`COMMITTEE_NOT_REQUIRED`). Divergence backend signalée, non
              contournée ici.
            </p>
          </div>
        </>
      )}

      {!loading && !forbidden && !summary && errors.length === 0 && (
        <div className="bg-white/5 border border-white/10 rounded-xl">
          <Empty
            title="Le serveur n'a pas renvoyé de corbeille comité."
            hint="Réponse inattendue de /api/credits/dashboard/?view=committee."
          />
        </div>
      )}
    </div>
  );
};

export default Committee;
