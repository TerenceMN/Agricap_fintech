import React from 'react';
import { Gavel, Info } from 'lucide-react';
import { recommandationConfig } from './recommandation';
import { formatScore, formatDateTimeFr } from './analyseFormat';

/**
 * Bandeau de recommandation du moteur — 4 niveaux colorés.
 *
 * Principe 2 (CLAUDE.md §3) : **le moteur recommande, l'humain décide.** Ce
 * bandeau ne doit jamais se lire comme une décision prise ; la mention est
 * portée par le composant lui-même, pas laissée à la discrétion de l'écran qui
 * l'intègre. Aucune action de workflow n'est déclenchée d'ici.
 *
 * @param {{
 *   recommandation: string|null,
 *   scoreGlobal: number|null,
 *   executeLe?: string|null,
 *   versionMoteur?: string|null,
 *   referentiel?: string|null,
 * }} props
 */
const RecommendationBanner = ({
  recommandation,
  scoreGlobal,
  executeLe,
  versionMoteur,
  referentiel,
}) => {
  const cfg = recommandationConfig(recommandation);

  return (
    <div className={`rounded-xl border p-4 ${cfg.banner}`} role="status">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`} aria-hidden="true" />
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              Recommandation du moteur
            </p>
            <p className={`text-lg font-bold ${cfg.text}`}>{cfg.label}</p>
            {!cfg.known && (
              <p className="text-[11px] text-slate-400 mt-1">
                Code non prévu par le barème à 4 niveaux — affiché tel quel, sans interprétation.
              </p>
            )}
          </div>
        </div>

        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Score global</p>
          <p className="text-2xl font-bold text-white leading-tight">
            {formatScore(scoreGlobal)}
            <span className="text-sm text-slate-400 font-normal">/100</span>
          </p>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs text-slate-300 bg-black/20 rounded-lg px-3 py-2">
        <Gavel className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
        <span>
          <strong className="text-slate-100">Le moteur recommande, l'humain décide.</strong>{' '}
          Cette recommandation éclaire l'instruction ; elle ne vaut pas décision et ne
          déclenche aucune transition du dossier. La décision reste un acte humain, motivé
          et journalisé.
        </span>
      </p>

      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <Info className="w-3 h-3" aria-hidden="true" />
        <span>Exécutée le {formatDateTimeFr(executeLe)}</span>
        {versionMoteur && <span>Moteur v{versionMoteur}</span>}
        {referentiel && <span>Référentiel : <span className="font-mono">{referentiel}</span></span>}
      </p>
    </div>
  );
};

export default RecommendationBanner;
