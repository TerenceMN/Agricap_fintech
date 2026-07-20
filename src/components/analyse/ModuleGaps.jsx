import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, MessageSquarePlus } from 'lucide-react';
import {
  formatMontant, formatEcartPct, formatScore, formatDateFr, libelleIndicateur, NULL_DISPLAY,
} from './analyseFormat';

/** Lecture tolérante camelCase / snake_case, sans jamais inventer de valeur. */
function pick(obj, ...cles) {
  if (!obj) return undefined;
  for (const c of cles) {
    const v = obj[c];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Normalise un écart hors plage, quelle que soit la forme reçue.
 * @returns {{indicateur: string, message: string, ecartPct: number|undefined,
 *            valeur: number|undefined, reference: number|undefined}}
 */
function normaliserEcart(e) {
  return {
    indicateur: String(pick(e, 'indicateur') ?? ''),
    message: String(pick(e, 'message') ?? ''),
    ecartPct: pick(e, 'ecartPct', 'ecart_pct'),
    valeur: pick(e, 'valeur'),
    reference: pick(e, 'reference'),
  };
}

/**
 * Construit la liste unifiée des indicateurs hors plage.
 *
 * Deux sources la portent dans le contrat : `criteres.technique.details.
 * ecartsHorsPlage` (écarts par module) et `indicateursHorsPlage` (liste de
 * l'analyse). On les fusionne par code d'indicateur — sans en supprimer un
 * seul : un indicateur signalé d'un seul côté est un signal, pas un doublon.
 */
export function listerEcartsHorsPlage(analyse) {
  const details = analyse?.criteres?.technique?.details;
  const parModule = pick(details, 'ecartsHorsPlage', 'ecarts_hors_plage') ?? [];
  const global = analyse?.indicateursHorsPlage ?? analyse?.indicateurs_hors_plage ?? [];

  const index = new Map();
  for (const brut of [...(Array.isArray(parModule) ? parModule : []),
    ...(Array.isArray(global) ? global : [])]) {
    const e = normaliserEcart(brut);
    if (!e.indicateur) continue;
    const existant = index.get(e.indicateur);
    index.set(e.indicateur, existant ? { ...existant, ...Object.fromEntries(
      Object.entries(e).filter(([, v]) => v !== undefined && v !== ''),
    ) } : e);
  }
  return [...index.values()];
}

/**
 * Écarts par module vs référentiel filière, avec badge « hors plage » et accès
 * au canal de justification.
 *
 * Écran **staff exclusivement** : il expose les valeurs de référence et les
 * tolérances du référentiel (principe 7, anti-gaming). Aucun de ces chiffres ne
 * doit atteindre une vue client. La vue prévue pour le client est
 * `analyse-resume` — non surfacée à ce jour, cf. `AnalyseTab`.
 *
 * @param {{
 *   analyse: import('@/types/api').CreditAnalyse,
 *   currency?: string,
 *   onJustify: (indicateur: string|null) => void,
 * }} props
 */
const ModuleGaps = ({ analyse, currency = '', onJustify }) => {
  const details = analyse?.criteres?.technique?.details;
  const ecarts = listerEcartsHorsPlage(analyse);
  const justifications = Array.isArray(analyse?.justifications) ? analyse.justifications : [];

  const totalPlan = pick(details, 'totalPlan', 'total_plan');
  const totalRef = pick(details, 'totalReferentiel', 'total_referentiel');
  const ecartMoyen = pick(details, 'ecartMoyenPct', 'ecart_moyen_pct');
  const referentiel = pick(details, 'referentiel') ?? analyse?.referentiel;

  const justifsDe = (indicateur) =>
    justifications.filter((j) => j?.indicateur === indicateur);

  return (
    <section className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-700 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-white text-sm">Écarts par module vs référentiel</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Référentiel <span className="font-mono">{referentiel || NULL_DISPLAY}</span> — plages et
            tolérances réservées au staff.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-slate-600 hover:bg-slate-700"
          onClick={() => onJustify(null)}
          disabled={ecarts.length === 0}
        >
          <MessageSquarePlus className="w-4 h-4 mr-1.5" aria-hidden="true" />
          Justifier un indicateur
        </Button>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 border-b border-slate-700">
        <div className="bg-slate-900/50 rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Total du plan</p>
          <p className="font-bold text-white mt-0.5">{formatMontant(totalPlan, currency)}</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Total référentiel</p>
          <p className="font-bold text-slate-200 mt-0.5">{formatMontant(totalRef, currency)}</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Écart moyen</p>
          <p className="font-bold text-amber-300 mt-0.5">
            {ecartMoyen === undefined ? NULL_DISPLAY : `${formatScore(ecartMoyen)} %`}
          </p>
        </div>
      </div>

      {ecarts.length === 0 ? (
        <p className="px-4 py-5 text-sm text-slate-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
          Aucun indicateur hors plage sur cette analyse.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800">
          {ecarts.map((e) => {
            const justifs = justifsDe(e.indicateur);
            return (
              <li key={e.indicateur} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-100">
                        {libelleIndicateur(e.indicateur)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border bg-red-500/15 text-red-300 border-red-500/30">
                        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                        Hors plage
                      </span>
                      {justifs.length > 0 && (
                        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border bg-sky-500/15 text-sky-300 border-sky-500/30">
                          Justifié ({justifs.length})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{e.message}</p>
                    <p className="text-[11px] text-slate-600 font-mono mt-0.5">{e.indicateur}</p>
                    {(e.valeur !== undefined || e.reference !== undefined) && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        Valeur {formatMontant(e.valeur, currency)} · Référence{' '}
                        {formatMontant(e.reference, currency)}
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Écart</p>
                    <p className="font-bold text-red-300 tabular-nums">
                      {formatEcartPct(e.ecartPct)}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-1 h-7 px-2 text-xs text-slate-300 hover:bg-slate-700"
                      onClick={() => onJustify(e.indicateur)}
                    >
                      Justifier
                    </Button>
                  </div>
                </div>

                {justifs.length > 0 && (
                  <ul className="mt-2 space-y-1.5 border-l-2 border-slate-700 pl-3">
                    {justifs.map((j, i) => (
                      <li key={i} className="text-xs">
                        <p className="text-slate-300 whitespace-pre-line">{j.justification}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {j.agent || 'agent inconnu'} · {formatDateFr(j.date)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default ModuleGaps;
