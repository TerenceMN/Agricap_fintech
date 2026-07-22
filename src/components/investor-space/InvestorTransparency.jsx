import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Info, EyeOff, Layers } from 'lucide-react';
import { formatCurrency } from '@/lib/investorSpaceUtils';
import { MISSING_INVESTOR_METRICS } from '@/lib/investorSpaceWire';

/**
 * Ce que l'espace investisseur sait, et ce qu'il ne sait pas.
 *
 * Trois blocs, dans cet ordre d'importance :
 *
 * - la **méthode de valorisation** servie par l'annexe D, affichée en toutes
 *   lettres à côté du gain latent qu'elle produit ;
 * - le **pipeline anonymisé** : un investisseur a le droit de savoir qu'il y a du
 *   flux dans le tuyau, pas de lire les dossiers en instruction ;
 * - les **métriques absentes**, nommées une par une avec leur motif. Un écran
 *   d'investissement qui tait ce qu'il ne mesure pas laisse croire qu'il a tout
 *   mesuré ; c'est la forme la plus discrète du chiffre flatteur.
 */
const InvestorTransparency = ({ metrics, pipelineStages, currency = 'USD' }) => (
  <div className="space-y-6">
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Layers className="w-5 h-5 text-amber-400" />
          Comment votre portefeuille est valorisé
        </CardTitle>
        <CardDescription>
          La méthode ci-dessous est celle appliquée par le serveur au moment du calcul —
          elle n’est pas une reformulation faite par l’écran.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-300 leading-relaxed">{metrics.valuation.method}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
          <div>
            <p className="text-xs text-slate-400 mb-1">Capital restant dû</p>
            <p className="text-xl font-bold text-white">
              {formatCurrency(metrics.valuation.capitalOutstanding, currency)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">Gain latent</p>
            <p className="text-xl font-bold text-amber-400">
              {formatCurrency(metrics.valuation.latentGain, currency)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">Total déjà distribué</p>
            <p className="text-xl font-bold text-emerald-400">
              {formatCurrency(metrics.totalDistributed, currency)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <EyeOff className="w-5 h-5 text-slate-400" />
          Projets en instruction — vue agrégée
        </CardTitle>
        <CardDescription>
          Les dossiers en cours d’analyse (P01 à P05) ne sont pas publics : vous en voyez le
          volume, pas le contenu. Un projet ne devient nommément visible qu’à l’ouverture de
          sa levée.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {pipelineStages.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun dossier en instruction actuellement.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {pipelineStages.map((stage) => (
              <div key={stage.stage} className="p-4 rounded-lg bg-slate-800/50 border border-slate-700">
                <Badge variant="outline" className="border-slate-600 text-slate-300 mb-2">
                  {stage.stage}
                </Badge>
                <p className="text-xs text-slate-400 mb-2 min-h-[2rem]">{stage.label}</p>
                <p className="text-2xl font-bold text-white">{stage.count}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {formatCurrency(stage.aggregateTarget, currency)} recherchés
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>

    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Info className="w-5 h-5 text-blue-400" />
          Ce que cet écran ne mesure pas encore
        </CardTitle>
        <CardDescription>
          Ces indicateurs existent côté institution mais ne sont pas encore calculés pour un
          portefeuille individuel. Ils ne sont pas estimés dans le navigateur : un chiffre
          approché ici différerait de celui du back-office, et deux chiffres pour la même
          grandeur valent moins que pas de chiffre du tout.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {MISSING_INVESTOR_METRICS.map((item) => (
          <div key={item.key} className="p-4 rounded-lg bg-slate-800/40 border border-slate-700">
            <p className="text-sm font-semibold text-slate-200 mb-1">{item.label}</p>
            <p className="text-xs text-slate-400 leading-relaxed">{item.reason}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  </div>
);

export default InvestorTransparency;
