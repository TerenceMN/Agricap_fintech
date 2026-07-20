import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import type { CreditApplication } from '@/types/api';

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

const Applications: React.FC = () => {
  const [apps, setApps] = useState<CreditApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const load = (status = statusFilter) => {
    setLoading(true);
    api.credits
      .list(status ? { status } : undefined)
      .then(setApps)
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleStatusChange = (s: string) => {
    setStatusFilter(s);
    load(s);
  };

  const fmt = (dateStr: string | null) =>
    dateStr ? new Date(dateStr).toLocaleDateString('fr-FR') : '—';

  const fmtAmount = (amount: number | null, currency: string) =>
    amount ? `${amount.toLocaleString('fr-FR')} ${currency}` : '—';

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Helmet><title>Mes dossiers de crédit — AGRICAP FINTECH</title></Helmet>

      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-white">Mes dossiers de crédit</h1>
        <div className="flex gap-3">
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <Link
            to="/credit"
            className="bg-gradient-to-r from-emerald-500 to-blue-600 text-white font-semibold px-4 py-2 rounded-lg text-sm"
          >
            + Nouvelle demande
          </Link>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-slate-400 border-b border-white/10">
            <tr>
              <th className="text-left p-4">Code</th>
              <th className="text-left p-4">Filière</th>
              <th className="text-left p-4">Montant demandé</th>
              <th className="text-center p-4">Statut</th>
              <th className="text-center p-4">Score</th>
              <th className="text-left p-4">Créé le</th>
              <th className="p-4"></th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => {
              const st = STATUS_LABELS[a.status] ?? { label: a.status, color: 'text-gray-400 bg-gray-500/20' };
              const score = a.score_result?.score;
              return (
                <tr key={a.code} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                  <td className="p-4 font-mono text-xs text-emerald-300">{a.code}</td>
                  <td className="p-4">{a.value_chain?.label ?? '—'}</td>
                  <td className="p-4 font-semibold">{fmtAmount(a.amount_requested, a.currency)}</td>
                  <td className="p-4 text-center">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.color}`}>{st.label}</span>
                  </td>
                  <td className="p-4 text-center">
                    {score != null ? (
                      <span className={`font-bold ${score >= 70 ? 'text-emerald-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {score}/100
                      </span>
                    ) : '—'}
                  </td>
                  <td className="p-4 text-slate-400">{fmt(a.createdAt)}</td>
                  <td className="p-4 text-right">
                    <Link to={`/credit/dossiers/${a.code}`} className="text-primary text-xs underline">
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!loading && apps.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  Aucun dossier trouvé.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">Chargement…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Applications;
