import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Hourglass, Target, Info } from 'lucide-react';
import { formatCurrency } from '@/lib/investorSpaceUtils';
import { formatPercent } from '@/lib/investorSpaceWire';

const ICONS = { realized: TrendingUp, latent: Hourglass, expected: Target };
const TONES = {
  realized: 'from-emerald-900/40 to-slate-900 border-emerald-500/30 text-emerald-400',
  latent: 'from-amber-900/30 to-slate-900 border-amber-500/30 text-amber-400',
  expected: 'from-blue-900/40 to-slate-900 border-blue-500/30 text-blue-400',
};

/**
 * Les trois colonnes de rendement — réalisé, latent, attendu — côte à côte.
 *
 * Elles sont rendues ENSEMBLE, toujours, et jamais fusionnées : un chiffre
 * unique de « performance » mélangerait ce que l'investisseur a touché, ce
 * qu'une valorisation lui prête et ce qu'un projet lui a promis. Le gain latent
 * porte son étiquette et sa méthode dans la carte elle-même — pas dans une note
 * de bas de page qu'on ne lit pas.
 *
 * Tous les chiffres viennent de `GET /investments/metrics/mine` ; ce composant
 * ne fait que les mettre en forme.
 */
const ReturnColumns = ({ columns, currency = 'USD', asOf }) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold text-white">Vos trois rendements</h2>
      <p className="text-xs text-slate-400">
        Devise {currency}
        {asOf ? ` · arrêté au ${asOf}` : ''} · calculés par le serveur sur vos flux réels
      </p>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {columns.map((column, index) => {
        const Icon = ICONS[column.key] ?? Info;
        const tone = TONES[column.key] ?? 'from-slate-900 to-slate-900 border-slate-700 text-slate-300';
        const [gradientFrom, gradientTo, border, accent] = tone.split(' ');

        return (
          <motion.div
            key={column.key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * index }}
          >
            <Card className={`bg-gradient-to-br ${gradientFrom} ${gradientTo} ${border} h-full`}>
              <CardContent className="p-6 flex flex-col h-full">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-white/5 rounded-lg">
                    <Icon className={`w-6 h-6 ${accent}`} />
                  </div>
                  {column.isLatent && (
                    <Badge className="bg-amber-500/20 text-amber-300 border-0">Latent — non encaissé</Badge>
                  )}
                </div>

                <h3 className="text-sm text-slate-400 mb-1">{column.label}</h3>

                {column.unavailableReason ? (
                  <>
                    <p className="text-2xl font-bold text-slate-500">Non disponible</p>
                    <p className="text-xs text-slate-400 mt-2">{column.unavailableReason}</p>
                  </>
                ) : (
                  <p className="text-3xl font-bold text-white">
                    {column.unit === 'percent'
                      ? formatPercent(column.rate)
                      : formatCurrency(column.amount ?? 0, currency)}
                  </p>
                )}

                <p className={`text-xs mt-2 ${accent}`}>{column.caption}</p>
                <p className="text-xs text-slate-500 mt-4 pt-4 border-t border-white/5 flex-1">
                  {column.detail}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  </div>
);

export default ReturnColumns;
