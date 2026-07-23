import React from 'react';
import { Loader2, AlertTriangle, Inbox } from 'lucide-react';
import { deplierErreur } from '@/services/accountingApi';

// États transverses des écrans comptables — chargement / erreur (422 déplié) / vide.
// Mutualisés pour que chaque écran raconte la même histoire à l'utilisateur (CLAUDE.md §5 :
// « états de chargement, d'erreur et vides explicites sur chaque écran de données »).

export const Loading = ({ label = 'Chargement…' }) => (
  <div className="flex items-center justify-center py-12 text-slate-400">
    <Loader2 className="w-5 h-5 animate-spin mr-2" /> {label}
  </div>
);

/** Erreur métier : déplie un 422 multi-erreurs en une puce par refus (code + message). */
export const ErrorState = ({ error, onRetry }) => {
  const items = deplierErreur(error);
  return (
    <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-200">
      <div className="flex items-center gap-2 font-semibold mb-2">
        <AlertTriangle className="w-4 h-4 text-red-400" /> Échec de l'opération
      </div>
      <ul className="space-y-1">
        {items.map((e, i) => (
          <li key={i} className="flex gap-2">
            {e.code && e.code !== 'ERREUR' && (
              <span className="font-mono text-[10px] uppercase text-red-400 mt-0.5">{e.code}</span>
            )}
            <span>{e.message}</span>
          </li>
        ))}
      </ul>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 text-xs underline text-red-300 hover:text-red-100">
          Réessayer
        </button>
      )}
    </div>
  );
};

/** Liste d'erreurs inline (sous un formulaire, sans encadré pleine largeur). */
export const ErrorList = ({ error }) => {
  if (!error) return null;
  const items = deplierErreur(error);
  return (
    <ul className="space-y-1 text-xs text-red-300 mt-2">
      {items.map((e, i) => (
        <li key={i} className="flex gap-2">
          {e.code && e.code !== 'ERREUR' && (
            <span className="font-mono text-[10px] uppercase text-red-400 mt-0.5">{e.code}</span>
          )}
          <span>{e.message}</span>
        </li>
      ))}
    </ul>
  );
};

export const EmptyState = ({ label = 'Aucune donnée.', hint }) => (
  <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-center">
    <Inbox className="w-6 h-6 mb-2 opacity-60" />
    <div>{label}</div>
    {hint && <div className="text-xs mt-1 text-slate-600 max-w-md">{hint}</div>}
  </div>
);
