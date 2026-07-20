/**
 * Les 8 modules du plan de financement — calque strict de la feuille ingérée.
 *
 * SPEC §1.4 points 2 et 3 :
 *  - le **coût** de chaque module est en lecture seule, tel que
 *    `5_Synthese_Besoins` l'a livré (aucun `Input`, aucun `Switch`) ;
 *  - le **seul** réglage restant est « Financement demandé % » : la part du
 *    besoin que le client demande à AGRICAP.
 *
 * Ce que ce composant ne fait pas : inventer un coût, activer un module que le
 * fichier laisse à 0, ni estimer un score. Le `Math.random()` d'initialisation
 * du prototype a disparu avec lui.
 */
import React from 'react';
import { Lock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { formatMontant } from '@/components/guarantees/format';
import { MODULE_CODES, moduleConfig } from './modules';

/**
 * @param {object} props
 * @param {Record<string, number>|null} props.costs coût par module, `null` tant qu'aucune feuille
 * @param {Record<string, number>} props.financing part demandée par module, en %
 * @param {(code: string, pct: number) => void} props.onFinancingChange
 * @param {string} props.currency devise du dossier
 */
const ModuleGrid = ({ costs, financing, onFinancingChange, currency }) => {
  const locked = !costs;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h4 className="font-bold text-white">Plan de financement par module</h4>
        <p className="text-xs text-gray-500">
          {locked
            ? 'En attente de votre feuille de besoins'
            : 'Coûts issus de votre fichier — seule la part demandée est réglable'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MODULE_CODES.map((code) => {
          const cfg = moduleConfig(code);
          const Icon = cfg.icon;
          const cost = locked ? null : Number(costs[code] ?? 0);
          // Un module à 0 dans le fichier n'est pas finançable : il est grisé,
          // et son curseur n'existe pas — pas seulement désactivé.
          const empty = locked || !(cost > 0);
          const pct = financing[code] ?? 100;

          return (
            <div
              key={code}
              className={`glass-effect p-4 rounded-lg transition-opacity duration-300 ${
                empty ? 'opacity-45' : 'opacity-100'
              }`}
            >
              <div className="flex justify-between items-start gap-3 mb-3">
                <Label className="flex items-center gap-2 text-white text-sm">
                  <Icon className="w-4 h-4 shrink-0" style={{ color: cfg.color }} aria-hidden="true" />
                  {cfg.label}
                </Label>
                <div className="text-right shrink-0">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 flex items-center justify-end gap-1">
                    <Lock className="w-2.5 h-2.5" aria-hidden="true" /> coût du fichier
                  </p>
                  <p className={`font-semibold tabular-nums ${empty ? 'text-gray-600' : 'text-white'}`}>
                    {locked ? '—' : formatMontant(cost, currency, { decimals: 0 })}
                  </p>
                </div>
              </div>

              {empty ? (
                <p className="text-xs text-gray-600">
                  {locked
                    ? 'Aucun montant tant que la feuille de besoins n\'est pas déposée.'
                    : 'Rubrique à 0 dans votre feuille — rien à financer sur ce poste.'}
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between items-baseline">
                    <Label htmlFor={`fin-${code}`} className="text-xs text-gray-400">
                      Financement demandé
                    </Label>
                    <span className="text-sm font-bold text-emerald-400 tabular-nums">{pct} %</span>
                  </div>
                  <Slider
                    id={`fin-${code}`}
                    value={[pct]}
                    onValueChange={(val) => onFinancingChange(code, val[0])}
                    max={100}
                    step={5}
                    aria-label={`Part financée par AGRICAP pour ${cfg.label}`}
                  />
                  <p className="text-xs text-gray-500 tabular-nums">
                    demandé à AGRICAP :{' '}
                    <span className="text-gray-300">
                      {formatMontant((cost * pct) / 100, currency, { decimals: 0 })}
                    </span>
                    {pct < 100 && (
                      <>
                        {' '}· à votre charge :{' '}
                        {formatMontant((cost * (100 - pct)) / 100, currency, { decimals: 0 })}
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ModuleGrid;
