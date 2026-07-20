/**
 * Corbeille du comité de crédit — `/credit/comite`.
 *
 * `GET /api/credits/dashboard/?view=committee` (`credits/dashboard.py::_committee_dashboard`)
 * sert les dossiers en analyse dont le montant dépasse la délégation du niveau
 * agence. La lentille est refusée en 403 à tout rôle hors `COMMITTEE_ROLES`
 * (`dg`, `admin`) — refus traité comme une décision d'autorisation, pas comme
 * une panne.
 *
 * Le comité n'a pas de rôle propre dans le registre RBAC : il est exercé par la
 * direction. Cet écran ne rend donc visible aucun pouvoir supplémentaire ; il
 * regroupe une file. Les décisions se prennent dans le détail du dossier, où
 * `availableActions` est calculé par le serveur.
 *
 * Non couvert par le backend (voir le fragment de statut) : quorum paramétrable
 * et procès-verbal collégial n'existent pas encore côté serveur. Aucun bouton
 * ne les simule ici.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/services/api';
import {
  Empty, ErrorPanel, Forbidden, KpiCard, Loading, TruncationNotice,
  toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import {
  PENDING_LIST_CAP, fmtAmount, fmtDate, statusOf, type WireCommitteeDashboard,
} from './wire';

const Committee: React.FC = () => {
  const [data, setData] = useState<WireCommitteeDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    try {
      const res = await api.credits.dashboard('committee');
      setData(res as unknown as WireCommitteeDashboard);
    } catch (e) {
      setData(null);
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(e.message);
      } else {
        setErrors(toFieldErrors(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const summary = data?.summary;
  const rows = data?.pendingApplications ?? [];

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
              <span className="text-xs text-slate-500">
                {rows.length} affiché(s) — total_rows = {summary.pendingReview}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="text-left p-4">Code</th>
                    <th className="text-left p-4">Filière</th>
                    <th className="text-right p-4">Montant demandé</th>
                    <th className="text-center p-4">Statut</th>
                    <th className="text-left p-4">Créé le</th>
                    <th className="p-4" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const st = statusOf(r.status);
                    return (
                      <tr key={r.code} className="border-t border-white/5 hover:bg-white/5">
                        <td className="p-4 font-mono text-xs text-emerald-300">{r.code}</td>
                        <td className="p-4 text-slate-300">{r.value_chain__label ?? '—'}</td>
                        <td className="p-4 text-right font-semibold whitespace-nowrap">
                          {fmtAmount(r.amount_requested, r.currency)}
                        </td>
                        <td className="p-4 text-center">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.color}`}>{st.label}</span>
                        </td>
                        <td className="p-4 text-slate-400 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                        <td className="p-4 text-right">
                          <Link to={`/credit/dossiers/${r.code}`} className="text-primary text-xs underline">
                            Examiner
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
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-slate-400 space-y-2">
            <p className="text-slate-300 font-semibold text-sm">Ce que cet écran ne fait pas</p>
            <p>
              Aucune décision ne se prend ici. Le comité examine un dossier via « Examiner » ;
              les actions y sont celles que le serveur autorise pour l'utilisateur connecté
              (maker ≠ checker et plafond de délégation déjà appliqués).
            </p>
            <p>
              Le <strong>quorum paramétrable</strong> et le <strong>procès-verbal collégial</strong>
              {' '}prévus au §7.1 n'ont pas d'endpoint : ils ne sont ni affichés ni simulés.
            </p>
            <p>
              Le seuil de mise au comité est comparé au montant demandé <em>sans conversion de
              devise</em> côté serveur : un dossier libellé en CDF peut entrer ou sortir de cette
              corbeille à tort. Anomalie backend signalée, non contournée ici.
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
