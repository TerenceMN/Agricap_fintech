/**
 * Panneau de délibération d'un dossier soumis au comité de crédit.
 *
 * Trois choses, et rien d'autre :
 *   1. le **procès-verbal** — la séquence des votes exprimés, telle que le
 *      serveur la sert (`GET committee-votes/`) ;
 *   2. le **quorum** — atteint / requis, affiché explicitement pour les deux
 *      sens, parce qu'un comité qui décide sans savoir où il en est du quorum
 *      ne produit pas une décision opposable ;
 *   3. l'**acte de vote** — motif obligatoire, irréversible, append-only.
 *
 * Ce que ce panneau ne fait PAS :
 *   - il ne décide pas si l'utilisateur a le droit de voter. maker ≠ checker est
 *     une règle serveur (`committee.py::cast_vote` → 409 `MAKER_CHECKER_VIOLATION`) ;
 *     le front ne la ré-implémente pas et n'infère pas un refus à partir de
 *     `submittedBySub`. Si le serveur refuse, son motif s'affiche tel quel.
 *   - il ne calcule aucun chiffre : `tally`, `quorum` et `resolved` viennent du
 *     serveur. Le seul test fait ici est `tally.approve >= quorum` pour choisir
 *     un libellé — et `resolved` du serveur reste la source de la résolution.
 *   - il ne propose jamais de modifier ni de supprimer un vote : `CommitteeVote`
 *     est append-only (principe 3), il n'existe aucun endpoint pour cela.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/services/api';
import {
  ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { recommandationConfig } from '@/components/analyse/recommandation';
import { fmtAmount, fmtDateTime } from './wire';
import {
  decisionLabel, type CommitteeDecision, type CommitteeVotesSummary, type MoteurEntry,
} from './committeeWire';

interface Props {
  code: string;
  /** `sub` de l'utilisateur connecté — sert à marquer ses propres votes au PV. */
  mySub: string | null;
  /** Analyse moteur du dossier, chargée par l'écran parent (peut être absente). */
  moteur: MoteurEntry | undefined;
  /** Appelé quand le quorum a résolu le dossier : la corbeille doit se recharger. */
  onResolved: () => void;
  onClose: () => void;
}

/** Barre de quorum d'un sens de vote — jamais un pourcentage sans son effectif. */
const QuorumBar: React.FC<{
  label: string; count: number; quorum: number; tone: 'approve' | 'reject';
}> = ({ label, count, quorum, tone }) => {
  const reached = count >= quorum;
  const fill = tone === 'approve' ? 'bg-emerald-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-slate-400">{label}</span>
        <span className={`text-sm font-semibold ${reached ? 'text-white' : 'text-slate-300'}`}>
          {count} / {quorum}
          <span className="text-xs font-normal text-slate-500"> voix requises</span>
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-white/10 overflow-hidden" aria-hidden>
        {/* Largeur d'affichage uniquement : aucun chiffre métier n'en sort. */}
        <div
          className={`h-full ${fill}`}
          style={{ width: `${Math.min(100, quorum > 0 ? (count / quorum) * 100 : 0)}%` }}
        />
      </div>
      <p className={`text-[11px] mt-1 ${reached ? 'text-amber-200' : 'text-slate-500'}`}>
        {reached ? 'Quorum atteint pour ce sens.' : 'Quorum non atteint.'}
      </p>
    </div>
  );
};

const CommitteeVotePanel: React.FC<Props> = ({ code, mySub, moteur, onResolved, onClose }) => {
  const [pv, setPv] = useState<CommitteeVotesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [loadErrors, setLoadErrors] = useState<FieldError[]>([]);

  // Formulaire de vote
  const [decision, setDecision] = useState<CommitteeDecision | ''>('');
  const [comment, setComment] = useState('');
  const [conditions, setConditions] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voteErrors, setVoteErrors] = useState<FieldError[]>([]);
  const [voteForbidden, setVoteForbidden] = useState<string | null>(null);
  const [voteDone, setVoteDone] = useState<string | null>(null);

  const loadPv = useCallback(async () => {
    setLoading(true);
    setForbidden(null);
    setLoadErrors([]);
    try {
      const res = await api.credits.committeeVotes(code);
      setPv(res as unknown as CommitteeVotesSummary);
    } catch (e) {
      setPv(null);
      if (e instanceof ApiError && e.status === 403) setForbidden(e.message);
      else setLoadErrors(toFieldErrors(e));
    } finally {
      setLoading(false);
    }
  }, [code]);

  // Changer de dossier remet le formulaire à zéro : un motif rédigé pour un
  // dossier ne doit jamais être soumis sur un autre.
  useEffect(() => {
    setDecision('');
    setComment('');
    setConditions('');
    setConfirming(false);
    setVoteErrors([]);
    setVoteForbidden(null);
    setVoteDone(null);
    void loadPv();
  }, [code, loadPv]);

  const motifManquant = comment.trim().length === 0;

  const submitVote = async () => {
    if (!decision || motifManquant) return;
    setBusy(true);
    setVoteErrors([]);
    setVoteForbidden(null);
    try {
      const res = await api.credits.committeeVote(code, {
        decision,
        comment: comment.trim(),
        ...(conditions.trim() ? { conditions: conditions.trim() } : {}),
      });
      const out = res as unknown as {
        tally: { approve: number; reject: number };
        quorum: number; resolved: boolean; decision: string | null;
      };
      setVoteDone(
        out.resolved
          ? `Vote enregistré. Quorum atteint : le dossier a été ${
            out.decision === 'approve' ? 'approuvé' : 'rejeté'
          } par le comité (transition passée par le workflow, procès-verbal journalisé).`
          : `Vote enregistré. Décompte : ${out.tally.approve} pour l'approbation, `
            + `${out.tally.reject} pour le rejet — quorum requis ${out.quorum}.`,
      );
      setDecision('');
      setComment('');
      setConditions('');
      setConfirming(false);
      await loadPv();
      if (out.resolved) onResolved();
    } catch (e) {
      setConfirming(false);
      if (e instanceof ApiError && e.status === 403) setVoteForbidden(e.message);
      else setVoteErrors(toFieldErrors(e));
    } finally {
      setBusy(false);
    }
  };

  const dejaVote = !!(mySub && pv?.votes.some((v) => v.voter === mySub));
  const reco = moteur?.state === 'ok' ? recommandationConfig(moteur.data.recommandation) : null;

  return (
    <section className="bg-white/5 border border-emerald-500/30 rounded-xl">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-white">
            Délibération — <span className="font-mono text-sm text-emerald-300">{code}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Procès-verbal servi par le serveur ; un vote enregistré ne se modifie ni ne s'efface.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/credit/dossiers/${code}`}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs"
          >
            Ouvrir le dossier complet
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs"
          >
            Fermer
          </button>
        </div>
      </header>

      {loading && <Loading label="Chargement du procès-verbal…" />}

      {!loading && forbidden && (
        <div className="p-4">
          <Forbidden
            message="Procès-verbal du comité non accessible avec votre rôle."
            detail={forbidden}
          />
        </div>
      )}

      {!loading && !forbidden && loadErrors.length > 0 && (
        <div className="p-4">
          <ErrorPanel errors={loadErrors} title="Procès-verbal illisible" />
        </div>
      )}

      {!loading && !forbidden && pv && (
        <div className="p-4 space-y-5">
          {/* ── Recommandation du moteur — jamais une décision ─────────────── */}
          {moteur?.state === 'ok' && reco && (
            <div className={`rounded-lg border p-3 ${reco.banner}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`w-2 h-2 rounded-full ${reco.dot}`} aria-hidden />
                <span className={`text-sm font-semibold ${reco.text}`}>{reco.label}</span>
                <span className="text-xs text-slate-400">
                  — score {moteur.data.scoreGlobal}/100, lettre {moteur.data.scoreLettre}
                  {moteur.data.dscr != null && <> · DSCR {moteur.data.dscr}</>}
                  {moteur.data.dscrStress != null && <> · DSCR stressé {moteur.data.dscrStress}</>}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Le moteur recommande, l'humain décide : cette ligne n'engage aucun vote.
                Analyse exécutée le {fmtDateTime(moteur.data.executeLe)}.
              </p>
            </div>
          )}
          {moteur?.state === 'absent' && (
            <p className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              Aucune analyse n'a encore été exécutée sur ce dossier : le comité délibérerait
              sans recommandation du moteur. {moteur.message}
            </p>
          )}
          {moteur?.state === 'error' && (
            <p className="text-xs text-slate-400 bg-white/5 border border-white/10 rounded-lg p-3">
              Recommandation du moteur non chargée : {moteur.message}
            </p>
          )}

          {/* ── Quorum ─────────────────────────────────────────────────────── */}
          <div className="bg-black/20 border border-white/10 rounded-lg p-4 space-y-4">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <h3 className="text-sm font-semibold text-slate-200">Quorum</h3>
              <span className="text-xs text-slate-400">
                Requis : <strong className="text-white">{pv.quorum}</strong> voix concordantes
                — paramètre d'institution (`quorum_comite`), figé sur chaque vote enregistré.
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <QuorumBar
                label="Voix pour l'approbation"
                count={pv.tally.approve}
                quorum={pv.quorum}
                tone="approve"
              />
              <QuorumBar
                label="Voix pour le rejet"
                count={pv.tally.reject}
                quorum={pv.quorum}
                tone="reject"
              />
            </div>
            <p className="text-xs">
              {pv.resolved ? (
                <span className="text-amber-200">
                  Délibération close — sens retenu :{' '}
                  <strong>{decisionLabel(pv.decision).label}</strong>. La transition de statut a
                  été passée par la machine à états ; aucun vote supplémentaire n'est accepté.
                </span>
              ) : (
                <span className="text-slate-400">
                  Délibération ouverte : aucun sens n'a encore réuni {pv.quorum} voix.
                </span>
              )}
            </p>
            {!pv.requiresCommittee && (
              <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded p-2">
                Le serveur indique que ce dossier ne requiert PAS le comité (montant sous le
                plafond de délégation de {fmtAmount(pv.thresholdUsd, 'USD')}) : il se décide par
                approbation simple. Un vote y serait refusé (`COMMITTEE_NOT_REQUIRED`).
              </p>
            )}
          </div>

          {/* ── Procès-verbal ──────────────────────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-slate-200 mb-2">
              Votes exprimés{' '}
              <span className="text-xs font-normal text-slate-500">
                ({pv.votes.length} — append-only, ordre chronologique du serveur)
              </span>
            </h3>
            {pv.votes.length === 0 ? (
              <p className="text-sm text-slate-400 bg-white/5 border border-white/10 rounded-lg p-4">
                Aucun vote n'a encore été exprimé sur ce dossier.
              </p>
            ) : (
              <ul className="space-y-2">
                {pv.votes.map((v, i) => {
                  const d = decisionLabel(v.decision);
                  const isMine = !!mySub && v.voter === mySub;
                  return (
                    <li
                      key={`${v.voter}-${v.votedAt}-${i}`}
                      className="bg-white/5 border border-white/10 rounded-lg p-3"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${d.className}`}>
                          {d.label}
                        </span>
                        <span className="font-mono text-xs text-slate-300">{v.voter || '—'}</span>
                        {isMine && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-200">
                            vous
                          </span>
                        )}
                        <span className="text-xs text-slate-500 ml-auto">
                          {fmtDateTime(v.votedAt)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-200 mt-2 whitespace-pre-wrap">{v.comment}</p>
                      {v.conditions && (
                        <p className="text-xs text-orange-200 mt-1.5 whitespace-pre-wrap">
                          Conditions attachées : {v.conditions}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-[11px] text-slate-500 mt-2">
              Le procès-verbal est la séquence de ces votes. Il ne comporte ni bouton de
              modification ni bouton de suppression : le modèle est append-only et le serveur
              n'expose aucun endpoint d'écriture sur un vote déjà enregistré.
            </p>
          </div>

          {/* ── Acte de vote ───────────────────────────────────────────────── */}
          <div className="border-t border-white/10 pt-4">
            {voteDone && (
              <p className="text-sm text-emerald-200 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-3">
                {voteDone}
              </p>
            )}
            {voteForbidden && (
              <div className="mb-3">
                <Forbidden message="Vote refusé par le serveur." detail={voteForbidden} />
              </div>
            )}
            <ErrorPanel errors={voteErrors} title="Vote refusé" />

            {pv.resolved ? (
              <p className="text-sm text-slate-400 mt-2">
                La délibération est close : le formulaire de vote n'est plus proposé.
              </p>
            ) : dejaVote ? (
              <p className="text-sm text-slate-300 bg-white/5 border border-white/10 rounded-lg p-3 mt-2">
                Vous avez déjà voté sur ce dossier. Un membre ne vote qu'une fois et un vote
                enregistré ne se reprend pas — votre position figure au procès-verbal ci-dessus.
              </p>
            ) : (
              <div className="space-y-3 mt-2">
                <h3 className="text-sm font-semibold text-slate-200">Exprimer mon vote</h3>

                <fieldset className="flex flex-wrap gap-2">
                  <legend className="sr-only">Sens du vote</legend>
                  {(['approve', 'reject'] as CommitteeDecision[]).map((d) => (
                    <label
                      key={d}
                      className={`px-3 py-2 rounded-lg border text-sm cursor-pointer ${
                        decision === d
                          ? d === 'approve'
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                            : 'bg-red-500/20 border-red-500/50 text-red-200'
                          : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`decision-${code}`}
                        value={d}
                        checked={decision === d}
                        onChange={() => { setDecision(d); setConfirming(false); }}
                        className="sr-only"
                      />
                      {decisionLabel(d).label}
                    </label>
                  ))}
                </fieldset>

                <label className="block text-xs text-slate-400">
                  Motif de mon vote <span className="text-red-400">(obligatoire)</span>
                  <textarea
                    value={comment}
                    onChange={(e) => { setComment(e.target.value); setConfirming(false); }}
                    rows={3}
                    placeholder="Ce qui fonde votre position : éléments du dossier, écarts, garanties…"
                    className="block w-full mt-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  />
                </label>
                {motifManquant && (
                  <p className="text-xs text-amber-200">
                    Chaque décision de crédit exige son motif : le serveur refuse un vote sans
                    commentaire (`COMMITTEE_DECISION_INVALID`).
                  </p>
                )}

                {decision === 'approve' && (
                  <label className="block text-xs text-slate-400">
                    Conditions attachées à mon approbation (facultatif)
                    <textarea
                      value={conditions}
                      onChange={(e) => setConditions(e.target.value)}
                      rows={2}
                      placeholder="Ex. : garantie complémentaire, différé de 3 mois, décaissement par tranches…"
                      className="block w-full mt-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                    />
                  </label>
                )}

                {!confirming ? (
                  <button
                    type="button"
                    disabled={!decision || motifManquant || busy}
                    onClick={() => setConfirming(true)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-emerald-500 to-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Enregistrer mon vote
                  </button>
                ) : (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-2">
                    <p className="text-sm text-amber-100">
                      Confirmer un vote «&nbsp;{decisionLabel(decision).label}&nbsp;» sur {code} ?
                      Ce vote est définitif : il s'inscrit au procès-verbal et ne peut être ni
                      modifié ni retiré. S'il porte le quorum à {pv.quorum}, il déclenche la
                      décision du comité.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void submitVote()}
                        className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
                      >
                        {busy ? 'Envoi…' : 'Confirmer le vote'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirming(false)}
                        className="px-4 py-2 rounded-lg text-sm bg-white/10 hover:bg-white/20 text-slate-200"
                      >
                        Revenir
                      </button>
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-slate-500">
                  Séparation des tâches : le membre qui a soumis ou initié ce dossier ne peut
                  pas voter sa décision. Cette règle est appliquée par le serveur — si votre
                  vote est refusé pour ce motif, le refus s'affiche ici tel quel.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default CommitteeVotePanel;
