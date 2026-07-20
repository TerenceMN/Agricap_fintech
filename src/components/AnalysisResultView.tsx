import React from 'react';
import type { AnalysisResult, VraisemblanceItem } from '@/types/api';

export const verdictColor = (v: VraisemblanceItem['verdict']): string =>
  v === 'OK' || v === 'JUSTIFIÉ' ? 'text-emerald-400'
    : v.startsWith('À VÉRIFIER') ? 'text-amber-400'
      : 'text-slate-400';

const decisionBadge = (code: string): string => ({
  FAVORABLE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  FAVORABLE_SOUS_CONDITIONS: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  A_INSTRUIRE: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  DEFAVORABLE_EN_L_ETAT: 'bg-red-500/15 text-red-300 border-red-500/30',
}[code] || 'bg-white/5 text-slate-300 border-white/10');

// Vue de résultat partagée (nouvelle analyse + consultation d'un dossier).
const AnalysisResultView: React.FC<{ result: AnalysisResult; showDecision?: boolean }> = ({ result, showDecision = false }) => {
  const ck = result.chiffres_cles ?? {};
  const dec = result.decision_suggeree;
  return (
    <div className="space-y-5">
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <span>Statut : <b>{result.statut}</b></span>
          <span>Filière : <b>{result.chaine_valeur.libelle || '—'}</b> (confiance {result.chaine_valeur.confiance})</span>
          <span>Cycle : <b>{ck.duree_mois ?? '—'} mois</b></span>
          {showDecision && dec?.code && (
            <span className={`px-3 py-1 rounded-full border text-xs font-semibold ${decisionBadge(dec.code)}`}>
              {dec.code.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        {showDecision && dec?.conditions?.length > 0 && (
          <ul className="mt-3 text-sm text-slate-300 list-disc pl-5">
            {dec.conditions.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        )}
      </div>

      {/* Retour client (§6) — sans décision ni score interne. */}
      {result.retour_client && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-5 whitespace-pre-line text-sm">
          {result.retour_client}
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-3">
        {([['Besoin total', ck.besoin_total], ['Crédit proposé', ck.credit_propose], ['EBE', ck.ebe],
          ['DSCR', ck.dscr], ['DSCR stressé', ck.dscr_stresse_min], ['Couverture', ck.couverture_garanties]] as const).map(([k, v]) => (
          <div key={k} className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-xs text-slate-400">{k}</div>
            <div className="text-lg font-semibold">{v ?? '—'}</div>
          </div>
        ))}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 overflow-x-auto">
        <h3 className="font-semibold mb-2">Contrôles de vraisemblance</h3>
        <table className="w-full text-sm">
          <thead className="text-slate-400"><tr><th className="text-left">Contrôle</th><th>Valeur</th><th>Plage</th><th>Verdict</th></tr></thead>
          <tbody>
            {result.vraisemblance.map((v, i) => (
              <tr key={i} className="border-t border-white/5">
                <td className="py-1">{v.controle}<div className="text-xs text-slate-500">{v.explication}</div></td>
                <td className="text-center">{v.valeur ?? '—'}</td>
                <td className="text-center">{v.ref_min ?? '—'}–{v.ref_max ?? '—'}</td>
                <td className={`text-center font-medium ${verdictColor(v.verdict)}`}>{v.verdict}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.code && (
        <div className="flex gap-3">
          <a href={`/api/credits/applications/${result.code}/rapport?format=excel`} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm">Rapport Excel</a>
          <a href={`/api/credits/applications/${result.code}/rapport?format=word`} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm">Rapport Word</a>
        </div>
      )}
    </div>
  );
};

export default AnalysisResultView;
