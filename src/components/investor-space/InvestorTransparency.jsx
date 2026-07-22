import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Info, EyeOff, Layers, Ruler } from 'lucide-react';
import { formatCurrency } from '@/lib/investorSpaceUtils';
import { unmeasurableFrom, valuationMethodLabel } from '@/lib/investorSpaceWire';

/**
 * Ce que l'espace investisseur sait, et ce qu'il ne sait pas.
 *
 * Trois blocs, dans cet ordre d'importance :
 *
 * - la **méthode de valorisation** servie par l'annexe D, affichée en toutes
 *   lettres à côté du gain latent qu'elle produit, avec la ventilation des
 *   positions par méthode : « au pair » et « décote de défaut » ne se lisent pas
 *   pareil, et savoir combien de lignes relèvent de chacune change la lecture ;
 * - le **pipeline anonymisé** : un investisseur a le droit de savoir qu'il y a du
 *   flux dans le tuyau, pas de lire les dossiers en instruction ;
 * - ce qui reste **non mesurable**, déduit du payload lui-même (`unmeasurableFrom`)
 *   plutôt que d'une liste figée. Un écran d'investissement qui tait ce qu'il ne
 *   mesure pas laisse croire qu'il a tout mesuré ; c'est la forme la plus
 *   discrète du chiffre flatteur.
 */
const InvestorTransparency = ({ metrics, pipelineStages, currency = 'USD' }) => {
  const unmeasurable = unmeasurableFrom(metrics);
  const methods = Object.entries(metrics.valuation.byMethod ?? {});

  return (
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

        {/* Combien de lignes relèvent de chaque méthode. Un portefeuille valorisé
            « au pair faute d'expertise » sur la moitié de ses positions ne se lit
            pas comme un portefeuille de dette saine intégralement au pair. */}
        {methods.length > 0 && (
          <div className="pt-4 border-t border-slate-800 space-y-2">
            <p className="text-xs text-slate-400">Répartition par méthode de valorisation</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {methods.map(([code, entry]) => (
                <div key={code} className="p-3 rounded-lg bg-slate-800/40 border border-slate-700">
                  <p className="text-sm text-slate-200">{valuationMethodLabel(code)}</p>
                  <p className="text-xs text-slate-400">
                    {entry.positionsCount} position(s) · {formatCurrency(entry.amount, currency)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {metrics.valuation.methodNotes?.length > 0 && (
          <ul className="pt-4 border-t border-slate-800 space-y-1">
            {metrics.valuation.methodNotes.map((note, index) => (
              <li key={`${note}-${index}`} className="text-xs text-slate-400">• {note}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>

    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Ruler className="w-5 h-5 text-blue-400" />
          Périmètre, période et unités
        </CardTitle>
        <CardDescription>
          Le contexte sans lequel un chiffre financier ne veut rien dire.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-xs text-slate-400 mb-1">Période couverte</p>
          <p className="text-white">
            {metrics.period.from ? `${metrics.period.from} → ${metrics.period.to}` : 'Aucun flux'}
          </p>
          <p className="text-xs text-slate-500 mt-1">{metrics.period.flowsCount} flux réels</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-1">Devise</p>
          <p className="text-white">{metrics.currency}</p>
          <p className="text-xs text-slate-500 mt-1">
            Observées : {metrics.currenciesObserved.join(', ')}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-1">Périmètre</p>
          <p className="text-white">{metrics.scope}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-1">Base de calcul</p>
          <p className="text-white text-xs leading-relaxed">{metrics.period.basis}</p>
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

    {unmeasurable.length > 0 && (
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Info className="w-5 h-5 text-blue-400" />
            Ce que cet écran ne peut pas établir
          </CardTitle>
          <CardDescription>
            Ces points ne manquent pas d’un calcul mais d’une donnée. Rien n’est estimé pour
            combler le vide : une valeur approchée ici différerait de celle du back-office, et
            deux chiffres pour la même grandeur valent moins que pas de chiffre du tout.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {unmeasurable.map((item) => (
            <div key={item.key} className="p-4 rounded-lg bg-slate-800/40 border border-slate-700">
              <p className="text-sm font-semibold text-slate-200 mb-1">{item.label}</p>
              <p className="text-xs text-slate-400 leading-relaxed">{item.reason}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    )}
  </div>
  );
};

export default InvestorTransparency;
