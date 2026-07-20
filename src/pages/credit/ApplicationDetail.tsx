import React, { useEffect, useState, useCallback } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/services/api';
import type { CreditApplication } from '@/types/api';
import { ErrorPanel, toFieldErrors, type FieldError } from '@/components/backoffice/States';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft:               { label: 'Brouillon',      color: 'text-gray-400 bg-gray-500/20' },
  submitted:           { label: 'Soumis',          color: 'text-blue-300 bg-blue-500/20' },
  in_analysis:         { label: 'En analyse',      color: 'text-yellow-300 bg-yellow-500/20' },
  approved:            { label: 'Approuvé',        color: 'text-emerald-300 bg-emerald-500/20' },
  pending_disbursement:{ label: 'En décaissement', color: 'text-purple-300 bg-purple-500/20' },
  active:              { label: 'Actif',           color: 'text-green-300 bg-green-500/20' },
  closed:              { label: 'Clôturé',         color: 'text-gray-400 bg-gray-600/20' },
  rejected:            { label: 'Rejeté',          color: 'text-red-300 bg-red-500/20' },
  adjourned:           { label: 'Ajourné',         color: 'text-orange-300 bg-orange-500/20' },
};

const ACTION_LABELS: Record<string, string> = {
  submit:               'Soumettre',
  start_analysis:       'Démarrer l\'analyse',
  approve:              'Approuver',
  reject:               'Rejeter',
  adjourn:              'Ajourner',
  reopen_analysis:      'Rouvrir l\'analyse',
  score:                'Recalculer le score',
  client_consent:       'Enregistrer mon consentement',
  request_disbursement: 'Demander le décaissement',
  confirm_disbursement: 'Confirmer le décaissement',
  cancel_disbursement:  'Annuler la demande',
};

const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const fmtDt = (d: string | null) => d ? new Date(d).toLocaleString('fr-FR') : '—';

/** Un refus de transition n'est pas un message : c'est une ou plusieurs règles
 *  nommées. `credits/workflow.py` lève des `WorkflowError` typées
 *  (`INVALID_TRANSITION`, `APPLICATION_INCOMPLETE`, `DELEGATION_EXCEEDED`,
 *  `MAKER_CHECKER_VIOLATION`, `CLIENT_CONSENT_MISSING`, `CLIENT_CONSENT_EXPIRED`)
 *  dont `as_errors()`
 *  alimente `ApiError.errors`. Sur un écran de décision de crédit, savoir
 *  QUELLE règle a bloqué change ce que l'analyste fait ensuite — un plafond de
 *  délégation dépassé s'escalade, une violation maker ≠ checker se délègue. */
interface ActionResult { ok: boolean; message?: string; errors?: FieldError[] }

/** Ce que l'analyste doit faire, par code de refus. Le texte du serveur explique
 *  ce qui s'est passé ; ceci indique la suite. Aucun code inventé : la clé vient
 *  de `WorkflowError.code`, et un code inconnu n'affiche simplement rien. */
const REFUSAL_GUIDANCE: Record<string, string> = {
  DELEGATION_EXCEEDED:
    "Ce montant dépasse votre plafond d'approbation. Transmettez le dossier au comité de crédit.",
  MAKER_CHECKER_VIOLATION:
    'Séparation des tâches : vous avez initié cet acte, un autre profil doit le confirmer.',
  CLIENT_CONSENT_MISSING:
    "Le consentement du client n'a pas encore été recueilli. Contactez-le pour "
    + "qu'il confirme sa demande avant d'instruire le dossier.",
  // Distinct de MISSING : l'action attendue n'est pas la même — un consentement
  // manquant se recueille, un consentement expiré se renouvelle. Le backend les
  // sépare en deux sous-classes (`ConsentError` / `ConsentExpired`, 409 / 410) ;
  // les fondre dans un « absent ou expiré » reperdrait la distinction côté écran.
  CLIENT_CONSENT_EXPIRED:
    "La fenêtre de consentement de 72 h est dépassée. Le client doit être "
    + "recontacté pour reformuler sa demande — l'ancien accord ne vaut plus.",
  APPLICATION_INCOMPLETE:
    'Le dossier ne réunit pas les pièces requises pour cette transition.',
  INVALID_TRANSITION:
    "Cette transition n'est pas permise depuis le statut actuel du dossier.",
};

/** Codes qu'on relaie volontairement sans suite à donner : le message du
 *  serveur se suffit à lui-même. Les lister empêche l'avertissement ci-dessous
 *  de se déclencher en permanence — un warning qui crie tout le temps finit
 *  ignoré, et c'est alors qu'il rate le vrai cas. */
const NO_GUIDANCE_NEEDED = new Set(['WORKFLOW_ERROR', 'PARSE_ERROR', 'CLIENT_NOT_FOUND']);

/** Suite à donner pour un code de refus, ou `undefined`.
 *
 *  Un code inconnu doit être bruyant en développement. Ce dictionnaire est
 *  resté silencieusement mort pendant tout un lot : il était écrit en
 *  MAJUSCULES alors que le backend émettait des codes en minuscules, le lookup
 *  rendait `undefined`, et le `.filter(Boolean)` supprimait la guidance sans
 *  que rien ne le signale. Une clé manquante ne doit plus disparaître en silence. */
function lookupGuidance(code: string): string | undefined {
  const guidance = REFUSAL_GUIDANCE[code];
  if (!guidance && !NO_GUIDANCE_NEEDED.has(code) && import.meta.env.DEV) {
    console.warn(
      `[credit] Code de refus « ${code} » sans suite à donner — ajouter une entrée `
      + 'dans REFUSAL_GUIDANCE, ou dans NO_GUIDANCE_NEEDED si le message serveur suffit.',
    );
  }
  return guidance;
}

const ApplicationDetail: React.FC = () => {
  const { code = '' } = useParams();
  const [app, setApp] = useState<CreditApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);

  // Simple form state for actions that need input
  const [approveAmount, setApproveAmount] = useState('');
  const [approveComment, setApproveComment] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectComment, setRejectComment] = useState('');
  const [adjournComment, setAdjournComment] = useState('');
  const [disbursementNotes, setDisbursementNotes] = useState('');
  const [expandedAction, setExpandedAction] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.credits.get(code)
      .then(setApp)
      .catch((e) => setError((e as Error).message));
  }, [code]);

  useEffect(() => { reload(); }, [reload]);

  const runAction = async (action: string) => {
    setActionBusy(action);
    setActionResult(null);
    try {
      let result: CreditApplication;
      switch (action) {
        case 'submit':
          result = await api.credits.submit(code);
          break;
        case 'start_analysis':
          result = await api.credits.startAnalysis(code);
          break;
        case 'approve':
          result = await api.credits.approve(code, {
            amount_approved: parseFloat(approveAmount) || (app?.amountRequested ?? 0),
            comment: approveComment,
          });
          break;
        case 'reject':
          result = await api.credits.reject(code, { reason_code: rejectReason, comment: rejectComment });
          break;
        case 'adjourn':
          result = await api.credits.adjourn(code, { comment: adjournComment });
          break;
        case 'reopen_analysis':
          result = await api.credits.reopenAnalysis(code);
          break;
        case 'score':
          await api.credits.score(code);
          reload();
          setActionResult({ ok: true, message: 'Score recalculé.' });
          return;
        case 'client_consent':
          result = await api.credits.consent(code, { method: 'web' });
          break;
        case 'request_disbursement':
          result = await api.credits.requestDisbursement(code, { notes: disbursementNotes });
          break;
        case 'confirm_disbursement':
          await api.credits.confirmDisbursement(code);
          reload();
          setActionResult({ ok: true, message: 'Décaissement confirmé.' });
          return;
        case 'cancel_disbursement':
          result = await api.credits.cancelDisbursement(code);
          break;
        default:
          return;
      }
      // Les réponses de transition sont produites par `serialize_application`,
      // qui n'ajoute PAS `availableActions` — seul `serialize_for_role` le fait
      // (`GET /applications/<code>/`). Afficher `result` tel quel viderait donc
      // la barre d'actions après chaque acte. On relit le dossier complet.
      void result;
      reload();
      setExpandedAction(null);
      setActionResult({ ok: true });
    } catch (e) {
      // `toFieldErrors` restitue une ligne par règle refusée, avec son code —
      // au lieu d'aplatir « approbation refusée » sur cinq causes distinctes.
      setActionResult({ ok: false, errors: toFieldErrors(e) });
    } finally {
      setActionBusy(null);
    }
  };

  if (!app && !error) {
    return (
      <div className="p-8 text-center text-slate-400">Chargement du dossier {code}…</div>
    );
  }

  if (error && !app) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-4">{error}</div>
      </div>
    );
  }

  if (!app) return null;

  const st = STATUS_LABELS[app.status] ?? { label: app.status, color: 'text-gray-400 bg-gray-500/20' };
  const score = app.scoreResult;
  // `availableActions` est optionnel dans le contrat : absent des réponses de
  // transition. Un dossier sans actions n'est pas une anomalie — c'est un
  // dossier sur lequel le serveur n'autorise rien à cet utilisateur.
  const actions = app.availableActions ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 text-white">
      <Helmet><title>Dossier {code} — AGRICAP FINTECH</title></Helmet>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold font-mono">{app.code}</h1>
            <span className={`text-xs font-medium px-3 py-1 rounded-full ${st.color}`}>{st.label}</span>
          </div>
          <p className="text-slate-400 text-sm">
            Client : <span className="text-white font-medium">{app.client.displayName}</span>
            {app.valueChain && <> · Filière : <span className="text-emerald-400">{app.valueChain.label}</span></>}
          </p>
        </div>
        <Link to="/credit/dossiers" className="text-sm text-primary underline">
          ← Retour aux dossiers
        </Link>
      </div>

      {/* Résultat de l'acte : succès en une ligne, refus détaillé règle par règle */}
      {actionResult?.ok && (
        <div className="rounded-lg p-3 text-sm bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
          ✓ {actionResult.message || 'Opération réussie.'}
        </div>
      )}
      {actionResult && !actionResult.ok && (
        <div className="space-y-2">
          <ErrorPanel
            errors={actionResult.errors ?? [{ message: actionResult.message || 'Erreur.' }]}
            title="Le serveur a refusé cet acte"
          />
          {/* Suite à donner, quand le code de refus en appelle une. Le message du
              serveur dit ce qui s'est passé ; ceci dit quoi faire ensuite. */}
          {(actionResult.errors ?? [])
            .map((e) => (e.code ? lookupGuidance(e.code) : undefined))
            .filter((g): g is string => Boolean(g))
            .map((guidance, i) => (
              <p key={i} className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                {guidance}
              </p>
            ))}
        </div>
      )}

      {/* Available actions */}
      {actions.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <h3 className="font-semibold text-sm text-slate-400 mb-3 uppercase tracking-wide">Actions disponibles</h3>
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <div key={action}>
                <button
                  disabled={actionBusy === action}
                  onClick={() => setExpandedAction(expandedAction === action ? null : action)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all
                    ${action === 'submit' || action === 'approve' || action === 'confirm_disbursement'
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : action === 'reject'
                        ? 'bg-red-700/60 hover:bg-red-600 text-white'
                        : 'bg-white/10 hover:bg-white/20 text-slate-200'}
                    disabled:opacity-50`}
                >
                  {actionBusy === action ? '…' : (ACTION_LABELS[action] ?? action)}
                </button>

                {/* Inline forms for actions needing input */}
                {expandedAction === action && (
                  <div className="mt-2 bg-slate-800/80 border border-white/10 rounded-lg p-4 space-y-3 min-w-64">
                    {action === 'approve' && (
                      <>
                        <div>
                          <label className="text-xs text-slate-400">Montant approuvé</label>
                          <input
                            type="number"
                            className="w-full mt-1 bg-white/10 border border-white/20 rounded px-3 py-1.5 text-sm"
                            placeholder={String(app.amountRequested)}
                            value={approveAmount}
                            onChange={(e) => setApproveAmount(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Commentaire (optionnel)</label>
                          <textarea
                            className="w-full mt-1 bg-white/10 border border-white/20 rounded px-3 py-1.5 text-sm"
                            rows={2}
                            value={approveComment}
                            onChange={(e) => setApproveComment(e.target.value)}
                          />
                        </div>
                      </>
                    )}
                    {action === 'reject' && (
                      <>
                        <div>
                          <label className="text-xs text-slate-400">Code motif</label>
                          <select
                            className="w-full mt-1 bg-white/10 border border-white/20 rounded px-3 py-1.5 text-sm"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                          >
                            <option value="">Choisir…</option>
                            <option value="SCORE_INSUFFISANT">Score insuffisant</option>
                            <option value="GARANTIE_INSUFFISANTE">Garantie insuffisante</option>
                            <option value="ENDETTEMENT_ELEVE">Endettement élevé</option>
                            <option value="INCOHERENCE_BESOINS">Incohérence feuille de besoins</option>
                            <option value="AUTRE">Autre</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">Explication</label>
                          <textarea
                            className="w-full mt-1 bg-white/10 border border-white/20 rounded px-3 py-1.5 text-sm"
                            rows={2}
                            value={rejectComment}
                            onChange={(e) => setRejectComment(e.target.value)}
                          />
                        </div>
                      </>
                    )}
                    {action === 'adjourn' && (
                      <div>
                        <label className="text-xs text-slate-400">Commentaire (requis)</label>
                        <textarea
                          className="w-full mt-1 bg-white/10 border border-white/20 rounded px-3 py-1.5 text-sm"
                          rows={2}
                          value={adjournComment}
                          onChange={(e) => setAdjournComment(e.target.value)}
                        />
                      </div>
                    )}
                    {action === 'request_disbursement' && (
                      <div>
                        <label className="text-xs text-slate-400">Notes (optionnel)</label>
                        <textarea
                          className="w-full mt-1 bg-white/10 border border-white/20 rounded px-3 py-1.5 text-sm"
                          rows={2}
                          value={disbursementNotes}
                          onChange={(e) => setDisbursementNotes(e.target.value)}
                        />
                      </div>
                    )}
                    <button
                      onClick={() => runAction(action)}
                      disabled={!!actionBusy}
                      className="w-full py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50"
                    >
                      {actionBusy ? 'Traitement…' : 'Confirmer'}
                    </button>
                  </div>
                )}

              </div>
            ))}
          </div>
          {/* Retiré : deux blocs morts qui prétendaient exécuter immédiatement les
              actions sans saisie. Le premier se terminait par `&& null` (rien
              rendu), le second produisait des <button className="hidden" /> sans
              libellé — donc invisibles et inatteignables. Les actions sans saisie
              passent par le même panneau de confirmation que les autres : un clic
              ouvre, un clic confirme. Confirmer explicitement un décaissement ou
              une prise en charge n'est pas une friction à supprimer. */}
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoCard label="Montant demandé" value={`${(app.amountRequested ?? 0).toLocaleString('fr-FR')} ${app.currency}`} />
        <InfoCard label="Montant approuvé" value={app.amountApproved ? `${app.amountApproved.toLocaleString('fr-FR')} ${app.currency}` : '—'} />
        <InfoCard label="Superficie" value={app.areaHa ? `${app.areaHa} ha` : '—'} />
        <InfoCard label="Garantie" value={app.guaranteeType || '—'} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoCard label="Soumis le" value={fmt(app.submittedAt)} />
        <InfoCard
          label="Décaissé le"
          value={app.disbursement?.status === 'confirmed' ? fmt(app.disbursement.confirmedAt) : '—'}
        />
        <InfoCard
          label="Montant décaissé"
          value={
            app.disbursement?.status === 'confirmed'
              ? `${app.disbursement.amount.toLocaleString('fr-FR')} ${app.disbursement.currency}`
              : '—'
          }
        />
        <InfoCard label="Créé le" value={fmt(app.createdAt)} />
      </div>

      {/* Scoring */}
      {score && (
        <section className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 className="font-bold text-lg mb-4">Résultat de scoring</h3>
          <div className="flex items-center gap-6 mb-4">
            <div className="text-center">
              <p className="text-sm text-slate-400">Score global</p>
              <p className={`text-4xl font-black ${score.score >= 70 ? 'text-emerald-400' : score.score >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                {score.score}
              </p>
              <p className="text-xs text-slate-400">/100</p>
            </div>
            <div>
              <p className={`text-lg font-semibold ${score.eligible ? 'text-emerald-400' : 'text-red-400'}`}>
                {score.eligible ? '✓ Éligible' : '✗ Non éligible'}
              </p>
              <p className="text-sm text-slate-400">{score.valuationNote}</p>
              {score.proposedRate && (
                <p className="text-sm text-white mt-1">Taux proposé : <span className="font-bold text-blue-300">{score.proposedRate}%</span> / an</p>
              )}
            </div>
          </div>
          {score.breakdown && score.breakdown.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th className="text-left py-2">Critère</th>
                  <th className="text-right py-2">Points</th>
                  <th className="text-right py-2">Maximum</th>
                </tr>
              </thead>
              <tbody>
                {score.breakdown.map((b, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="py-2 capitalize">{b.criterion.replace(/_/g, ' ')}</td>
                    <td className="py-2 text-right font-bold text-emerald-300">{b.points}</td>
                    <td className="py-2 text-right text-slate-400">{b.maxPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* Garanties */}
      {app.guarantees && app.guarantees.count > 0 && (
        <section className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 className="font-bold text-lg mb-4">Garanties</h3>
          <div className="space-y-3">
            {app.guarantees.items.map((g) => (
              <div key={g.id} className="bg-white/5 rounded-lg p-4 flex items-start gap-4">
                <div className={`w-2 h-2 rounded-full mt-1.5 ${g.status === 'active' ? 'bg-emerald-400' : g.status === 'pending' ? 'bg-yellow-400' : 'bg-gray-500'}`} />
                <div className="flex-1">
                  <p className="font-medium">{g.type === 'epargne' ? 'Nantissement Épargne' : 'Caution Morale'}</p>
                  <p className="text-xs text-slate-400">{g.status} · {fmt(g.createdAt)}</p>
                  {g.holdAmount && <p className="text-sm mt-1">Montant bloqué : <span className="text-emerald-300 font-semibold">{g.holdAmount.toLocaleString()} {g.holdCurrency}</span></p>}
                  {g.guarantorName && <p className="text-sm mt-1">Garant : <span className="font-semibold">{g.guarantorName}</span> · {g.guarantorPhone}</p>}
                  {g.daysLeft != null && <p className="text-xs text-yellow-300">Expiration dans {g.daysLeft} jours</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Allocations */}
      {app.moduleAllocations && app.moduleAllocations.length > 0 && (
        <section className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 className="font-bold text-lg mb-4">Répartition par module</h3>
          <table className="w-full text-sm">
            <thead className="text-slate-400 border-b border-white/10">
              <tr>
                <th className="text-left py-2">Module</th>
                <th className="text-right py-2">Coût estimé</th>
                <th className="text-right py-2">% financé</th>
                <th className="text-right py-2">Montant financé</th>
              </tr>
            </thead>
            <tbody>
              {app.moduleAllocations.map((m, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="py-2 capitalize">{m.module.replace(/_/g, ' ')}</td>
                  <td className="py-2 text-right">{m.cost.toLocaleString('fr-FR')} {app.currency}</td>
                  <td className="py-2 text-right">{m.financingPct}%</td>
                  <td className="py-2 text-right font-bold text-emerald-300">{m.amountFinanced.toLocaleString('fr-FR')} {app.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Décaissement */}
      {app.disbursement && (
        <section className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 className="font-bold text-lg mb-4">Décaissement</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <InfoCard label="Statut" value={app.disbursement.status} />
            <InfoCard label="Montant" value={`${app.disbursement.amount.toLocaleString()} ${app.disbursement.currency}`} />
            <InfoCard label="Demandé le" value={fmtDt(app.disbursement.requestedAt)} />
            {app.disbursement.confirmedAt && <InfoCard label="Confirmé le" value={fmtDt(app.disbursement.confirmedAt)} />}
          </div>
        </section>
      )}

      {/* Needs sheet */}
      {app.needsSheet && (
        <section className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 className="font-bold text-lg mb-4">Feuille de besoins</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoCard label="Total besoins" value={`${(app.needsSheet.grandTotal ?? 0).toLocaleString('fr-FR')} ${app.needsSheet.currency}`} />
            {/* Ex-carte « Superficie », qui lisait `needsSheet.area_ha` — déclaré au type
                mais jamais émis, donc vide en permanence. Le champ a depuis été retiré du
                type. On trace la révision parsée : c'est ce qui permet de rattacher une
                analyse à une version précise de la feuille. */}
            <InfoCard label="Révision parsée" value={app.needsSheet.id != null ? `#${app.needsSheet.id}` : '—'} />
            <InfoCard label="Validée" value={app.needsSheet.parsedOk ? 'Oui' : 'Non'} />
            <InfoCard label="Devise" value={app.needsSheet.currency} />
          </div>
          {/* Anomalies AVANT avertissements : une anomalie est un écart relevé par
              l'analyse documentaire, c'est la première chose qu'un analyste lit sur une
              feuille de besoins. Le champ est typé `unknown[]` — le backend y met selon
              les cas une chaîne ou un objet — donc on rend défensivement plutôt que de
              supposer une forme et d'afficher « [object Object] ». */}
          {app.needsSheet.anomalies && app.needsSheet.anomalies.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-red-300 uppercase tracking-wide mb-2">
                Anomalies relevées ({app.needsSheet.anomalies.length})
              </h4>
              <div className="space-y-1">
                {app.needsSheet.anomalies.map((a, i) => (
                  <p key={i} className="text-xs text-red-200 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
                    {typeof a === 'string' ? a : JSON.stringify(a)}
                  </p>
                ))}
              </div>
            </div>
          )}

          {app.needsSheet.warnings && app.needsSheet.warnings.length > 0 && (
            <div className="mt-4 space-y-1">
              {app.needsSheet.warnings.map((w, i) => (
                <p key={i} className="text-xs text-yellow-300 flex gap-2">⚠ {w}</p>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

const InfoCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-white/5 border border-white/10 rounded-lg p-3">
    <p className="text-xs text-slate-400 mb-1">{label}</p>
    <p className="font-semibold text-white text-sm">{value}</p>
  </div>
);

export default ApplicationDetail;
